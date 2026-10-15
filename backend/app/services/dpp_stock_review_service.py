"""Validation register and read-only gap projection for stock investigation 4.1.

No stock movement, DPP SALDO, REAL or NEC is ever changed by this service.
"""
from __future__ import annotations

from hashlib import sha256
import json
import math

from sqlalchemy.orm import Session

from app.models.stock_depot_review import StockDepotReview
from app.services.dpp_investigation_allocation import allocate_cause

TOLERANCE = 1e-4


def candidate_id(report: dict, material: dict, candidate: dict, digest: str) -> str:
    identity = (
        report["scenario_id"], digest, material["material"], candidate["depot"],
        candidate.get("center") or "", candidate["unit"], candidate["source_rows"],
    )
    return sha256(json.dumps(identity, ensure_ascii=False).encode("utf-8")).hexdigest()


def _view(record: StockDepotReview) -> dict:
    return {
        "id": record.id, "decision": record.decision, "accounting": record.accounting,
        "confirmed_quantity": record.confirmed_quantity,
        "pcm": record.pcm, "warehouse": record.warehouse,
        "evidence": record.evidence,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def add_reviews(report: dict, session: Session, digest: str) -> dict:
    """Explain only proven quantity and derive a routing suggestion, never a SAP write.

    A later human correction replaces the *effective* validation without deleting
    history. Available and unavailable quantities have distinct meanings:
    * AVAILABLE + NOT_INCLUDED reduces the investigative stock gap.
    * UNAVAILABLE + a written justification explains a known unavailable amount.
      It does not increase available stock or reduce the official DPP SALDO.
    """
    rows = (
        session.query(StockDepotReview)
        .filter_by(scenario_id=report["scenario_id"], stock_sha256=digest)
        .order_by(StockDepotReview.id)
        .all()
    )
    by_candidate = {}
    for row in rows:
        by_candidate.setdefault(row.candidate_id, []).append(_view(row))

    reviewed = 0
    projected = 0
    routing = {"FINISHED": [], "QUALITY_4_2": [], "AWAITING_VALIDATION": []}

    for material in report["materials"]:
        recovered = 0.0
        justified_unavailable = 0.0
        reviewed_candidates = 0
        for candidate in material["candidates"]:
            identifier = candidate_id(report, material, candidate, digest)
            versions = by_candidate.get(identifier, [])
            current = versions[-1] if versions else None
            candidate["candidate_id"] = identifier
            candidate["validation_history"] = versions
            candidate["validation"] = current
            candidate["recovered_quantity"] = 0.0
            candidate["justified_unavailable_quantity"] = 0.0
            if current:
                reviewed += 1
                reviewed_candidates += 1
                candidate["validation_status"] = (
                    "CONFIRMADO_DISPONIVEL" if current["decision"] == "AVAILABLE"
                    else "CONFIRMADO_INDISPONIVEL"
                )
                if current["decision"] == "AVAILABLE" and current["accounting"] == "NOT_INCLUDED":
                    candidate["recovered_quantity"] = current["confirmed_quantity"]
                    recovered += current["confirmed_quantity"]
                elif current["decision"] == "UNAVAILABLE" and current["confirmed_quantity"] > 0 and current["evidence"].strip():
                    candidate["justified_unavailable_quantity"] = current["confirmed_quantity"]
                    justified_unavailable += current["confirmed_quantity"]

        deficit = material["negative_balance"]
        # Creditar primeiro a recuperação e só depois justificar a falta restante.
        # As quantidades originais continuam rastreáveis sem virar estoque adicional.
        _, recovered_applied = allocate_cause(
            material["candidates"], deficit,
            confirmed_field="recovered_quantity",
            applied_field="recovered_applied",
        )
        remaining_gap = max(0.0, deficit - recovered_applied)
        _, justified_applied = allocate_cause(
            material["candidates"], remaining_gap,
            confirmed_field="justified_unavailable_quantity",
            applied_field="justified_unavailable_applied",
        )
        unexplained = max(0.0, remaining_gap - justified_applied)
        if remaining_gap <= TOLERANCE:
            remaining_gap = 0.0
        if unexplained <= TOLERANCE:
            unexplained = 0.0

        material["confirmed_increment_outside_dpp"] = recovered
        material["recovered_quantity_applied"] = recovered_applied
        material["justified_unavailable_quantity"] = justified_unavailable
        material["justified_unavailable_applied"] = justified_applied
        material["confirmed_excess_not_attributed"] = max(
            0.0, recovered + justified_unavailable - recovered_applied - justified_applied
        )
        material["theoretical_coverage_limit"] = min(
            deficit, float(material.get("candidate_quantity") or 0.0)
        )
        material["gap_reduction_projected"] = recovered_applied
        material["projected_gap_remaining"] = remaining_gap
        material["unexplained_quantity"] = unexplained
        material["explained_quantity"] = recovered_applied + justified_applied
        material["reviewed_candidates"] = reviewed_candidates
        material["total_candidates"] = len(material["candidates"])

        pending_reviews = len(material["candidates"]) - reviewed_candidates
        provisional = pending_reviews > 0
        if unexplained == 0:
            status = "FINISHED"
            next_step = (
                "Falta explicada; conclusão provisória (há depósitos sem validação)"
                if provisional else "Análise do item finalizada"
            )
        elif reviewed_candidates > 0:
            status = "QUALITY_4_2"
            next_step = (
                "Encaminhamento provisório à Qualidade 4.2; validações de Estoque pendentes"
                if provisional else "Encaminhar saldo não explicado à análise de Qualidade 4.2"
            )
        else:
            status = "AWAITING_VALIDATION"
            next_step = "Aguardar validação PCM/Almoxarifado"

        if recovered > 0:
            projected += 1
        material["workflow_status"] = status
        material["routing_provisional"] = provisional
        material["next_step"] = next_step
        routing[status].append({
            "material": material["material"],
            "description": material.get("description"),
            "unit": material["unit"],
            "initial_deficit": deficit,
            "recovered_quantity": recovered_applied,
            "recovered_quantity_confirmed": recovered,
            "justified_unavailable_quantity": justified_applied,
            "justified_unavailable_confirmed": justified_unavailable,
            "confirmed_excess_not_attributed": material["confirmed_excess_not_attributed"],
            "remaining_gap_after_recovery": remaining_gap,
            "unexplained_quantity": unexplained,
            "pending_reviews": pending_reviews,
            "routing_provisional": provisional,
            "next_step": next_step,
        })

    for material in report.get("unmatched_materials") or []:
        routing["QUALITY_4_2"].append({
            "material": material["material"],
            "description": material.get("description"),
            "unit": material["unit"],
            "initial_deficit": material["negative_balance"],
            "recovered_quantity": 0.0,
            "justified_unavailable_quantity": 0.0,
            "remaining_gap_after_recovery": material["negative_balance"],
            "unexplained_quantity": material["negative_balance"],
            "pending_reviews": 0,
            "routing_provisional": False,
            "next_step": "Sem registros nos depósitos investigados; encaminhar à Qualidade 4.2",
        })

    report["workflow"] = {
        "status": "STOCK_4_1_ROUTING",
        "quality_analysis_implemented": False,
        "finished": routing["FINISHED"],
        "forward_to_quality": routing["QUALITY_4_2"],
        "awaiting_validation": routing["AWAITING_VALIDATION"],
    }
    report["summary"]["candidates_reviewed"] = reviewed
    report["summary"]["materials_with_projection"] = projected
    report["summary"]["items_finished"] = len(routing["FINISHED"])
    report["summary"]["items_to_quality"] = len(routing["QUALITY_4_2"])
    report["summary"]["provisional_handoffs"] = sum(
        bool(item.get("routing_provisional")) for item in routing["QUALITY_4_2"]
    )
    report["summary"]["items_awaiting_validation"] = len(routing["AWAITING_VALIDATION"])
    report["gap_projection_is_official"] = False
    report["changes_dpp"] = False
    report["note"] = (
        "Quantidade confirmada é a evidência bruta. Apenas a parcela aplicada "
        "ao déficit do PN explica a falta; o excedente não é atribuído duas vezes. "
        "Quantidade indisponível justificada não recupera estoque. Há encaminhamentos "
        "provisórios quando restam validações de depósitos. Encaminhamento não é "
        "liberação nem execução automática de Qualidade. "
        "Nenhuma movimentação SAP, SALDO, NEC, STK TTL ou REAL é alterado."
    )
    return report


def register_review(
    session: Session, *, report: dict, digest: str, identifier: str,
    decision: str, accounting: str, quantity: float, pcm: str, warehouse: str, evidence: str,
) -> dict:
    decision = (decision or "").strip().upper()
    accounting = (accounting or "").strip().upper()
    pcm, warehouse, evidence = (pcm or "").strip(), (warehouse or "").strip(), (evidence or "").strip()
    if decision not in {"AVAILABLE", "UNAVAILABLE"}:
        raise ValueError("Indique disponível ou indisponível.")
    if accounting not in {"INCLUDED", "NOT_INCLUDED", "UNKNOWN"}:
        raise ValueError("Classificação de contabilização inválida.")
    # Campos legados opcionais: preservar dados antigos sem exigir novos.
    if len(pcm) > 120 or len(warehouse) > 120 or len(evidence) > 4000:
        raise ValueError("Os campos opcionais ultrapassaram o limite permitido.")
    try:
        quantity = float(quantity)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError("Quantidade inválida.") from exc
    if not math.isfinite(quantity) or quantity < 0:
        raise ValueError("Quantidade precisa ser finita e não negativa.")
    if decision == "UNAVAILABLE":
        if accounting != "UNKNOWN":
            raise ValueError("Material indisponível exige contabilização desconhecida.")
        if quantity > 0 and not evidence:
            raise ValueError("Informe a justificativa para contabilizar a quantidade indisponível como explicada.")
    elif quantity <= 0:
        raise ValueError("Informe quantidade positiva para material disponível.")

    selected = None
    for material in report["materials"]:
        for candidate in material["candidates"]:
            if candidate_id(report, material, candidate, digest) == identifier:
                selected = material, candidate
                break
        if selected:
            break
    if selected is None:
        raise ValueError("Registro não encontrado para o cenário e snapshot de estoque.")
    material, candidate = selected
    if quantity > candidate["quantity"] + TOLERANCE:
        raise ValueError("A quantidade informada supera o registro desse PN no depósito.")
    quantity = min(quantity, candidate["quantity"])

    previous = (
        session.query(StockDepotReview)
        .filter_by(scenario_id=report["scenario_id"], stock_sha256=digest, candidate_id=identifier)
        .order_by(StockDepotReview.id.desc())
        .first()
    )
    if previous and (
        previous.decision == decision and previous.accounting == accounting
        and abs(previous.confirmed_quantity - quantity) < 1e-9 and previous.pcm == pcm
        and previous.warehouse == warehouse and previous.evidence == evidence
    ):
        return _view(previous)

    record = StockDepotReview(
        scenario_id=report["scenario_id"], stock_sha256=digest, candidate_id=identifier,
        material=material["material"], depot=candidate["depot"],
        center=candidate.get("center") or "", unit=candidate["unit"],
        decision=decision, accounting=accounting, confirmed_quantity=quantity,
        pcm=pcm, warehouse=warehouse, evidence=evidence,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _view(record)
