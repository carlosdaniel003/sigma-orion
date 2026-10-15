"""Quality investigation 4.2 using Q239 and Q273 from the original SAP STK.

The 4.1 decision is recomputed on the server, never trusted from the browser.
Q239 has priority. When absent, Q273 is examined as scrap/refugo evidence.
No SAP movement, official DPP balance, or automated scrap analysis is performed.
"""
from __future__ import annotations

from hashlib import sha256
import json
import math

from sqlalchemy.orm import Session

from app.models.quality_depot_review import QualityDepotReview
from app.services.dpp_consolidation_service import _material_key
from app.services.dpp_stock_divergence_service import investigate_stock_divergence
from app.services.dpp_stock_review_service import add_reviews

QUALITY_DEPOTS = ("Q239", "Q273")
TOLERANCE = 1e-4
DECISIONS = {"RELEASED", "REJECTED", "SCRAP_CONFIRMED", "NO_EVIDENCE"}
ACCOUNTING_OPTIONS = {"INCLUDED", "NOT_INCLUDED", "UNKNOWN"}


def _id(scenario_id: str, stock_digest: str, material: str, candidate: dict) -> str:
    identity = (
        scenario_id, stock_digest, _material_key(material), candidate["depot"],
        candidate.get("center") or "", candidate["unit"], candidate["source_rows"], "quality-4.2",
    )
    return sha256(json.dumps(identity, ensure_ascii=False).encode("utf-8")).hexdigest()


def _record_view(row: QualityDepotReview) -> dict:
    return {
        "id": row.id,
        "decision": row.decision,
        "accounting": row.accounting,
        "confirmed_quantity": row.confirmed_quantity,
        "justification": row.justification,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def quality_report(
    *,
    scenario: dict,
    stock_content: bytes,
    stock_filename: str,
    session: Session,
) -> dict:
    """Return current flow 4.2 for only the materials referred by live flow 4.1."""
    digest = sha256(stock_content).hexdigest()

    stock_report = investigate_stock_divergence(
        stock_content=stock_content, stock_filename=stock_filename, scenario=scenario,
    )
    stock_report = add_reviews(stock_report, session, digest)
    referred = stock_report["workflow"]["forward_to_quality"]

    quality_source = investigate_stock_divergence(
        stock_content=stock_content, stock_filename=stock_filename, scenario=scenario,
        depots=QUALITY_DEPOTS,
    )
    by_material = {
        _material_key(material["material"]): material
        for material in quality_source["materials"]
    }
    recorded_rows = (
        session.query(QualityDepotReview)
        .filter_by(scenario_id=scenario["scenario_id"], stock_sha256=digest)
        .order_by(QualityDepotReview.id)
        .all()
    )
    history: dict[str, list[dict]] = {}
    for row in recorded_rows:
        history.setdefault(row.candidate_id, []).append(_record_view(row))

    materials = []
    routing = {"FINISHED": [], "SCRAP_4_3": [], "AWAITING_QUALITY": []}
    reviewed = 0
    for origin in referred:
        material_id = origin["material"]
        inspected = by_material.get(_material_key(material_id), {})
        candidates = inspected.get("candidates") or []
        q239 = [c for c in candidates if c["depot"] == "Q239"]
        q273 = [c for c in candidates if c["depot"] == "Q273"]
        selected = q239 if q239 else q273
        active_depot = "Q239" if q239 else "Q273" if q273 else None

        released = 0.0
        rejected = 0.0
        scrap = 0.0
        confirmations = 0
        reviewed_candidates = []
        for candidate in selected:
            candidate = dict(candidate)
            key = _id(scenario["scenario_id"], digest, material_id, candidate)
            versions = history.get(key, [])
            current = versions[-1] if versions else None
            candidate["candidate_id"] = key
            candidate["validation_history"] = versions
            candidate["validation"] = current
            candidate["validation_status"] = "PENDENTE_CQ" if active_depot == "Q239" else "PENDENTE_REFUGO"
            if current:
                reviewed += 1
                confirmations += 1
                candidate["validation_status"] = current["decision"]
                quantity = current["confirmed_quantity"]
                if current["decision"] == "RELEASED" and current["accounting"] == "NOT_INCLUDED":
                    released += quantity
                if current["decision"] == "REJECTED" and current["justification"]:
                    rejected += quantity
                if current["decision"] == "SCRAP_CONFIRMED" and current["justification"]:
                    scrap += quantity
            reviewed_candidates.append(candidate)

        incoming_unexplained = max(float(origin["unexplained_quantity"]), 0.0)
        incoming_physical_gap = max(float(origin["remaining_gap_after_recovery"]), 0.0)
        remaining_physical = max(0.0, incoming_physical_gap - released)
        # Justified rejected/refugo material explains a cause, but NEVER becomes stock.
        remaining_unexplained = max(0.0, incoming_unexplained - released - rejected - scrap)
        if remaining_physical <= TOLERANCE:
            remaining_physical = 0.0
        if remaining_unexplained <= TOLERANCE:
            remaining_unexplained = 0.0

        if remaining_unexplained == 0:
            status, next_step = "FINISHED", "Análise do item finalizada"
        elif not selected:
            status, next_step = "SCRAP_4_3", "Sem registros em Q239 ou Q273; encaminhar a Scrap 4.3"
        elif confirmations > 0:
            status, next_step = "SCRAP_4_3", "Falta ainda sem explicação; encaminhar a Scrap 4.3"
        else:
            status, next_step = "AWAITING_QUALITY", "Aguardar validação da Qualidade/CQ"

        row = {
            "material": material_id,
            "description": origin.get("description"),
            "unit": origin["unit"],
            "gap_from_41": incoming_unexplained,
            "physical_gap_from_41": incoming_physical_gap,
            "quality_released": released,
            "quality_rejected_justified": rejected,
            "quality_scrap_justified": scrap,
            "physical_gap_after_quality": remaining_physical,
            "unexplained_after_quality": remaining_unexplained,
            "active_depot": active_depot,
            "q273_records_skipped_due_q239": len(q273) if q239 else 0,
            # Transparency: expose Q273 rows not used in calculations when Q239
            # has priority. These are evidence only, not automatic extra stock.
            "additional_q273_evidence": [dict(c) for c in q273] if q239 else [],
            "candidates": reviewed_candidates,
            "reviewed_candidates": confirmations,
            "workflow_status": status,
            "next_step": next_step,
            "pending_reviews": len(selected) - confirmations,
        }
        materials.append(row)
        routing[status].append({
            "material": material_id,
            "unit": row["unit"],
            "unexplained_quantity": remaining_unexplained,
            "physical_gap_after_quality": remaining_physical,
            "next_step": next_step,
        })

    materials.sort(key=lambda m: (-m["gap_from_41"], str(m["material"])))
    return {
        "scenario_id": scenario["scenario_id"],
        "reference_month": scenario.get("reference_month"),
        "source": {"filename": stock_filename, "sheet": "ORIGINAL", "depots": list(QUALITY_DEPOTS)},
        "summary": {
            "items_received_from_41": len(referred),
            "materials_with_q239": sum(m["active_depot"] == "Q239" for m in materials),
            "materials_with_q273": sum(m["active_depot"] == "Q273" for m in materials),
            "materials_without_quality_records": sum(m["active_depot"] is None for m in materials),
            "candidates_reviewed": reviewed,
            "items_finished": len(routing["FINISHED"]),
            "items_to_scrap": len(routing["SCRAP_4_3"]),
            "items_awaiting_quality": len(routing["AWAITING_QUALITY"]),
        },
        "materials": materials,
        "workflow": {
            "status": "QUALITY_4_2_ROUTING",
            "scrap_analysis_implemented": False,
            "finished": routing["FINISHED"],
            "forward_to_scrap": routing["SCRAP_4_3"],
            "awaiting_quality": routing["AWAITING_QUALITY"],
        },
        "changes_dpp": False,
        "note": (
            "Dados Q239/Q273 representam saldos por depósito no STK ORIGINAL, não liberação, "
            "reprovação ou refugo já comprovados. A confirmação humana é necessária; "
            "quantidades liberadas só entram na projeção se não contabilizadas no DPP. "
            "Reprovação/refugo justificado explica a causa, mas não acrescenta estoque. "
            "O encaminhamento a Scrap 4.3 é apenas indicação da próxima etapa."
        ),
    }


def register_quality_review(
    session: Session,
    *,
    report: dict,
    stock_digest: str,
    candidate_id: str,
    decision: str,
    accounting: str,
    quantity: float,
    justification: str,
) -> dict:
    decision = (decision or "").strip().upper()
    accounting = (accounting or "").strip().upper()
    justification = (justification or "").strip()
    if decision not in DECISIONS or accounting not in ACCOUNTING_OPTIONS:
        raise ValueError("Decisão ou situação de contabilização inválida.")
    if len(justification) > 4000:
        raise ValueError("Justificativa deve ter no máximo 4000 caracteres.")
    try:
        quantity = float(quantity)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Quantidade inválida.") from exc
    if not math.isfinite(quantity) or quantity < 0:
        raise ValueError("Quantidade precisa ser finita e não negativa.")

    selected = None
    for material in report["materials"]:
        for candidate in material["candidates"]:
            if candidate["candidate_id"] == candidate_id:
                selected = material, candidate
                break
        if selected:
            break
    if selected is None:
        raise ValueError("Registro de Qualidade não pertence aos PNs encaminhados pela etapa 4.1.")
    material, candidate = selected
    depot = candidate["depot"]
    if depot == "Q239" and decision not in {"RELEASED", "REJECTED", "NO_EVIDENCE"}:
        raise ValueError("No Q239, informe liberação, reprovação ou ausência de confirmação.")
    if depot == "Q273" and decision not in {"SCRAP_CONFIRMED", "NO_EVIDENCE"}:
        raise ValueError("No Q273, informe refugo comprovado ou ausência de confirmação.")
    if decision == "RELEASED":
        if quantity <= 0:
            raise ValueError("Informe a quantidade efetivamente liberada pelo CQ.")
    elif accounting != "UNKNOWN":
        raise ValueError("Somente uma liberação em Q239 pode declarar contabilização no DPP.")
    if decision in {"REJECTED", "SCRAP_CONFIRMED"}:
        if quantity <= 0 or not justification:
            raise ValueError("Informe quantidade positiva e justificativa para reprovação ou refugo.")
    if decision == "NO_EVIDENCE" and quantity != 0:
        raise ValueError("Sem comprovação exige quantidade zero.")
    if quantity > candidate["quantity"] + TOLERANCE:
        raise ValueError("Quantidade confirmada supera o registro de Q239/Q273 no STK.")
    quantity = min(candidate["quantity"], quantity)

    old = (
        session.query(QualityDepotReview)
        .filter_by(scenario_id=report["scenario_id"], stock_sha256=stock_digest, candidate_id=candidate_id)
        .order_by(QualityDepotReview.id.desc())
        .first()
    )
    if old and (
        old.decision == decision and old.accounting == accounting
        and abs(old.confirmed_quantity - quantity) < 1e-9 and old.justification == justification
    ):
        return _record_view(old)
    record = QualityDepotReview(
        scenario_id=report["scenario_id"], stock_sha256=stock_digest,
        candidate_id=candidate_id, material=material["material"],
        depot=depot, center=candidate.get("center") or "", unit=candidate["unit"],
        decision=decision, accounting=accounting,
        confirmed_quantity=quantity, justification=justification,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _record_view(record)
