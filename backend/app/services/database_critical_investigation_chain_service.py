from __future__ import annotations

"""Encadeamento auditável: críticos -> critérios -> déficits -> investigação de PN.

Dados são sempre relidos das entidades do workspace atual. O contexto armazena
apenas foco e códigos de um ranking, nunca os cálculos/valores do mês.
"""

import math
import re
import unicodedata

from app.services.database_answer_service import (
    DatabaseKnowledgeAnswer, _format_number, _critical_rule_chunks, _critical_materials_answer,
    _runtime_chunk,
)
from app.services.dpp_projection_service import CRITICAL_BALANCE_TOLERANCE
from app.services.knowledge_service import KnowledgeChunk
from app.services.rag_runtime_service import load_runtime_entities


CRITICAL_SOURCE = "sqlite://rag_runtime_entities/material/scenario"
RULE_SOURCE = "regras-globais.md"
ORDINALS = {
    "primeiro": 1, "primeira": 1, "segundo": 2, "segunda": 2,
    "terceiro": 3, "terceira": 3, "quarto": 4, "quarta": 4,
    "quinto": 5, "quinta": 5, "sexto": 6, "sexta": 6,
    "setimo": 7, "setima": 7, "oitavo": 8, "oitava": 8,
    "nono": 9, "nona": 9, "decimo": 10, "decima": 10,
}


def _normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in text if not unicodedata.combining(char))


def _number(value: object) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _critical_records() -> list[dict]:
    result = []
    for record in load_runtime_entities(entity_type="material", scope="scenario"):
        p = record["payload"]
        balance = _number(p.get("balance"))
        if str(p.get("um") or "").upper() == "UN" and balance is not None and balance < -CRITICAL_BALANCE_TOLERANCE:
            result.append(record)
    return sorted(result, key=lambda r: (float(r["payload"]["balance"]), r["entity_key"]))


def _chain(context: dict) -> dict:
    value = context.get("investigation_chain")
    return dict(value) if isinstance(value, dict) and value.get("scope") == "critical" else {}


def _explicit_pn(question: str) -> str | None:
    # Reconhece apenas chaves completas do workspace, nunca um prefixo de PN.
    matches = []
    for record in load_runtime_entities(entity_type="material", scope="scenario"):
        pn = str(record["entity_key"])
        if re.search(rf"(?<![a-zA-Z0-9_-]){re.escape(pn)}(?![a-zA-Z0-9_-])", question, re.IGNORECASE):
            matches.append(pn)
    return max(matches, key=len) if matches else None


def _ordinal(question: str) -> int | None:
    q = _normalize(question)
    for label, index in ORDINALS.items():
        if re.search(rf"\b{label}\b", q):
            return index
    match = re.search(r"\b(?:item|pn|posicao|numero|n[º°])\s*(\d{1,2})\b", q)
    return int(match.group(1)) if match else None


def _limit(question: str) -> int:
    q = _normalize(question)
    match = re.search(r"\b(?:top|os|as|primeiros?|primeiras?|maiores?|piores?)\s*(\d{1,3})\b", q)
    return max(1, min(int(match.group(1)), 50)) if match else 5


def _critical_list_requested(question: str) -> bool:
    """Consulta por PNs que satisfazem REGRA-004 != pergunta sobre texto da regra."""
    q = _normalize(question)
    if not re.search(r"\bregra[\s_-]*004\b", q):
        return False
    has_materials = bool(re.search(r"\b(?:materiais|material|itens|item|pns?|componentes)\b", q))
    asks_records = bool(re.search(
        r"\b(?:consulta|consulte|consultar|liste|listar|lista|listagem|"
        r"mostre|mostrar|exiba|exibir|relacione|identifique|"
        r"quais|quantos|retorne|apresente|encontre|atendem|enquadram)\b",
        q,
    ))
    # "O que é a REGRA-004?" permanece sob consulta à definição da regra.
    return has_materials and asks_records


def _critical_list_answer(question: str) -> DatabaseKnowledgeAnswer:
    if not load_runtime_entities(entity_type="scenario_summary", scope="scenario"):
        return _answer(
            question,
            "O Cenário ORION não está sincronizado; não é possível listar os materiais que atendem à REGRA-004.",
            [], topic="critical_unavailable",
        )
    result = _critical_materials_answer("Quais materiais estão críticos?")
    if result is None:
        raise RuntimeError("Consulta determinística de materiais críticos indisponível.")
    result.resolved_question = question
    # A tabela é derivada da consulta atual; o contexto seleciona a coleção,
    # não a regra e nem o último PN da tabela.
    result.context.update({
        "subject_type": "collection", "subject_key": "materiais críticos",
        "topic": "critical",
        "investigation_chain": {
            "scope": "critical", "stage": "critical_collection",
            "ranking": [], "selected_pn": "",
        },
        "skip_llm": True,
    })
    return result


def _ranking_requested(question: str, context: dict) -> bool:
    q = _normalize(question)
    ranking = any(word in q for word in ("maior", "piores", "pior", "top ", "ranking", "ordene", "ordenar"))
    deficit = any(word in q for word in ("deficit", "falta", "negativo", "saldo", "critic", "gargalo"))
    # Ao perguntar "mostre os cinco maiores" sobre materiais críticos, a coleção
    # permanece o referencial. Não reinterpretar rankings de outros assuntos.
    short_followup = bool(_chain(context)) and bool(
        re.search(r"\b(?:maiores|piores|top\s*\d+)\b", q)
    ) and len(q.split()) <= 9
    return (ranking and deficit) or short_followup


def _count_requested(question: str, context: dict) -> bool:
    if not _chain(context):
        return False
    q = _normalize(question).strip(" ?.! ")
    return bool(re.search(
        r"^(?:explique|explica|detalhe|justifique|mostre|como foi feita|como chegou|"
        r"por que|porque|de onde veio|qual o criterio|qual e o criterio|"
        r"como o orion chegou).{0,100}"
        r"(?:contagem|criterio|criterios)(?:\b|$)",
        q,
    ))


def _detail_requested(question: str, context: dict) -> tuple[bool, str | None, str | None]:
    q = _normalize(question)
    explicit = _explicit_pn(question)
    # Apenas verbos de detalhamento: campo específico como "SALDO do PN X"
    # continua resolvido pelo executor de materiais, sem sequestrar a intenção.
    is_detail = bool(re.search(
        r"\b(?:investig\w*|detalh\w*|analise|analisar|"
        r"aprofund\w*|diagnostic\w*|me fale sobre|fale sobre|"
        r"o que sabemos sobre|mostre os dados d[eo]|me conte sobre)\b", q,
    ))
    if not is_detail:
        return False, None, None

    if explicit:
        return True, explicit, None

    # Um código informado mas ausente do cenário não pode se tornar a posição
    # anterior nem provocar a escolha silenciosa de outro material.
    if re.search(r"\b(?:pn|material)\s+[a-z0-9]+(?:-[a-z0-9]+)+\b", q):
        return True, None, "O PN solicitado não foi localizado no Cenário ORION atual; confira o código."

    chain = _chain(context)
    if not chain:
        if _ordinal(question) is not None or re.search(r"\b(?:esse|essa|este|esta)\s+(?:pn|material|item)\b", q):
            return True, None, "Não há seleção ativa nesta sessão. Informe o PN ou solicite primeiro um ranking de déficits."
        return False, None, None

    position = _ordinal(question)
    if position is not None:
        ranking = chain.get("ranking") or []
        if 1 <= position <= len(ranking):
            return True, str(ranking[position - 1]), None
        return True, None, (
            f"A posição {position} não está no último ranking desta sessão. "
            "Solicite outro ranking ou informe um PN explícito."
        )

    if re.search(r"\b(?:esse|essa|este|esta|dele|desse|deste)\s+(?:pn|material|item)\b", q):
        selected = str(chain.get("selected_pn") or "")
        if selected:
            return True, selected, None
        return True, None, (
            "A lista anterior possui vários materiais. Informe o PN ou a posição "
            "do ranking; não é seguro escolher um item automaticamente."
        )
    return False, None, None


def _answer(
    question: str, answer: str, records: list[dict], *,
    topic: str, selected: str = "", ranking: list[str] | None = None,
    table: dict | None = None, extra_sources: list[str] | None = None,
) -> DatabaseKnowledgeAnswer:
    sources = ([CRITICAL_SOURCE] if records or load_runtime_entities(entity_type="scenario_summary", scope="scenario") else []) + (extra_sources or [])
    sources.extend(record["source"] for record in records[:8] if record.get("source"))
    sources = list(dict.fromkeys(sources))
    context = {
        "subject_type": "material" if selected else "collection",
        "subject_key": selected or "materiais críticos",
        "topic": topic,
        "investigation_chain": {
            "scope": "critical",
            "stage": topic,
            "ranking": ranking or [],
            "selected_pn": selected or "",
        },
        "structured_evidence_complete": True,
        "skip_llm": True,
    }
    chunks = [_runtime_chunk(record, f"PN {record['entity_key']} · {topic}") for record in records[:5]]
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=sources,
        chunks=chunks,
        entities=[selected] if selected else [],
        table=table,
        resolved_question=question,
        context=context,
    )


def _ranking_answer(question: str) -> DatabaseKnowledgeAnswer:
    summary = load_runtime_entities(entity_type="scenario_summary", scope="scenario")
    if not summary:
        return _answer(question, "O Cenário ORION não está sincronizado. Não é possível ordenar déficits sem os dados atuais.", [], topic="critical_unavailable")
    all_critical = _critical_records()
    n = _limit(question)
    records = all_critical[:n]
    rows = []
    for index, item in enumerate(records, 1):
        p = item["payload"]
        balance = float(p["balance"])
        rows.append({
            "position": index,
            "material": item["entity_key"],
            "description": p.get("description") or "—",
            "um": p.get("um") or "—",
            "balance": _format_number(balance),
            "deficit": _format_number(-balance),
        })
    answer = (
        f"**Fatos:** {len(all_critical)} PN(s) críticos no Cenário ORION vigente; "
        f"os {len(rows)} maiores déficits aparecem em ordem decrescente de falta na tabela.\n\n"
        "**Cálculo:** criticidade = UM igual a UN e SALDO inferior a -0,0001 (REGRA-004). "
        "Déficit inicial do PN = max(0, -SALDO ORION); o SALDO já foi calculado pelo motor Python.\n\n"
        "**Interpretação:** maior déficit contábil indica prioridade de investigação, "
        "não prova falta física, causa raiz nem necessidade automática de compra. "
        "Depósitos M221/P277 e CQ exigem evidências e validação humana."
    )
    return _answer(
        question, answer, records, topic="critical_ranking",
        ranking=[record["entity_key"] for record in records],
        table={
            "title": f"Maiores déficits · Cenário ORION (top {len(rows)})",
            "total_rows": len(rows),
            "columns": [
                {"key": "position", "label": "Posição", "align": "right"},
                {"key": "material", "label": "PN", "kind": "code"},
                {"key": "description", "label": "Descrição"},
                {"key": "um", "label": "UM"},
                {"key": "balance", "label": "SALDO ORION", "align": "right"},
                {"key": "deficit", "label": "Déficit inicial", "align": "right"},
            ],
            "rows": rows,
        },
        extra_sources=[RULE_SOURCE],
    )


def _count_answer(question: str, context: dict) -> DatabaseKnowledgeAnswer:
    if not load_runtime_entities(entity_type="scenario_summary", scope="scenario"):
        return _answer(question, "O Cenário ORION não está sincronizado; a contagem atual é indisponível.", [], topic="critical_unavailable")
    records = _critical_records()
    explanation = (
        "**Fatos:** a consulta do Cenário ORION atual encontrou "
        f"{len(records)} PN(s) com UM = UN e SALDO inferior a -0,0001.\n\n"
        "**Cálculo determinístico:** REGRA-001: NEC = soma do REAL de cada modelo multiplicado pelo consumo. "
        "REGRA-002: STK TTL = STK SAP efetivo + EXPLOSÃO + STK OP. "
        "REGRA-003: SALDO = STK TTL - NEC. REGRA-004: conta somente PN único com UM = UN "
        "e SALDO < -0,0001. O Python calcula; o SQLite consulta e conta os materiais.\n\n"
        "**Interpretação:** essa contagem indica quantos PNs precisam ser investigados "
        "no cenário, não quantos itens foram comprovadamente perdidos nem quantas compras realizar."
    )
    response = _answer(
        question, explanation, records[:5], topic="critical_count",
        ranking=_chain(context).get("ranking") or [], extra_sources=[RULE_SOURCE],
    )
    response.chunks.extend(_critical_rule_chunks())
    return response


def _investigation_summary(area: str, pn: str) -> tuple[str, list[dict]]:
    records = load_runtime_entities(entity_type="investigation_material", entity_key=pn, scope=area)
    if not records:
        return f"{'Estoque' if area == 'stock' else 'Qualidade'}: relatório deste PN não sincronizado; resultado indisponível (não é zero).", []
    p = records[0]["payload"]
    candidates = p.get("candidates") or []
    if area == "stock":
        deposits = ", ".join(sorted({str(c.get("depot")) for c in candidates if c.get("depot")})) or "sem registros"
        gap = p.get("unexplained_quantity")
        applied = p.get("recovered_quantity_applied")
        label = "Estoque M221/P277"
        detail = f"depósitos {deposits}; quantidade aplicada ao déficit {_format_number(applied)}; falta sem explicação {_format_number(gap)}."
    else:
        label = "CQ Q239/Q273"
        detail = (
            f"depósito ativo {p.get('active_depot') or 'nenhum'}; liberação aplicada ao déficit "
            f"{_format_number(p.get('quality_released_applied'))}; falta sem explicação "
            f"{_format_number(p.get('unexplained_after_quality'))}; "
            f"Q273 paralelo informativo {p.get('q273_records_skipped_due_q239') or 0} registro(s)."
        )
    pending = sum(1 for c in candidates if not c.get("validation"))
    return f"{label}: {detail} Validações pendentes: {pending}; situação: {p.get('workflow_status') or 'não informada'}.", records


def _detail_answer(question: str, pn: str, ranking: list[str]) -> DatabaseKnowledgeAnswer:
    current = load_runtime_entities(entity_type="material", entity_key=pn, scope="scenario")
    if not current:
        return _answer(question, f"O PN {pn} não está presente no Cenário ORION vigente; não reutilizei dados de outro cenário.", [], topic="critical_unavailable")
    record = current[0]
    p = record["payload"]
    balance = _number(p.get("balance"))
    nec = _number(p.get("nec"))
    stock_total = _number(p.get("stock_total"))
    is_critical = str(p.get("um") or "").upper() == "UN" and balance is not None and balance < -CRITICAL_BALANCE_TOLERANCE
    state = "crítico" if is_critical else "não crítico"
    fact = (
        f"**Fatos — PN {pn}:** {p.get('description') or 'sem descrição'}. "
        f"UM {p.get('um') or '—'}; NEC {_format_number(nec)}; "
        f"STK TTL {_format_number(stock_total)}; SALDO ORION {_format_number(balance)}; "
        f"status {p.get('status') or '—'}; enquadramento REGRA-004: {state}."
    )
    if balance is None:
        calc = "**Cálculo:** o SALDO não está disponível no cenário; não é possível determinar o déficit."
    else:
        calc = (
            "**Cálculo:** SALDO = STK TTL - NEC (REGRA-003). "
            f"Déficit inicial calculado a partir do SALDO sincronizado: {_format_number(max(0, -balance))} "
            f"{p.get('um') or ''}."
        )
        if stock_total is not None and nec is not None:
            if abs((stock_total - nec) - balance) <= CRITICAL_BALANCE_TOLERANCE:
                calc += f" Conferência: {_format_number(stock_total)} - {_format_number(nec)} = {_format_number(balance)}."
            else:
                calc += " Atenção: STK TTL - NEC não coincide com o SALDO sincronizado; os valores exigem conferência."
    final = load_runtime_entities(entity_type="material", entity_key=pn, scope="final")
    if final:
        fact += f" DPP Final: SALDO {_format_number(final[0]['payload'].get('balance'))} (referência comparativa, não substitui o cenário)."
    stock_text, stock_records = _investigation_summary("stock", pn)
    quality_text, quality_records = _investigation_summary("quality", pn)
    interpretation = (
        "**Interpretação / pendências:** " + stock_text + " " + quality_text + " "
        "O valor bruto do depósito não é recuperação confirmada. "
        "Sem validação registrada, não é possível atribuir causa, disponibilidade física ou liberação."
    )
    sources = [RULE_SOURCE] + [item["source"] for item in [*final, *stock_records, *quality_records]]
    response = _answer(
        question, "\n\n".join([fact, calc, interpretation]),
        [record, *final, *stock_records, *quality_records],
        topic="critical_material_detail", selected=pn, ranking=ranking,
        extra_sources=sources,
    )
    response.table = {
        "title": f"PN {pn} · fatos do Cenário ORION",
        "total_rows": 1,
        "columns": [
            {"key": "material", "label": "PN", "kind": "code"},
            {"key": "description", "label": "Descrição"},
            {"key": "um", "label": "UM"},
            {"key": "nec", "label": "NEC", "align": "right"},
            {"key": "stock_total", "label": "STK TTL", "align": "right"},
            {"key": "balance", "label": "SALDO ORION", "align": "right"},
            {"key": "deficit", "label": "Déficit inicial", "align": "right"},
        ],
        "rows": [{
            "material": pn,
            "description": p.get("description") or "—",
            "um": p.get("um") or "—",
            "nec": _format_number(nec),
            "stock_total": _format_number(stock_total),
            "balance": _format_number(balance),
            "deficit": _format_number(max(0, -balance)) if balance is not None else "—",
        }],
    }
    return response


def answer_critical_investigation_chain(question: str, context: dict | None = None) -> DatabaseKnowledgeAnswer | None:
    context = context or {}
    if _critical_list_requested(question):
        return _critical_list_answer(question)
    if _ranking_requested(question, context):
        return _ranking_answer(question)
    if _count_requested(question, context):
        return _count_answer(question, context)
    is_detail, pn, error = _detail_requested(question, context)
    if not is_detail:
        return None
    if error:
        return _answer(question, error, [], topic="critical_selection_required",
                       ranking=_chain(context).get("ranking") or [])
    if pn:
        return _detail_answer(question, pn, _chain(context).get("ranking") or [])
    return None


def carry_investigation_chain(question: str, context: dict, knowledge: DatabaseKnowledgeAnswer) -> None:
    """Conserva foco entre respostas existentes; nunca persiste números antigos."""
    if knowledge.context.get("investigation_chain"):
        return
    old = _chain(context)
    subject_type = str(knowledge.context.get("subject_type") or "")
    subject_key = str(knowledge.context.get("subject_key") or "")
    if subject_type == "collection" and subject_key == "materiais críticos":
        knowledge.context["investigation_chain"] = {
            "scope": "critical", "stage": "critical_collection", "ranking": [], "selected_pn": "",
        }
    elif old and subject_type == "material" and subject_key:
        if load_runtime_entities(entity_type="material", entity_key=subject_key, scope="scenario"):
            old["selected_pn"] = subject_key
            old["stage"] = "critical_material"
            knowledge.context["investigation_chain"] = old
    elif old and subject_type in {"utility", "concept", "rule", "status", "knowledge"}:
        # Uma definição ou pergunta de calendário não seleciona um PN e não
        # invalida a investigação em andamento.
        knowledge.context["investigation_chain"] = old
