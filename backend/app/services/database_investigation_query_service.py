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


def _specific_material_request(question: str, context: dict, records: list[dict]) -> tuple[str | None, bool]:
    """Resolve PN explícito ou pronome singular sem usar uma lista como seleção.

    A ausência do PN no relatório atual da área NÃO permite cair na listagem
    da área; deve gerar uma resposta individual sobre a falta de evidência.
    """
    q = _normalize(question)
    scenario = load_runtime_entities(entity_type="material", scope="scenario")
    explicit = _material_key(question, scenario) or _material_key(question, records)
    if explicit:
        return explicit, True

    if re.search(r"\b(?:quais|quantos|quantas|todos|todas|liste|lista|listagem)\b", q):
        return None, False
    if any(term in q for term in (
        "encontrados em cq", "encontrados em estoque", "aguardando cq",
        "aguardando almoxarifado", "resumo operacional",
    )):
        return None, False

    # Detecta referências inequívocas a um único PN, sem inferir o último
    # registro de tabelas agregadas nem o primeiro material do relatório.
    singular_reference = bool(re.search(
        r"\b(?:esse|essa|este|esta|desse|dessa|deste|desta|"
        r"nesse|nessa|neste|nesta|aquele|daquele|dele)\s+"
        r"(?:pn|material|item)\b|\b(?:esse|este|desse|deste|aquele)\s+pn\b",
        q,
    ))
    # "E na Qualidade?" após selecionar um único PN também é contextual,
    # mas nunca deve transformar uma pergunta plural em detalhe individual.
    area_followup = bool(re.fullmatch(
        r"(?:e )?(?:na|em|sobre a|no setor de) "
        r"(?:qualidade|cq|estoque|almoxarifado)(?: para ele| desse pn)?",
        q.strip(" ?.! "),
    ))
    if not singular_reference and not area_followup:
        return None, False

    chain = context.get("investigation_chain") or {}
    selected = str(context.get("subject_key") or "").strip() if context.get("subject_type") == "material" else ""
    if not selected and isinstance(chain, dict):
        selected = str(chain.get("selected_pn") or "").strip()
    if not selected:
        return None, True
    if not any(record["entity_key"].casefold() == selected.casefold() for record in scenario):
        return None, True
    return selected, True


def _single_pn_unavailable(question: str, area: str, pn: str | None, summary: dict | None) -> DatabaseKnowledgeAnswer:
    """Não confunde PN ausente em CQ com CQ não sincronizado ou com zero físico."""
    label = "Análise de Qualidade (Q239/Q273)" if area == "quality" else "Divergência de Estoque (M221/P277)"
    sources = [summary] if summary else []
    if not pn:
        answer = (
            f"Não foi possível identificar um PN único para consultar {label}. "
            "Informe o código do PN ou selecione um item do ranking anterior. "
            "Não utilizei um material arbitrário da listagem."
        )
    elif not summary:
        answer = (
            f"A investigação de {label} não está sincronizada no cenário atual. "
            f"Não é possível afirmar a situação do PN {pn} nesta área; ausência de relatório não significa zero."
        )
    else:
        answer = (
            f"No relatório atual de {label}, não há registro individual do PN {pn}. "
            "Isso significa apenas que o PN não aparece nesta investigação sincronizada; "
            "não comprova ausência física no depósito nem disponibilidade, liberação ou refugo."
        )
        # Quando o PN ainda aguarda análise de Estoque, não atribuir ao CQ
        # uma conclusão que pertence à etapa anterior.
        if area == "quality":
            stock = load_runtime_entities(entity_type="investigation_material", entity_key=pn, scope="stock")
            if stock:
                sources.extend(stock)
                item = stock[0]["payload"]
                status = str(item.get("workflow_status") or "não informado")
                pending = sum(not bool(c.get("validation")) for c in item.get("candidates") or [])
                answer += (
                    f" Na Divergência de Estoque, situação: {status}; "
                    f"validações pendentes: {pending}. "
                    "As evidências de Estoque não são registros de liberação no CQ."
                )
    response = _answer(
        answer, sources, question, area=area,
        category="material_unavailable", table=None,
    )
    if pn:
        response.context.update({
            "subject_type": "material", "subject_key": pn, "investigation_area": area,
        })
        response.entities = [pn]
    return response


def answer_investigation_question(
    question: str,
    context: dict | None = None,
    *,
    original_question: str | None = None,
) -> DatabaseKnowledgeAnswer | None:
    context = context or {}
    raw_question = original_question or question
    area = _requested_area(raw_question, context)
    if area is None:
        return None
    if area == "overview":
        return _overview(question)

    records = _records(area)
    explicit_material, individual_request = _specific_material_request(raw_question, context, records)
    summary = _summary(area)
    if individual_request and (explicit_material is None or not any(
        record["entity_key"].casefold() == explicit_material.casefold() for record in records
    )):
        return _single_pn_unavailable(question, area, explicit_material, summary)

    if summary is None:
        label = "Análise de Qualidade" if area == "quality" else "Divergência de Estoque"
        return _answer(
            f"O relatório de {label} não está sincronizado para o cenário DPP atual. "
            "Abra o Dashboard e conclua o carregamento automático da investigação; não é possível afirmar que há zero PNs.",
            [], question, area=area, category="unavailable",
        )

    # Mantém correspondência exata com a chave armazenada no relatório.
    if explicit_material:
        explicit_material = next(
            record["entity_key"] for record in records
            if record["entity_key"].casefold() == explicit_material.casefold()
        )
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
