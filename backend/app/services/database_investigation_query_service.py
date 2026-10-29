from __future__ import annotations

import re
import unicodedata

from app.services.database_answer_service import (
    DatabaseKnowledgeAnswer,
    _format_number,
    _runtime_chunk,
)
from app.services.rag_runtime_service import load_runtime_entities


def _normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").lower())
    return "".join(char for char in text if not unicodedata.combining(char))


def _records(area: str) -> list[dict]:
    return load_runtime_entities(entity_type="investigation_material", scope=area)


def _summary(area: str) -> dict | None:
    records = load_runtime_entities(entity_type="investigation_summary", entity_key=area)
    return records[0] if records else None


def _requested_area(question: str, context: dict) -> str | None:
    q = _normalize(question)
    if "resumo operacional" in q or ("investigac" in q and any(term in q for term in ("painel", "dashboard", "resumo"))):
        return "overview"
    if "encaminhad" in q and "qualidade" in q:
        # Este é um indicador da etapa 4.1, não o grupo "recebidos" de CQ.
        return "stock"
    if any(term in q for term in ("q239", "q273", "qualidade", "controle de qualidade", "encontrados em cq", "aguardando cq", "refugo")) or re.search(r"\bcq\b", q):
        return "quality"
    if any(term in q for term in ("m221", "p277", "almoxarifado", "divergencia de estoque", "encontrados em estoque", "depositos de estoque")):
        return "stock"
    if any(term in q for term in ("investigacao", "investigacoes", "deposito", "depositos", "encontrados", "pendentes")):
        subject = str(context.get("subject_key") or "")
        if subject.startswith("investigation:"):
            return subject.split(":", 1)[1]
    return None


def _category(area: str, question: str) -> str:
    q = _normalize(question)
    if "sem registro" in q or "nao encontrado" in q:
        return "missing"
    if "aguardando" in q or "pendente" in q:
        return "pending"
    if area == "stock":
        if "encaminhad" in q:
            return "forwarded"
        if "critic" in q or "todos" in q:
            return "critical"
        return "found"
    if "q239" in q and "q273" not in q:
        return "q239"
    if "q273" in q and "q239" not in q:
        return "q273"
    if "recebid" in q or "todos" in q:
        return "received"
    return "found"


def _members(area: str, category: str, records: list[dict]) -> list[dict]:
    def matches(record: dict) -> bool:
        item = record["payload"]
        candidates = item.get("candidates") or []
        if area == "quality":
            active = item.get("active_depot")
            return {
                "found": active in {"Q239", "Q273"},
                "received": True,
                "q239": active == "Q239",
                "q273": active == "Q273",
                "pending": any(not c.get("validation") for c in candidates),
                "missing": not active,
            }.get(category, False)
        return {
            "found": bool(candidates),
            "critical": True,
            "pending": any(not c.get("validation") for c in candidates),
            "missing": not candidates,
            "forwarded": bool(item.get("forwarded_to_quality")),
        }.get(category, False)

    return sorted(
        (record for record in records if matches(record)),
        key=lambda record: str(record["entity_key"]),
    )


def _material_key(question: str, records: list[dict]) -> str | None:
    for record in sorted(records, key=lambda item: -len(str(item["entity_key"]))):
        key = str(record["entity_key"])
        if re.search(rf"(?<![\w]){re.escape(key)}(?![\w])", question, flags=re.IGNORECASE):
            return key
    return None


def _number(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _material_row(area: str, record: dict) -> dict:
    item = record["payload"]
    candidates = item.get("candidates") or []
    base = {
        "material": record["entity_key"],
        "description": item.get("description") or "—",
        "unit": item.get("unit") or "—",
        "depot": (item.get("active_depot") if area == "quality" else
                  ", ".join(sorted({str(c.get("depot")) for c in candidates}))) or "Sem registros",
        "quantity": _format_number(sum(_number(c.get("quantity")) for c in candidates)),
        "pending": sum(not bool(c.get("validation")) for c in candidates),
        "status": item.get("workflow_status") or "—",
    }
    base["gap"] = _format_number(
        item.get("unexplained_after_quality") if area == "quality" else
        item.get("unexplained_quantity", item.get("negative_balance"))
    )
    return base


def _table(title: str, rows: list[dict], *, total: int) -> dict:
    columns = [
        {"key": "material", "label": "PN", "kind": "code"},
        {"key": "description", "label": "Descrição", "kind": "description"},
        {"key": "unit", "label": "UM"},
        {"key": "depot", "label": "Depósito ativo"},
        {"key": "quantity", "label": "Quantidade bruta", "align": "right"},
        {"key": "gap", "label": "Falta sem explicação", "align": "right"},
        {"key": "pending", "label": "Validações pendentes", "align": "right"},
        {"key": "status", "label": "Situação"},
    ]
    return {"title": title, "total_rows": total, "columns": columns, "rows": rows}


def _answer(answer: str, records: list[dict], question: str, *, area: str,
            category: str, table: dict | None = None) -> DatabaseKnowledgeAnswer:
    evidence = records[:8]
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=list(dict.fromkeys(record["source"] for record in records[:30])),
        chunks=[_runtime_chunk(record, f"Investigação {area} · PN {record['entity_key']}") for record in evidence],
        entities=[record["entity_key"] for record in records[:30]],
        table=table,
        resolved_question=question,
        context={
            "subject_type": "collection",
            "subject_key": f"investigation:{area}",
            "topic": category,
            "structured_evidence_complete": True,
            "skip_llm": True,
        },
    )


def _overview(question: str) -> DatabaseKnowledgeAnswer:
    stock = _summary("stock")
    quality = _summary("quality")
    if not stock and not quality:
        return _answer("As investigações do Dashboard ainda não foram sincronizadas para o cenário atual.",
                       [], question, area="overview", category="overview")
    stock_records = _records("stock") if stock else []
    quality_records = _records("quality") if quality else []
    stock_count = len(_members("stock", "found", stock_records)) if stock else None
    quality_count = len(_members("quality", "found", quality_records)) if quality else None
    quantities = [
        ("PNs negativos", len(stock_records) if stock else None),
        ("Encontrados em Estoque (M221/P277)", stock_count),
        ("Aguardando Almoxarifado", len(_members("stock", "pending", stock_records)) if stock else None),
        ("Encaminhados à Qualidade", len(_members("stock", "forwarded", stock_records)) if stock else None),
        ("Encontrados em CQ (Q239/Q273 ativos)", quality_count),
        ("Aguardando Qualidade", len(_members("quality", "pending", quality_records)) if quality else None),
    ]
    table = {
        "title": "Resumo operacional das investigações",
        "total_rows": len(quantities),
        "columns": [{"key": "indicator", "label": "Indicador"}, {"key": "value", "label": "PNs", "align": "right"}],
        "rows": [{"indicator": name, "value": number if number is not None else "Indisponível"} for name, number in quantities],
    }
    records = [record for record in (stock, quality) if record]
    answer = ("Resumo do cenário atual, baseado nos mesmos grupos de PNs do Dashboard. "
              "Indicador indisponível significa investigação não sincronizada, não zero. "
              "Quantidades de depósito são evidências e não liberações automáticas.")
    response = _answer(answer, records, question, area="overview", category="overview", table=table)
    return response


def answer_investigation_question(question: str, context: dict | None = None) -> DatabaseKnowledgeAnswer | None:
    area = _requested_area(question, context or {})
    if area is None:
        return None
    if area == "overview":
        return _overview(question)

    summary = _summary(area)
    if summary is None:
        label = "Análise de Qualidade" if area == "quality" else "Divergência de Estoque"
        return _answer(
            f"O relatório de {label} não está sincronizado para o cenário DPP atual. "
            "Abra o Dashboard e conclua o carregamento automático da investigação; não é possível afirmar que há zero PNs.",
            [], question, area=area, category="unavailable",
        )

    records = _records(area)
    explicit_material = _material_key(question, records)
    # Retoma um PN previamente selecionado, nunca um item arbitrário da tabela.
    context = context or {}
    previous_pn = str(context.get("subject_key") or "") if context.get("subject_type") == "material" else ""
    normalized_question = _normalize(question)
    plural_request = bool(re.search(r"\b(quais|todos|todas|lista|liste|quantos|quantas)\b", normalized_question))
    explicit_other_pn = bool(re.search(r"\b(?:pn|material)\s+[a-z0-9]+(?:-[a-z0-9]+)+\b", normalized_question))
    if not explicit_material and previous_pn and not plural_request and not explicit_other_pn and len(normalized_question.split()) <= 12:
        if any(record["entity_key"].casefold() == previous_pn.casefold() for record in records):
            explicit_material = next(record["entity_key"] for record in records if record["entity_key"].casefold() == previous_pn.casefold())
    if explicit_material:
        record = next(record for record in records if record["entity_key"] == explicit_material)
        item = record["payload"]
        rows = [_material_row(area, record)]
        candidates = item.get("candidates") or []
        details = "; ".join(
            f"{c.get('depot')}/{c.get('center') or 'sem centro'}: "
            f"{_format_number(c.get('quantity'))} {item.get('unit') or ''}, "
            f"{'pendente' if not c.get('validation') else 'validado (' + str(c['validation'].get('decision')) + ')'}, "
            f"quantidade confirmada {_format_number((c.get('validation') or {}).get('confirmed_quantity'))}, "
            f"contabilização {(c.get('validation') or {}).get('accounting') or 'não informada'}, "
            f"linhas ORIGINAL {c.get('source_rows') or []}"
            for c in candidates
        ) or "Sem registros nos depósitos investigados"
        if area == "stock":
            values = (
                ("Déficit original", "negative_balance"),
                ("Disponibilidade confirmada fora do DPP, aplicada ao déficit", "recovered_quantity_applied"),
                ("Indisponibilidade justificada, aplicada ao déficit", "justified_unavailable_applied"),
                ("Gap físico projetado após Estoque", "projected_gap_remaining"),
                ("Falta ainda sem explicação", "unexplained_quantity"),
            )
        else:
            values = (
                ("Falta recebida da etapa 4.1", "gap_from_41"),
                ("Liberação CQ adicional, aplicada ao déficit", "quality_released_applied"),
                ("Reprovação CQ justificada, aplicada ao déficit", "quality_rejected_applied"),
                ("Refugo CQ comprovado, aplicado ao déficit", "quality_scrap_applied"),
                ("Gap físico após Qualidade", "physical_gap_after_quality"),
                ("Falta ainda sem explicação", "unexplained_after_quality"),
            )
        quantities = "; ".join(
            f"{label}: {_format_number(item[key])} {item.get('unit') or ''}"
            for label, key in values if item.get(key) is not None
        )
        note = (
            f"Q273 paralelo é apenas informativo ({item.get('q273_records_skipped_due_q239') or 0} registro(s)); "
            if area == "quality" and item.get("active_depot") == "Q239" else ""
        )
        answer = (
            f"PN {explicit_material}: {item.get('description') or 'sem descrição'}, "
            f"depósito(s): {rows[0]['depot']}; quantidade bruta {rows[0]['quantity']} {item.get('unit') or ''}. "
            f"Falta sem explicação: {rows[0]['gap']}; situação: {rows[0]['status']}; "
            f"validações pendentes: {rows[0]['pending']}. {note}"
            f"Registros: {details}. "
            f"{quantities}. Próxima etapa: {item.get('next_step') or 'não informada'}. "
            "Quantidade encontrada não equivale a material liberado ou saldo disponível."
        )
        response = _answer(answer, [record], question, area=area, category="material",
                           table=_table(f"Investigação do PN {explicit_material}", rows, total=1))
        response.context.update({"subject_type": "material", "subject_key": explicit_material,
                                 "investigation_area": area})
        return response

    category = _category(area, question)
    selected = _members(area, category, records)
    labels = {
        "stock": {"critical": "PNs críticos", "found": "PNs encontrados em Estoque (M221/P277)",
                  "pending": "Aguardando Almoxarifado", "missing": "Sem registros M221/P277",
                  "forwarded": "Encaminhados à Qualidade"},
        "quality": {"received": "PNs recebidos da etapa 4.1",
                    "found": "Encontrados em CQ (Q239/Q273 ativos)",
                    "q239": "Encontrados Q239", "q273": "Encontrados Q273 ativos",
                    "pending": "Aguardando CQ", "missing": "Sem registros Q239/Q273"},
    }
    title = labels[area][category]
    rows = [_material_row(area, record) for record in selected]
    note = (
        "No CQ, Q239 tem prioridade; Q273 só é ativo quando o PN não tem Q239. "
        "Q273 paralelo é evidência informativa e não entra na contagem. "
        if area == "quality" else
        "M221/P277 são depósitos investigados; registros não confirmam disponibilidade. "
    )
    answer = (
        f"{title}: {len(selected)} PN(s) no relatório atual do Dashboard. "
        + ("A relação integral está na tabela. " if selected else "Não há PNs nesse grupo no relatório sincronizado. ")
        + note + "Quantidades brutas e validações devem ser distinguidas da parcela comprovada atribuída ao déficit."
    )
    return _answer(answer, selected or [summary], question, area=area, category=category,
                   table=_table(title, rows, total=len(rows)))
