from __future__ import annotations

import re
import unicodedata

from app.schemas.agent import ChatResponse
from app.services.database_answer_service import DatabaseKnowledgeAnswer, answer_database_knowledge
from app.services.database_chat_refinement_service import refine_database_answer
from app.services.database_conversation_grounding_service import (
    apply_deterministic_conclusions,
    build_persisted_context,
    semantic_coverage_missing,
    status_knowledge_answer,
)
from app.services.database_query_planner_service import QueryPlan, plan_database_question, smalltalk_answer
from app.services.dpp_status_registry import known_status_codes
from app.services.llm_grounding_service import enhance_grounded_answer
from app.services.rag_runtime_service import load_chat_context, record_chat_audit
from app.services.rag_runtime_status_service import runtime_workspace_status


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_.-]+", " ", normalized).strip()


def _only_incidental_python(question: str, sources: list[str]) -> bool:
    if not sources or not all(source.startswith("python://") for source in sources):
        return False
    normalized = _normalize(question)
    explicitly_code = (
        "python" in normalized
        or "codigo" in normalized
        or ".py" in normalized
        or bool(re.search(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b", normalized))
    )
    return not explicitly_code


def _label_structured_field_answer(answer: str, context: dict) -> str:
    topic = str(context.get("topic") or "")
    labels = {
        "balance": ("SALDO ORION:", "SALDO Final:"),
        "nec": ("NEC ORION:", "NEC Final:"),
        "stock_total": ("STK TTL ORION:", "STK TTL Final:"),
        "stock_op": ("STK OP ORION:", "STK OP Final:"),
    }
    if topic not in labels:
        return answer
    scenario_label, final_label = labels[topic]
    return answer.replace("Cenário ORION:", scenario_label).replace("DPP Final:", final_label)


def _merge_entities(*groups: list[str]) -> list[str]:
    result: list[str] = []
    for group in groups:
        for item in group:
            text = str(item or "").strip()
            if text and text not in result:
                result.append(text)
    return result


def _traceable_knowledge_entities(plan: QueryPlan, knowledge: DatabaseKnowledgeAnswer) -> list[str]:
    """Remove entidades lexicais incidentais sem manter blacklist de palavras.

    A rastreabilidade aceita entidades que tenham origem demonstrável: conceitos reconhecidos
    pelo planejador, status determinísticos, o assunto estruturado da resposta ou códigos de
    material. Palavras escolhidas apenas por heurística lexical do fallback RAG não aparecem
    como entidades no frontend nem contaminam o contexto persistido.
    """

    recognized = {_normalize(item) for item in plan.concept_entities}
    statuses = {item.upper() for item in known_status_codes()}
    subject_key = str(knowledge.context.get("subject_key") or "").strip()
    result: list[str] = []

    for raw in knowledge.entities:
        item = str(raw or "").strip()
        if not item:
            continue
        normalized = _normalize(item)
        is_recognized_concept = normalized in recognized
        is_status = item.upper() in statuses
        is_context_subject = bool(subject_key) and normalized == _normalize(subject_key)
        is_material_code = bool(re.fullmatch(r"[0-9A-Za-z]+(?:-[0-9A-Za-z]+){2,}", item))
        if is_recognized_concept or is_status or is_context_subject or is_material_code:
            result.append(item.upper() if is_status else item)

    return result


def _smalltalk_knowledge(previous_context: dict, question: str) -> DatabaseKnowledgeAnswer:
    return DatabaseKnowledgeAnswer(
        answer=smalltalk_answer(),
        sources=[],
        chunks=[],
        entities=[],
        resolved_question=question,
        context=previous_context,
    )


def answer_database_question(question: str, session_id: str = "") -> ChatResponse:
    runtime = runtime_workspace_status()
    previous_context = load_chat_context(session_id)

    # O roteador é totalmente determinístico. Nenhuma LLM é chamada antes de
    # SQL/Python/RAG terem produzido e validado o contexto da resposta.
    plan = plan_database_question(question, previous_context)
    status_direct = False

    if plan.smalltalk:
        knowledge = _smalltalk_knowledge(previous_context, question)
    else:
        status_result = status_knowledge_answer(plan)
        if status_result is not None and plan.intent in {"definition", "explanation", "fact"}:
            knowledge = status_result
            status_direct = True
        else:
            knowledge = answer_database_knowledge(plan.retrieval_question, context=previous_context)
            knowledge = refine_database_answer(question, previous_context, knowledge)
            knowledge.answer = _label_structured_field_answer(knowledge.answer, knowledge.context)
            knowledge.resolved_question = plan.resolved_question

            # Se o roteador reconheceu conceitos explícitos, eles substituem heurísticas
            # lexicais genéricas na rastreabilidade/contexto persistido.
            if plan.concept_entities:
                subject_key = plan.concept_entities[0] if len(plan.concept_entities) == 1 else " + ".join(plan.concept_entities)
                if knowledge.context.get("subject_type") in {None, "", "knowledge", "concept"}:
                    knowledge.context = {
                        **knowledge.context,
                        "subject_type": "concept",
                        "subject_key": subject_key,
                    }

            if _only_incidental_python(question, knowledge.sources):
                knowledge.answer = (
                    "Não encontrei evidência suficiente no banco de conhecimento SQLite do ORION para responder essa pergunta. "
                    "Nenhuma resposta externa ou pré-definida foi usada."
                )
                knowledge.sources = []
                knowledge.chunks = []
                knowledge.entities = []
                knowledge.table = None

        knowledge = apply_deterministic_conclusions(question, plan, knowledge)

    deterministic_answer = knowledge.answer
    enhancement = enhance_grounded_answer(
        question=question,
        plan=plan,
        context=previous_context,
        knowledge=knowledge,
    )

    # Além de validar fatos/números, a resposta precisa cobrir as conclusões que o
    # motor determinístico marcou como essenciais. Se a LLM omitir a causa e apenas
    # repetir o status, voltamos para a explicação determinística completa.
    if enhancement.used and semantic_coverage_missing(enhancement.answer, knowledge.context):
        enhancement.answer = deterministic_answer
        enhancement.used = False
        enhancement.fallback = True

    knowledge.answer = enhancement.answer

    sources = knowledge.sources
    retrieval = [
        {
            "source": chunk.source,
            "heading": chunk.heading,
            "category": chunk.category,
            "score": chunk.score,
        }
        for chunk in knowledge.chunks
    ]
    # Nunca expomos plan.entities bruto: ele pode carregar uma referência lexical antiga
    # vinda de contexto legado. A lista pública é composta apenas por entidades cuja origem
    # está demonstrada no planejador ou na resposta estruturada atual.
    response_entities = _merge_entities(
        plan.concept_entities,
        plan.status_entities,
        _traceable_knowledge_entities(plan, knowledge),
    )
    persisted_context = knowledge.context if plan.smalltalk else build_persisted_context(knowledge, response_entities)

    if plan.smalltalk:
        audit_provider = "deterministic-router"
        response_provider = "local-router"
        response_model = "deterministic-router"
    elif status_direct and not enhancement.used:
        audit_provider = "deterministic-status-registry"
        response_provider = "local-router"
        response_model = "deterministic-status-registry"
    elif enhancement.used:
        audit_provider = f"grounded-llm:{enhancement.provider or 'configured'}"
        response_provider = enhancement.provider or "local-llm"
        response_model = enhancement.model or "local-model"
    elif enhancement.fallback:
        audit_provider = "local-rag-db:llm-fallback"
        response_provider = "local-rag"
        response_model = "sqlite-fts5-bm25"
    else:
        audit_provider = "local-rag-db"
        response_provider = "local-rag"
        response_model = "sqlite-fts5-bm25"

    audit_id = record_chat_audit(
        question=question,
        answer=knowledge.answer,
        provider=audit_provider,
        sources=sources,
        workspace_fingerprint=runtime["workspace_fingerprint"],
        session_id=session_id,
        resolved_question=knowledge.resolved_question or plan.resolved_question,
        context=persisted_context,
        retrieval=retrieval,
    )
    return ChatResponse(
        provider=response_provider,
        model=response_model,
        is_demo=False,
        answer=knowledge.answer,
        knowledge_sources=sources,
        retrieval=retrieval,
        entities=response_entities,
        table=knowledge.table,
        database=runtime.get("database", "orion.db"),
        workspace_fingerprint=runtime["workspace_fingerprint"],
        audit_id=audit_id,
        resolved_question=knowledge.resolved_question or plan.resolved_question,
        llm_used=enhancement.used,
        llm_fallback=enhancement.fallback,
        llm_provider=enhancement.provider,
    )
