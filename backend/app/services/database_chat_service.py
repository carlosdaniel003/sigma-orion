from __future__ import annotations

from app.schemas.agent import ChatResponse
from app.services.database_answer_service import answer_database_knowledge
from app.services.rag_runtime_service import record_chat_audit
from app.services.rag_runtime_status_service import runtime_workspace_status


def answer_database_question(question: str) -> ChatResponse:
    runtime = runtime_workspace_status()
    knowledge = answer_database_knowledge(question)
    sources = knowledge.sources
    audit_id = record_chat_audit(
        question=question,
        answer=knowledge.answer,
        provider="local-rag-db",
        sources=sources,
        workspace_fingerprint=runtime["workspace_fingerprint"],
    )
    return ChatResponse(
        provider="local-rag",
        model="sqlite-fts5-bm25",
        is_demo=False,
        answer=knowledge.answer,
        knowledge_sources=sources,
        retrieval=[
            {
                "source": chunk.source,
                "heading": chunk.heading,
                "category": chunk.category,
                "score": chunk.score,
            }
            for chunk in knowledge.chunks
        ],
        database=runtime.get("database", "orion.db"),
        workspace_fingerprint=runtime["workspace_fingerprint"],
        audit_id=audit_id,
    )
