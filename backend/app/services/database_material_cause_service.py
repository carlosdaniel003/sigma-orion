from __future__ import annotations

"""Explica quantitativamente o porquê de um SALDO/NEC/divergência por PN.

A decomposição matemática não é apresentada como causa operacional.
Toda evidência é relida do Cenário ORION, DPP Final e investigações vigentes.
"""

import math
import re
import unicodedata

from app.services.database_answer_service import (
    DatabaseKnowledgeAnswer, _find_exact_entity_key, _format_number, _runtime_chunk,
)
from app.services.dpp_projection_service import CRITICAL_BALANCE_TOLERANCE
from app.services.knowledge_service import KnowledgeChunk
from app.services.rag_runtime_service import load_runtime_entities


def _normalize(value: object) -> str:
    raw = unicodedata.normalize("NFKD", str(value or "").casefold())
    return re.sub(r"[^a-z0-9_-]+", " ", "".join(c for c in raw if not unicodedata.combining(c))).strip()


def _num(value: object) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _selected_pn(question: str, context: dict) -> str | None:
    explicit = _find_exact_entity_key(question, "material")
    if explicit:
        return explicit
    normalized = _normalize(question)
    if not re.search(
        r"\b(?:esse|este|esta|desse|deste|dessa|desta|seu|dele|nele|nesse)\s+"
        r"(?:pn|material|item|saldo|deficit|necessidade)\b|\b(?:dele|nele)\b",
        normalized,
    ):
        return None
    key = str(context.get("subject_key") or "") if context.get("subject_type") == "material" else ""
    chain = context.get("investigation_chain") or {}
    if not key and isinstance(chain, dict):
        key = str(chain.get("selected_pn") or "")
    if key and load_runtime_entities(entity_type="material", entity_key=key, scope="scenario"):
        return key
    return None


def _matches(question: str) -> bool:
    q = _normalize(question)
    reason = any(x in q for x in (
        "por que", "porque", "qual a causa", "qual foi a causa",
        "como chegou", "de onde veio", "como foi calcul",
        "como se chegou", "qual o motivo", "explique", "justifique",
    ))
    field = any(x in q for x in (
        "saldo", "necessidade", "nec", "deficit", "falta", "diverg",
        "critico", "criticidade", "stk ttl", "estoque total",
    ))
    return reason and field


def _analysis_text(area: str, pn: str) -> tuple[str, list[dict]]:
    summary = load_runtime_entities(entity_type="investigation_summary", scope=area)
    records = load_runtime_entities(entity_type="investigation_material", entity_key=pn, scope=area)
    if not summary:
        return f"{'Estoque' if area == 'stock' else 'Qualidade'}: investigação não sincronizada (não equivale a zero).", []
    if not records:
        return f"{'Estoque' if area == 'stock' else 'Qualidade'}: PN ausente no relatório da área; não comprova falta física.", summary[:1]
    item = records[0]["payload"]
    candidates = item.get("candidates") or []
    pending = sum(not bool(c.get("validation")) for c in candidates)
    parts = [
        f"{'Estoque' if area == 'stock' else 'Qualidade'}: situação {item.get('workflow_status') or 'não informada'}",
        f"{pending} validação(ões) pendente(s)",
    ]
    if area == "stock":
        for key, label in (
            ("recovered_quantity_applied", "quantidade disponibilizada aplicada ao déficit"),
            ("unexplained_quantity", "falta ainda sem explicação"),
        ):
            if _num(item.get(key)) is not None:
                parts.append(f"{label}: {_format_number(item[key])}")
    else:
        for key, label in (
            ("quality_released_applied", "liberação CQ aplicada ao déficit"),
            ("unexplained_after_quality", "falta ainda sem explicação"),
        ):
            if _num(item.get(key)) is not None:
                parts.append(f"{label}: {_format_number(item[key])}")
    return "; ".join(parts) + ".", records


def answer_material_causes(question: str, context: dict | None = None) -> DatabaseKnowledgeAnswer | None:
    context = context or {}
    if not _matches(question):
        return None
    pn = _selected_pn(question, context)
    if not pn:
        return None
    current = load_runtime_entities(entity_type="material", entity_key=pn, scope="scenario")
    if not current:
        return None
    record = current[0]
    p = record["payload"]
    stock = _num(p.get("stock_total"))
    nec = _num(p.get("nec"))
    balance = _num(p.get("balance"))
    description = str(p.get("description") or "sem descrição")
    unit = str(p.get("um") or "não informada")
    status = str(p.get("status") or "não informado")
    parts = [
        f"**Fatos — PN {pn}:** {description}. UM {unit}; "
        f"NEC {_format_number(nec)}; STK TTL {_format_number(stock)}; "
        f"SALDO ORION {_format_number(balance)}; status {status}.",
    ]
    if balance is not None:
        formula = (
            "**Cálculo determinístico:** REGRA-003: SALDO = STK TTL − NEC. "
            f"Déficit inicial = max(0, −SALDO) = {_format_number(max(-balance, 0))} {unit}."
        )
        if stock is not None and nec is not None:
            if abs(stock - nec - balance) <= CRITICAL_BALANCE_TOLERANCE:
                formula += (
                    f" Conferência: {_format_number(stock)} − {_format_number(nec)} "
                    f"= {_format_number(balance)}."
                )
            else:
                formula += " Atenção: os componentes não conciliam com o SALDO sincronizado; a diferença precisa ser auditada."
        else:
            formula += " O detalhamento numérico de NEC/STK TTL está incompleto na base sincronizada."
        if unit.upper() == "UN":
            formula += (
                f" REGRA-004: {'crítico' if balance < -CRITICAL_BALANCE_TOLERANCE else 'não crítico'} "
                "conforme UM = UN e SALDO < -0,0001."
            )
        else:
            formula += " A REGRA-004 não classifica UM diferente de UN como material crítico nesta etapa."
        parts.append(formula)
    else:
        parts.append("**Cálculo:** SALDO indisponível; não é possível demonstrar déficit nem criticidade.")

    sources = [record["source"], "regras-globais.md"]
    records = [record]
    final = load_runtime_entities(entity_type="material", entity_key=pn, scope="final")
    if final:
        fp = final[0]["payload"]
        fb, fs, fn = _num(fp.get("balance")), _num(fp.get("stock_total")), _num(fp.get("nec"))
        compare = f"**Comparação com DPP Final:** SALDO Final {_format_number(fb)}."
        if fb is not None and balance is not None:
            compare += f" Diferença Final − ORION: {_format_number(fb - balance)}."
        if fs is not None and stock is not None and fn is not None and nec is not None:
            compare += (
                f" ΔSTK TTL {_format_number(fs - stock)}; "
                f"ΔNEC {_format_number(fn - nec)}; "
                "a variação matemática de SALDO decorre de ΔSTK TTL − ΔNEC. "
                "Isso não prova qual evento operacional provocou a diferença."
            )
        parts.append(compare)
        sources.extend(x["source"] for x in final)
        records.extend(final)

    st, sr = _analysis_text("stock", pn)
    qt, qr = _analysis_text("quality", pn)
    sources.extend(x["source"] for x in [*sr, *qr])
    records.extend([*sr, *qr])
    parts.append(
        "**Investigação e interpretação:** " + st + " " + qt +
        " Saldo negativo é um resultado matemático, não prova sozinho falta física, erro de cadastro, "
        "causa raiz ou necessidade de compra. Estoque bruto de depósito não é liberação validada; "
        "a confirmação humana continua obrigatória."
    )
    return DatabaseKnowledgeAnswer(
        answer="\n\n".join(parts),
        sources=list(dict.fromkeys(sources)),
        chunks=[
            *[_runtime_chunk(row, f"PN {pn} · evidência {row['scope']}") for row in records[:5]],
            KnowledgeChunk(
                source="regras-globais.md", category="deterministic", score=1000,
                heading="REGRA-003 / REGRA-004",
                content="SALDO = STK TTL - NEC; material crítico exige UM = UN e SALDO < -0,0001.",
            ),
        ],
        entities=[pn, "REGRA-003", "REGRA-004"],
        resolved_question=question,
        context={
            "subject_type": "material", "subject_key": pn,
            "topic": "material_causal_decomposition",
            "structured_evidence_complete": True, "skip_llm": True,
        },
    )
