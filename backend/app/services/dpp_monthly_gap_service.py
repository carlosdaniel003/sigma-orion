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
