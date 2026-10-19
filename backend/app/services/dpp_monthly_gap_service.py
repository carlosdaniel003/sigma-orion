"""Consolidate human-validated Stock and CQ evidence over the full monthly DPP.

Read-only projection: initial NEC/STK TTL/SALDO/REAL remain deterministic.
Only validations already attributed to an individual deficit by the two
authoritative investigations can change the projected physical shortage.
Unavailable/rejected/scrap-justified quantities explain an existing shortage
without becoming recovered inventory.
"""
from __future__ import annotations

from collections import defaultdict
from hashlib import sha256
from datetime import datetime, timezone
import json
import hmac

from app.db.database import SessionLocal
from app.services.dpp_consolidation_service import _material_key
from app.services.dpp_stock_divergence_service import investigate_stock_divergence
from app.services.dpp_stock_review_service import add_reviews
from app.services.dpp_quality_service import quality_report

EPSILON = 1e-4


def _positive(value: object) -> float:
    try:
        return max(0.0, float(value or 0.0))
    except (TypeError, ValueError):
        return 0.0


def _clamp(value: object, limit: float) -> float:
    return min(_positive(value), max(0.0, limit))


def _normal(value: float) -> float:
    return 0.0 if value < EPSILON else round(value, 6)


def build_monthly_gap_projection(*, scenario: dict, stock_report: dict, cq_report: dict) -> dict:
    """Recalculate for *every* material, attributing only evidence from steps 1 and 2."""
    if scenario.get("scenario_id") != stock_report.get("scenario_id") or scenario.get("scenario_id") != cq_report.get("scenario_id"):
        raise ValueError("Investigação de Estoque, Qualidade e cenário pertencem a contextos diferentes.")

    stock_by_pn = {
        _material_key(x["material"]): x for x in stock_report.get("materials", [])
    }
    quality_by_pn = {
        _material_key(x["material"]): x for x in cq_report.get("materials", [])
    }
    unmatched = {
        _material_key(x["material"]) for x in stock_report.get("unmatched_materials", [])
    }
    output = []
    by_unit = defaultdict(lambda: {
        "materials": 0, "negative_materials": 0, "initial_gap": 0.0,
        "recovered_stock": 0.0, "recovered_cq": 0.0,
        "physical_gap_after_stock": 0.0, "physical_gap_after_quality": 0.0,
        "justified_stock": 0.0, "justified_cq": 0.0,
        "unexplained_after_quality": 0.0,
    })
    detected = 0
    changed = 0
    pending = 0
    outside_scope = 0
    for material in scenario.get("materials", []):
        key = _material_key(material.get("material") or material.get("material_key"))
        unit = (material.get("um") or "").strip().upper() or "SEM UM"
        original_balance = float(material.get("balance") or 0.0)
        initial = _normal(max(0.0, -original_balance))
        critical = material.get("status") == "INVESTIGAR" and unit == "UN"
        stock = stock_by_pn.get(key) if critical else None
        quality = quality_by_pn.get(key) if critical else None

        stock_added = _clamp(stock.get("recovered_quantity_applied") if stock else 0, initial)
        remaining_stock = _normal(initial - stock_added)
        stock_explained = _clamp(stock.get("justified_unavailable_applied") if stock else 0, remaining_stock)
        unexplained_stock = _normal(remaining_stock - stock_explained)

        cq_added = _clamp(quality.get("quality_released_applied") if quality else 0, unexplained_stock)
        remaining_cq = _normal(remaining_stock - cq_added)
        left_to_explain = max(0.0, unexplained_stock - cq_added)
        cq_rejected = _clamp(quality.get("quality_rejected_applied") if quality else 0, left_to_explain)
        left_to_explain -= cq_rejected
        cq_scrap = _clamp(quality.get("quality_scrap_applied") if quality else 0, left_to_explain)
        unexplained_final = _normal(left_to_explain - cq_scrap)

        if critical:
            detected += 1
        elif initial > 0:
            outside_scope += 1
        if stock_added > 0 or cq_added > 0 or stock_explained > 0 or cq_rejected > 0 or cq_scrap > 0:
            changed += 1
        pending_count = (
            (sum(not c.get("validation") for c in stock.get("candidates", [])) if stock else 0)
            + (sum(not c.get("validation") for c in quality.get("candidates", [])) if quality else 0)
        )
        provisional = pending_count > 0
        if critical and provisional:
            pending += 1

        # Raw scenario SALDO is never overwritten. A *projected* balance is
        # separately exposed to show how confirmed extra stock would affect it.
        projected_balance = original_balance + stock_added + cq_added
        row = {
            "material": material.get("material"), "description": material.get("description"),
            "unit": unit, "critical": critical, "investigation_scope": (
                "ESTOQUE_E_CQ" if critical else "FORA_ESCOPO"
            ),
            "original_balance": original_balance,
            "projected_balance": _normal(projected_balance) if abs(projected_balance) < EPSILON else round(projected_balance, 6),
            "initial_gap": initial, "found_stock": _positive(stock.get("candidate_quantity") if stock else 0),
            "recovered_stock": stock_added, "physical_gap_after_stock": remaining_stock,
            "justified_stock": stock_explained, "unexplained_after_stock": unexplained_stock,
            "found_cq": sum(_positive(c.get("quantity")) for c in quality.get("candidates", [])) if quality else 0.0,
            "recovered_cq": cq_added, "justified_cq_rejection": cq_rejected,
            "justified_cq_scrap": cq_scrap, "physical_gap_after_quality": remaining_cq,
            "unexplained_after_quality": unexplained_final,
            "stock_status": stock.get("workflow_status") if stock else (
                "SEM_REGISTRO" if critical and key in unmatched else "NAO_APLICAVEL"
            ),
            "quality_status": quality.get("workflow_status") if quality else "NAO_APLICAVEL",
            "pending_validations": pending_count, "provisional": provisional,
        }
        output.append(row)

        group = by_unit[unit]
        group["materials"] += 1
        if initial > 0:
            group["negative_materials"] += 1
        for field in (
            "initial_gap", "recovered_stock", "recovered_cq",
            "physical_gap_after_stock", "physical_gap_after_quality",
            "unexplained_after_quality",
        ):
            group[field] += row[field]
        group["justified_stock"] += stock_explained
        group["justified_cq"] += cq_rejected + cq_scrap

    for group in by_unit.values():
        for field, value in group.items():
            if isinstance(value, float):
                group[field] = _normal(value)

    return {
        "scenario_id": scenario["scenario_id"],
        "reference_month": scenario.get("reference_month"),
        "status": "PROJECAO_RASTREAVEL",
        "changes_official_saldo": False,
        "changes_dpp_export": False,
        "sources": ["Divergência de Estoque (M221/P277)", "Análise de Qualidade (Q239/Q273)"],
        "summary": {
            "materials_total": len(output),
            "critical_materials": detected,
            "negative_outside_scope": outside_scope,
            "materials_with_applied_explanations": changed,
            "critical_materials_with_pending_validations": pending,
            "stock_materials_found": stock_report.get("summary", {}).get("materials_with_candidates", 0),
            "quality_materials_found": (
                cq_report.get("summary", {}).get("materials_with_q239", 0)
                + cq_report.get("summary", {}).get("materials_with_q273", 0)
            ),
            "units": [
                {"unit": unit, **group} for unit, group in sorted(by_unit.items())
            ],
        },
        "materials": output,
        "note": (
            "Projeção consolidada para todo o DPP. Apenas liberações disponíveis, "
            "validadas e comprovadamente fora do DPP reduzem o gap físico. "
            "Indisponibilidade, reprovação e refugo com justificativa reduzem a "
            "falta sem explicação, não a falta física. SALDO, NEC, STK TTL e REAL "
            "originais não são alterados; Scrap posterior não participa."
        ),
    }


def recalculate_monthly_gap(
    *, scenario: dict, stock_content: bytes, stock_filename: str,
) -> dict:
    """Always rebuild authoritative reviews; never trust client-submitted quantities."""
    digest = sha256(stock_content).hexdigest()
    original = investigate_stock_divergence(
        stock_content=stock_content, stock_filename=stock_filename, scenario=scenario,
    )
    with SessionLocal() as session:
        stock = add_reviews(original, session, digest)
        quality = quality_report(
            scenario=scenario, stock_content=stock_content,
            stock_filename=stock_filename, session=session,
        )
    return build_monthly_gap_projection(
        scenario=scenario, stock_report=stock, cq_report=quality,
    )



def _live_approval_context(*, scenario: dict, stock_content: bytes, stock_filename: str) -> dict:
    """Server-side read; client cannot fabricate confirmations or source quantities."""
    digest = sha256(stock_content).hexdigest()
    original = investigate_stock_divergence(
        stock_content=stock_content, stock_filename=stock_filename, scenario=scenario,
    )
    with SessionLocal() as session:
        stock = add_reviews(original, session, digest)
        quality = quality_report(
            scenario=scenario, stock_content=stock_content,
            stock_filename=stock_filename, session=session,
        )

    projection = build_monthly_gap_projection(
        scenario=scenario, stock_report=stock, cq_report=quality,
    )
    stock_pending = sum(not c.get("validation") for m in stock["materials"] for c in m["candidates"])
    quality_pending = sum(not c.get("validation") for m in quality["materials"] for c in m["candidates"])
    unresolved = sum(
        bool(m["critical"] and m["unexplained_after_quality"] > EPSILON)
        for m in projection["materials"]
    )
    # An unlocated PN has no candidate to validate, but it remains explicitly
    # unresolved and receives no credit. This is not a false confirmation.
    unlocated = sum(
        bool(m["critical"] and m["stock_status"] == "SEM_REGISTRO"
             and m["quality_status"] == "SCRAP_4_3")
        for m in projection["materials"]
    )
    recovered = sum(m["recovered_stock"] + m["recovered_cq"] for m in projection["materials"])
    explained_only = sum(
        m["justified_stock"] + m["justified_cq_rejection"] + m["justified_cq_scrap"]
        for m in projection["materials"]
    )
    revisions = {
        "stock": sorted([
            [candidate.get("candidate_id"), (candidate.get("validation") or {}).get("id")]
            for material in stock["materials"] for candidate in material["candidates"]
        ]),
        "quality": sorted([
            [candidate.get("candidate_id"), (candidate.get("validation") or {}).get("id")]
            for material in quality["materials"] for candidate in material["candidates"]
        ]),
    }
    # Token binds *scenario, file bytes, every review version and every applied
    # quantity*. Recalculate it for commit to reject changes after preview.
    token_input = {
        "scenario_id": scenario["scenario_id"],
        "stock_sha256": digest,
        "projection": projection,
        "revisions": revisions,
    }
    token = sha256(json.dumps(token_input, sort_keys=True, ensure_ascii=False,
                              separators=(",", ":")).encode("utf-8")).hexdigest()
    blockers = []
    if stock_pending:
        blockers.append(f"{stock_pending} registro(s) de Estoque ainda sem validação do Almoxarifado.")
    if quality_pending:
        blockers.append(f"{quality_pending} registro(s) de Qualidade ainda sem validação do CQ.")
    return {
        "token": token,
        "ready": not blockers,
        "blockers": blockers,
        "stock_pending": stock_pending,
        "quality_pending": quality_pending,
        "unresolved_materials": unresolved,
        "unlocated_materials": unlocated,
        "new_stock_confirmed_by_unit": [
            {
                "unit": item["unit"],
                "from_stock": item["recovered_stock"],
                "from_quality": item["recovered_cq"],
                "still_unexplained": item["unexplained_after_quality"],
            }
            for item in projection["summary"]["units"]
            if item["negative_materials"]
        ],
        "total_stock_confirmed": round(recovered, 6),
        "total_only_justified": round(explained_only, 6),
        "projection": projection,
        "stock_sha256": digest,
    }


def prepare_monthly_gap_application(*, scenario: dict, stock_content: bytes,
                                    stock_filename: str) -> dict:
    if scenario.get("gap_approval"):
        raise ValueError("Este cenário já teve sua aplicação confirmada. Use a nova versão do DPP.")
    ctx = _live_approval_context(
        scenario=scenario, stock_content=stock_content, stock_filename=stock_filename
    )
    return {
        "scenario_id": scenario["scenario_id"],
        "reference_month": scenario.get("reference_month"),
        "approval_token": ctx["token"],
        "ready": ctx["ready"],
        "blockers": ctx["blockers"],
        "stock_pending": ctx["stock_pending"],
        "quality_pending": ctx["quality_pending"],
        "unresolved_materials": ctx["unresolved_materials"],
        "unlocated_materials": ctx["unlocated_materials"],
        "total_stock_confirmed": ctx["total_stock_confirmed"],
        "total_only_justified": ctx["total_only_justified"],
        "by_unit": ctx["new_stock_confirmed_by_unit"],
        "materials_total": ctx["projection"]["summary"]["materials_total"],
        "critical_materials": ctx["projection"]["summary"]["critical_materials"],
        "note": (
            "PNs sem registros não são tratados como confirmados nem recebem saldo. "
            "Toda validação encontrada precisa estar concluída. Quantidades apenas "
            "justificadas não são convertidas em estoque. A confirmação cria nova versão "
            "auditável do DPP; o cenário anterior permanece preservado."
        ),
    }


def apply_monthly_gap_application(*, scenario: dict, stock_content: bytes,
                                  stock_filename: str, approval_token: str,
                                  confirm: bool, accept_unresolved: bool) -> dict:
    from app.services.dpp_scenario_service import create_approved_gap_scenario

    if not confirm:
        raise ValueError("A aplicação ao DPP exige confirmação explícita do analista.")
    if scenario.get("gap_approval"):
        raise ValueError("Este DPP já foi aprovado. Não é permitido reaplicar o ajuste.")
    if not approval_token or len(approval_token) != 64:
        raise ValueError("Prévia de confirmação ausente ou inválida. Confira os dados novamente.")
    ctx = _live_approval_context(
        scenario=scenario, stock_content=stock_content, stock_filename=stock_filename
    )
    if not hmac.compare_digest(ctx["token"], approval_token):
        raise ValueError("As análises ou o cenário mudaram depois da prévia. Confira o resumo e confirme novamente.")
    if not ctx["ready"]:
        raise ValueError("Existem validações pendentes de Estoque ou Qualidade. Conclua-as antes de aplicar.")
    if ctx["unresolved_materials"] and not accept_unresolved:
        raise ValueError(
            "Existem PNs com falta ainda sem explicação. Confirme o reconhecimento "
            "desses PNs, que não receberão estoque adicional."
        )

    projection = ctx["projection"]
    patches = {
        row["material"]: row
        for row in projection["materials"]
        if row["critical"] and (
            row["recovered_stock"] > 0 or row["recovered_cq"] > 0
            or row["justified_stock"] > 0 or row["justified_cq_rejection"] > 0
            or row["justified_cq_scrap"] > 0
        )
    }
    audit = {
        "approved_at_utc": datetime.now(timezone.utc).isoformat(),
        "approval_token": ctx["token"],
        "stock_sha256": ctx["stock_sha256"],
        "scope": "ESTOQUE_E_QUALIDADE",
        "materials_total": projection["summary"]["materials_total"],
        "critical_materials": projection["summary"]["critical_materials"],
        "materials_with_applied_explanations": len(patches),
        "unresolved_materials": ctx["unresolved_materials"],
        "unlocated_materials": ctx["unlocated_materials"],
        "pending_validations_at_approval": 0,
        "recovered_by_unit": ctx["new_stock_confirmed_by_unit"],
        "confirmed_unresolved": bool(ctx["unresolved_materials"] and accept_unresolved),
    }
    new_scenario = create_approved_gap_scenario(
        scenario["scenario_id"], additions=patches, approval=audit
    )
    return {
        "status": "APLICADO_AO_DPP",
        "scenario": new_scenario,
        "original_scenario_id": scenario["scenario_id"],
        "applied_scenario_id": new_scenario["scenario_id"],
        "approval": new_scenario["gap_approval"],
        "note": "Nova versão do DPP criada. Originais preservados; o Excel da nova versão incorpora somente estoque confirmado.",
    }
