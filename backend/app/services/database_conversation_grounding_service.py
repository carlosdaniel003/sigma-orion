from __future__ import annotations

import math
import re

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.database_query_planner_service import QueryPlan
from app.services.dpp_projection_service import CRITICAL_BALANCE_TOLERANCE
from app.services.dpp_rule_registry import known_rule_codes
from app.services.dpp_status_registry import get_status_definition, known_status_codes, status_evidence_text
from app.services.knowledge_service import KnowledgeChunk
from app.services.rag_runtime_service import load_runtime_entities


def _normalize(text: object) -> str:
    return re.sub(r"[^a-z0-9_.-]+", " ", str(text or "").lower()).strip()


def _format_number(value: object) -> str:
    if value in (None, ""):
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return str(value)
    if abs(number - round(number)) < 1e-9:
        return f"{int(round(number)):,}".replace(",", ".")
    text = f"{number:,.6f}".rstrip("0").rstrip(".")
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


def status_knowledge_answer(plan: QueryPlan) -> DatabaseKnowledgeAnswer | None:
    if not plan.status_entities:
        return None
    code = plan.status_entities[0]
    item = get_status_definition(code)
    if item is None:
        return None

    answer = (
        f"{item['code']}: {item['meaning']} "
        f"Condição determinística: {item['condition']} "
        f"{item['implication']} Regra associada: {item['rule']}."
    )
    source = f"deterministic://status-registry/{item['code']}"
    chunk = KnowledgeChunk(
        source=source,
        content=status_evidence_text(item["code"]),
        score=1000.0,
        heading=f"Status {item['code']} · regra determinística",
        category="deterministic",
    )
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=[source],
        chunks=[chunk],
        entities=[item["code"]],
        resolved_question=plan.resolved_question,
        context={
            "subject_type": "status",
            "subject_key": item["code"],
            "topic": "status_definition",
        },
    )


def _critical_explanation_required(question: str, plan: QueryPlan, knowledge: DatabaseKnowledgeAnswer) -> bool:
    normalized = _normalize(question)
    topic = _normalize(knowledge.context.get("topic"))
    return plan.intent == "explanation" and ("critic" in normalized or topic == "critical")


def apply_deterministic_conclusions(
    question: str,
    plan: QueryPlan,
    knowledge: DatabaseKnowledgeAnswer,
) -> DatabaseKnowledgeAnswer:
    if not _critical_explanation_required(question, plan, knowledge):
        return knowledge

    material_key = str(knowledge.context.get("subject_key") or "").strip()
    if not material_key:
        return knowledge

    scenario_records = load_runtime_entities(entity_type="material", entity_key=material_key, scope="scenario")
    if not scenario_records:
        return knowledge

    payload = scenario_records[0].get("payload") or {}
    status = str(payload.get("status") or "").upper()
    status_item = get_status_definition(status)
    if status_item is None:
        return knowledge

    um = str(payload.get("um") or "—")
    balance = payload.get("balance")
    balance_text = _format_number(balance)
    tolerance = f"{CRITICAL_BALANCE_TOLERANCE:.4f}".replace(".", ",")

    if status == "FORA_ESCOPO_UM":
        deterministic = (
            f"No Cenário ORION, o material {material_key} não está crítico porque sua UM é {um}, diferente de UN. "
            f"A REGRA-004 exige simultaneamente UM = UN e SALDO < -{tolerance}. "
            f"O SALDO ORION é {balance_text}; mesmo estando negativo, a condição UM = UN não foi atendida. "
            f"Por isso o motor Python atribuiu o status FORA_ESCOPO_UM."
        )
        required = [[um], ["UN"], ["FORA_ESCOPO_UM"], ["REGRA-004"]]
    elif status == "OK":
        deterministic = (
            f"No Cenário ORION, o material {material_key} não está crítico. Sua UM é {um} e está dentro do escopo da REGRA-004, "
            f"mas o SALDO ORION de {balance_text} não é inferior a -{tolerance}. Por isso o status determinístico é OK."
        )
        required = [[um], ["UN"], ["OK"], ["REGRA-004"]]
    else:
        deterministic = (
            f"No Cenário ORION, o material {material_key} está crítico porque atende à REGRA-004: UM = UN e SALDO < -{tolerance}. "
            f"A UM é {um}, o SALDO ORION é {balance_text} e o status determinístico é INVESTIGAR."
        )
        required = [[um], ["UN"], ["INVESTIGAR"], ["REGRA-004"]]

    source = f"deterministic://status-registry/{status}"
    if source not in knowledge.sources:
        knowledge.sources.append(source)
    if not any(chunk.source == source for chunk in knowledge.chunks):
        knowledge.chunks.append(
            KnowledgeChunk(
                source=source,
                content=(
                    f"{status_evidence_text(status)}\n"
                    f"Material atual: {material_key}\nUM atual: {um}\nSALDO ORION atual: {balance_text}\n"
                    f"Conclusão determinística: {deterministic}"
                ),
                score=1000.0,
                heading=f"Conclusão determinística · material {material_key}",
                category="deterministic",
            )
        )

    knowledge.answer = deterministic
    if status not in knowledge.entities:
        knowledge.entities.append(status)
    knowledge.context = {
        **knowledge.context,
        "required_answer_terms": required,
        "status": status,
    }
    return knowledge


def semantic_coverage_missing(answer: str, context: dict) -> list[str]:
    requirements = context.get("required_answer_terms") or []
    normalized = _normalize(answer)
    missing: list[str] = []
    for requirement in requirements:
        options = requirement if isinstance(requirement, list) else [requirement]
        if not any(_normalize(option) and re.search(rf"(?<![a-z0-9]){re.escape(_normalize(option))}(?![a-z0-9])", normalized) for option in options):
            missing.append("/".join(str(option) for option in options))
    return missing


def build_persisted_context(knowledge: DatabaseKnowledgeAnswer, response_entities: list[str]) -> dict:
    known_statuses = set(known_status_codes())
    known_rules = set(known_rule_codes())
    subject_type = str(knowledge.context.get("subject_type") or "")
    subject_key = str(knowledge.context.get("subject_key") or "")
    typed: list[dict[str, str]] = []

    for entity in response_entities:
        value = str(entity or "").strip()
        if not value:
            continue
        upper = value.upper()
        if upper in known_statuses:
            entity_type = "status"
            value = upper
        elif upper in known_rules:
            entity_type = "rule"
            value = upper
        elif value == subject_key and subject_type:
            entity_type = subject_type
        elif re.fullmatch(r"[0-9A-Za-z]+(?:-[0-9A-Za-z]+){2,}", value):
            entity_type = "material"
        else:
            entity_type = "concept"
        item = {"type": entity_type, "key": value}
        if item not in typed:
            typed.append(item)

    return {**knowledge.context, "last_entities": typed[-12:]}
