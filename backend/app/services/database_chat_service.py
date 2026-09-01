from __future__ import annotations

import re
import unicodedata

from app.schemas.agent import ChatResponse
from app.services.database_answer_service import answer_database_knowledge
from app.services.database_chat_refinement_service import refine_database_answer
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


def answer_database_question(question: str, session_id: str = "") -> ChatResponse:
    runtime = runtime_workspace_status()
    previous_context = load_chat_context(session_id)
    knowledge = answer_database_knowledge(question, context=previous_context)
    knowledge = refine_database_answer(question, previous_context, knowledge)
    knowledge.answer = _label_structured_field_answer(knowledge.answer, knowledge.context)

    if _only_incidental_python(question, knowledge.sources):
        knowledge.answer = (
            "Não encontrei evidência suficiente no banco de conhecimento SQLite do ORION para responder essa pergunta. "
            "Nenhuma resposta externa ou pré-definida foi usada."
        )
        knowledge.sources = []
        knowledge.chunks = []
        knowledge.entities = []
        knowledge.table = None

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
    audit_id = record_chat_audit(
        question=question,
        answer=knowledge.answer,
        provider="local-rag-db",
        sources=sources,
        workspace_fingerprint=runtime["workspace_fingerprint"],
        session_id=session_id,
        resolved_question=knowledge.resolved_question or question,
        context=knowledge.context,
        retrieval=retrieval,
    )
    return ChatResponse(
        provider="local-rag",
        model="sqlite-fts5-bm25",
        is_demo=False,
        answer=knowledge.answer,
        knowledge_sources=sources,
        retrieval=retrieval,
        entities=knowledge.entities,
        table=knowledge.table,
        database=runtime.get("database", "orion.db"),
        workspace_fingerprint=runtime["workspace_fingerprint"],
        audit_id=audit_id,
        resolved_question=knowledge.resolved_question or question,
    )
