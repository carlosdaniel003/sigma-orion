"""Validation register and read-only gap projection for stock investigation 4.1.

No stock movement, DPP SALDO, REAL or NEC is ever changed by this service.
"""
from __future__ import annotations

from hashlib import sha256
import json
import math

from sqlalchemy.orm import Session

from app.models.stock_depot_review import StockDepotReview

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
    for material in report["materials"]:
        increment = 0.0
        for candidate in material["candidates"]:
            identifier = candidate_id(report, material, candidate, digest)
            versions = by_candidate.get(identifier, [])
            current = versions[-1] if versions else None
            candidate["candidate_id"] = identifier
            candidate["validation_history"] = versions
            candidate["validation"] = current
            if current:
                reviewed += 1
                candidate["validation_status"] = ("CONFIRMADO_DISPONIVEL" if current["decision"] == "AVAILABLE" else "CONFIRMADO_INDISPONIVEL")
                if current["decision"] == "AVAILABLE" and current["accounting"] == "NOT_INCLUDED":
                    increment += current["confirmed_quantity"]
        gap = material["negative_balance"]
        material["confirmed_increment_outside_dpp"] = increment
        material["gap_reduction_projected"] = min(gap, increment)
        material["projected_gap_remaining"] = max(0.0, gap - increment)
        if increment > 0:
            projected += 1
    report["summary"]["candidates_reviewed"] = reviewed
    report["summary"]["materials_with_projection"] = projected
    report["gap_projection_is_official"] = False
    report["changes_dpp"] = False
    report["note"] = (
        "Gap projetado somente para quantidades declaradas disponíveis e ainda não "
        "contabilizadas no DPP. Esta projeção não altera STK TTL, NEC, SALDO ou REAL. "
        "A validação é um registro manual sem identificação obrigatória e sem autenticação."
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
        if quantity != 0 or accounting != "UNKNOWN":
            raise ValueError("Indisponibilidade exige quantidade zero e contabilização desconhecida.")
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
        raise ValueError("Quantidade confirmada supera o estoque sob verificação nesse depósito.")
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
