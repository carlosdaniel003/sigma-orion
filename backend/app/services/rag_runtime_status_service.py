from __future__ import annotations

from app.services.knowledge_catalog_service import _connect, _ensure_schema, knowledge_index_status, sync_knowledge_index
from app.services.rag_runtime_service import _ensure_runtime_schema


def runtime_workspace_status() -> dict:
    sync_knowledge_index()
    with _connect() as connection:
        fts5_enabled = _ensure_schema(connection)
        _ensure_runtime_schema(connection)
        state = connection.execute(
            "SELECT fingerprint, document_count FROM rag_runtime_state WHERE id = 1"
        ).fetchone()
        status = knowledge_index_status(connection=connection, fts5_enabled=fts5_enabled)
        return {
            **status,
            "workspace_fingerprint": str(state["fingerprint"]) if state is not None else "",
            "runtime_document_count": int(state["document_count"]) if state is not None else 0,
            "workspace_synced": state is not None,
        }
