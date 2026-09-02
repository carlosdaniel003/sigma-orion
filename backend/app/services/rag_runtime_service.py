from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import re
from typing import Any

from app.services.knowledge_catalog_service import (
    _connect,
    _ensure_schema,
    _insert_document,
    knowledge_index_status,
    sync_knowledge_index,
)


RUNTIME_SOURCE_PREFIX = "workspace://"


@dataclass(frozen=True, slots=True)
class RuntimeDocument:
    source: str
    title: str
    content: str


@dataclass(frozen=True, slots=True)
class RuntimeEntity:
    entity_type: str
    entity_key: str
    scope: str
    source: str
    payload: dict


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))


def _token(value: Any) -> str:
    text = str(value or "item").strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-")
    return cleaned or "item"


def _field_lines(data: dict, preferred: list[tuple[str, str]]) -> list[str]:
    lines: list[str] = []
    used: set[str] = set()
    for key, label in preferred:
        if key not in data:
            continue
        value = data.get(key)
        if value in (None, ""):
            continue
        lines.append(f"{label}: {value}")
        used.add(key)
    remaining = {key: value for key, value in data.items() if key not in used}
    if remaining:
        lines.append(f"Dados completos: {_json(remaining)}")
    return lines


def _scenario_documents(scenario: dict, month: str) -> list[RuntimeDocument]:
    if not isinstance(scenario, dict) or not scenario:
        return []
    scenario_id = str(scenario.get("scenario_id") or "current")
    base = f"{RUNTIME_SOURCE_PREFIX}scenario/{_token(scenario_id)}"
    summary = scenario.get("summary") if isinstance(scenario.get("summary"), dict) else {}
    documents = [
        RuntimeDocument(
            source=f"{base}/summary",
            title="Resumo do Cenário ORION atual",
            content="\n".join([
                "Cenário ORION atualmente sincronizado com a aba DPP.",
                f"Mês de referência: {month or scenario.get('reference_month') or 'não informado'}",
                f"Scenario ID: {scenario_id}",
                f"Resumo: {_json(summary)}",
                f"Escopo: {scenario.get('scope') or ''}",
            ]),
        )
    ]

    for model in scenario.get("models") or []:
        if not isinstance(model, dict):
            continue
        name = str(model.get("name") or "modelo")
        content = "\n".join([
            "Modelo do Cenário ORION atual.",
            f"Mês de referência: {month or scenario.get('reference_month') or 'não informado'}",
            *_field_lines(model, [
                ("name", "Modelo"),
                ("kit_pgd", "KIT Disponível PGD"),
                ("real", "REAL ORION"),
                ("difference_real_vs_kit", "Diferença REAL vs KIT"),
                ("above_kit", "Acima do KIT"),
            ]),
        ])
        documents.append(RuntimeDocument(
            source=f"{base}/model/{_token(name)}",
            title=f"Modelo {name} · Cenário ORION",
            content=content,
        ))

    for material in scenario.get("materials") or []:
        if not isinstance(material, dict):
            continue
        code = str(material.get("material") or material.get("material_key") or "material")
        critical = str(material.get("status") or "").upper() == "INVESTIGAR"
        content = "\n".join([
            "Material do Cenário ORION atual calculado pelo motor Python.",
            f"Mês de referência: {month or scenario.get('reference_month') or 'não informado'}",
            f"Crítico pela regra do Cenário ORION: {critical}",
            *_field_lines(material, [
                ("material", "Material"),
                ("material_key", "Chave do material"),
                ("description", "Descrição"),
                ("um", "UM"),
                ("group_origin", "Grupo Origem"),
                ("nec", "NEC ORION"),
                ("stock_sap_effective", "STK SAP efetivo"),
                ("explosion", "EXPLOSÃO"),
                ("stock_op", "STK OP"),
                ("stock_total", "STK TTL ORION"),
                ("balance", "SALDO ORION"),
                ("price", "Preço"),
                ("amount", "Amount"),
                ("status", "Status"),
                ("check", "CHECK"),
                ("wiu", "WIU"),
                ("opc", "OPC"),
            ]),
        ])
        documents.append(RuntimeDocument(
            source=f"{base}/material/{_token(code)}",
            title=f"Material {code} · Cenário ORION",
            content=content,
        ))
    return documents


def _final_documents(final_dpp: dict, month: str) -> list[RuntimeDocument]:
    if not isinstance(final_dpp, dict) or not final_dpp:
        return []
    analysis_id = str(final_dpp.get("analysis_id") or "current")
    base = f"{RUNTIME_SOURCE_PREFIX}final/{_token(analysis_id)}"
    summary = final_dpp.get("summary") if isinstance(final_dpp.get("summary"), dict) else {}
    documents = [
        RuntimeDocument(
            source=f"{base}/summary",
            title="Resumo do DPP Final sincronizado",
            content="\n".join([
                "DPP Final atualmente sincronizado com a aba DPP.",
                f"Mês de referência: {month or (final_dpp.get('column_comparison') or {}).get('reference_month') or 'não informado'}",
                f"Analysis ID: {analysis_id}",
                f"Arquivo: {final_dpp.get('filename') or ''}",
                f"Resumo: {_json(summary)}",
                f"Regra crítica: {_json(final_dpp.get('critical_rule') or {})}",
            ]),
        )
    ]

    for model in final_dpp.get("models") or []:
        if not isinstance(model, dict):
            continue
        name = str(model.get("name") or "modelo")
        documents.append(RuntimeDocument(
            source=f"{base}/model/{_token(name)}",
            title=f"Modelo {name} · DPP Final",
            content="\n".join([
                "Modelo do DPP Final sincronizado.",
                *_field_lines(model, [
                    ("name", "Modelo"),
                    ("pgd", "KIT/PGD Final"),
                    ("real", "REAL Final"),
                    ("delta", "Diferença REAL vs PGD"),
                    ("active", "Ativo"),
                    ("changed", "Alterado"),
                    ("at_risk", "Em risco"),
                ]),
            ]),
        ))

    for material in final_dpp.get("material_details") or []:
        if not isinstance(material, dict):
            continue
        code = str(material.get("material") or "material")
        documents.append(RuntimeDocument(
            source=f"{base}/material/{_token(code)}",
            title=f"Material {code} · DPP Final",
            content="\n".join([
                "Material do DPP Final sincronizado.",
                *_field_lines(material, [
                    ("material", "Material"),
                    ("description", "Descrição"),
                    ("um", "UM"),
                    ("group_origin", "Grupo Origem"),
                    ("nec", "NEC Final"),
                    ("stock", "STK Final"),
                    ("explosion", "EXPLOSÃO Final"),
                    ("stock_op", "STK OP Final"),
                    ("stock_total", "STK TTL Final"),
                    ("balance", "SALDO Final"),
                    ("optional_material", "OPC Final"),
                    ("critical", "Crítico"),
                    ("shared_critical", "Crítico compartilhado"),
                    ("affected_models", "Modelos afetados"),
                ]),
            ]),
        ))

    comparison = final_dpp.get("column_comparison") if isinstance(final_dpp.get("column_comparison"), dict) else {}
    if comparison:
        documents.append(RuntimeDocument(
            source=f"{base}/comparison/summary",
            title="Resumo do comparativo DPP Final × Cenário ORION",
            content=f"Comparativo completo do workspace atual: {_json({key: value for key, value in comparison.items() if key != 'columns'})}",
        ))
        for column in comparison.get("columns") or []:
            if not isinstance(column, dict):
                continue
            name = str(column.get("name") or column.get("column") or "coluna")
            documents.append(RuntimeDocument(
                source=f"{base}/comparison/column/{_token(name)}",
                title=f"Coluna {name} · Comparativo DPP",
                content=f"Coluna do comparativo DPP Final × Cenário ORION: {_json(column)}",
            ))
    return documents


def _workspace_documents(workspace: dict | None) -> list[RuntimeDocument]:
    payload = workspace if isinstance(workspace, dict) else {}
    month = str(payload.get("month") or "")
    state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
    documents = [
        RuntimeDocument(
            source=f"{RUNTIME_SOURCE_PREFIX}state/current",
            title="Estado atual do workspace DPP",
            content="\n".join([
                "Estado do workspace DPP usado pelo Agente ORION.",
                f"Mês: {month or 'não definido'}",
                f"Estado: {_json(state)}",
            ]),
        )
    ]
    documents.extend(_scenario_documents(payload.get("scenario") or {}, month))
    documents.extend(_final_documents(payload.get("final_dpp") or {}, month))
    return documents


def _workspace_entities(workspace: dict | None) -> list[RuntimeEntity]:
    payload = workspace if isinstance(workspace, dict) else {}
    entities: list[RuntimeEntity] = [
        RuntimeEntity(
            entity_type="workspace_state",
            entity_key="current",
            scope="workspace",
            source=f"{RUNTIME_SOURCE_PREFIX}state/current",
            payload={"month": payload.get("month"), "state": payload.get("state") or {}},
        )
    ]

    scenario = payload.get("scenario") if isinstance(payload.get("scenario"), dict) else {}
    if scenario:
        scenario_id = str(scenario.get("scenario_id") or "current")
        base = f"{RUNTIME_SOURCE_PREFIX}scenario/{_token(scenario_id)}"
        entities.append(RuntimeEntity(
            entity_type="scenario_summary",
            entity_key=scenario_id,
            scope="scenario",
            source=f"{base}/summary",
            payload={
                "scenario_id": scenario_id,
                "reference_month": scenario.get("reference_month") or payload.get("month"),
                "summary": scenario.get("summary") or {},
                "scope": scenario.get("scope"),
            },
        ))
        for model in scenario.get("models") or []:
            if isinstance(model, dict):
                name = str(model.get("name") or "modelo")
                entities.append(RuntimeEntity("model", name, "scenario", f"{base}/model/{_token(name)}", model))
        for material in scenario.get("materials") or []:
            if isinstance(material, dict):
                code = str(material.get("material") or material.get("material_key") or "material")
                enriched = dict(material)
                enriched["critical"] = str(material.get("status") or "").upper() == "INVESTIGAR"
                entities.append(RuntimeEntity("material", code, "scenario", f"{base}/material/{_token(code)}", enriched))

    final_dpp = payload.get("final_dpp") if isinstance(payload.get("final_dpp"), dict) else {}
    if final_dpp:
        analysis_id = str(final_dpp.get("analysis_id") or "current")
        base = f"{RUNTIME_SOURCE_PREFIX}final/{_token(analysis_id)}"
        entities.append(RuntimeEntity(
            entity_type="final_summary",
            entity_key=analysis_id,
            scope="final",
            source=f"{base}/summary",
            payload={
                "analysis_id": analysis_id,
                "filename": final_dpp.get("filename"),
                "summary": final_dpp.get("summary") or {},
                "critical_rule": final_dpp.get("critical_rule") or {},
            },
        ))
        for model in final_dpp.get("models") or []:
            if isinstance(model, dict):
                name = str(model.get("name") or "modelo")
                entities.append(RuntimeEntity("model", name, "final", f"{base}/model/{_token(name)}", model))
        for material in final_dpp.get("material_details") or []:
            if isinstance(material, dict):
                code = str(material.get("material") or "material")
                entities.append(RuntimeEntity("material", code, "final", f"{base}/material/{_token(code)}", material))
        comparison = final_dpp.get("column_comparison") if isinstance(final_dpp.get("column_comparison"), dict) else {}
        if comparison:
            entities.append(RuntimeEntity(
                "comparison_summary",
                analysis_id,
                "final",
                f"{base}/comparison/summary",
                {key: value for key, value in comparison.items() if key != "columns"},
            ))
            for column in comparison.get("columns") or []:
                if isinstance(column, dict):
                    name = str(column.get("name") or column.get("column") or "coluna")
                    entities.append(RuntimeEntity(
                        "comparison_column",
                        name,
                        "final",
                        f"{base}/comparison/column/{_token(name)}",
                        column,
                    ))
    return entities


def _fingerprint(workspace: dict | None) -> str:
    payload = workspace if isinstance(workspace, dict) else {}
    scenario = payload.get("scenario") if isinstance(payload.get("scenario"), dict) else {}
    final_dpp = payload.get("final_dpp") if isinstance(payload.get("final_dpp"), dict) else {}
    models = [
        [item.get("name"), item.get("real"), item.get("kit_pgd")]
        for item in scenario.get("models") or []
        if isinstance(item, dict)
    ]
    identity = {
        "month": payload.get("month"),
        "state": payload.get("state"),
        "scenario_id": scenario.get("scenario_id"),
        "scenario_models": models,
        "final_analysis_id": final_dpp.get("analysis_id"),
        "final_filename": final_dpp.get("filename"),
    }
    return sha256(_json(identity).encode("utf-8")).hexdigest()


def _ensure_runtime_schema(connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS rag_runtime_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            fingerprint TEXT NOT NULL,
            document_count INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS rag_runtime_entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            scope TEXT NOT NULL,
            source TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            UNIQUE(entity_type, entity_key, scope)
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS ix_rag_runtime_entities_lookup ON rag_runtime_entities(entity_type, entity_key, scope)"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS rag_chat_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            provider TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            workspace_fingerprint TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            resolved_question TEXT NOT NULL DEFAULT '',
            context_json TEXT NOT NULL DEFAULT '{}',
            retrieval_json TEXT NOT NULL DEFAULT '[]'
        )
        """
    )
    columns = {str(row["name"]) for row in connection.execute("PRAGMA table_info(rag_chat_audit)").fetchall()}
    additions = {
        "session_id": "TEXT NOT NULL DEFAULT ''",
        "resolved_question": "TEXT NOT NULL DEFAULT ''",
        "context_json": "TEXT NOT NULL DEFAULT '{}'",
        "retrieval_json": "TEXT NOT NULL DEFAULT '[]'",
    }
    for name, definition in additions.items():
        if name not in columns:
            connection.execute(f"ALTER TABLE rag_chat_audit ADD COLUMN {name} {definition}")
    connection.execute("CREATE INDEX IF NOT EXISTS ix_rag_chat_audit_session ON rag_chat_audit(session_id, id)")


def _delete_runtime_documents(connection, fts5_enabled: bool) -> None:
    if fts5_enabled:
        connection.execute(
            "DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE source LIKE ?)",
            (f"{RUNTIME_SOURCE_PREFIX}%",),
        )
    connection.execute("DELETE FROM knowledge_chunks WHERE source LIKE ?", (f"{RUNTIME_SOURCE_PREFIX}%",))
    connection.execute("DELETE FROM knowledge_documents WHERE source LIKE ?", (f"{RUNTIME_SOURCE_PREFIX}%",))
    connection.execute("DELETE FROM rag_runtime_entities")


def sync_runtime_workspace(workspace: dict | None) -> dict:
    sync_knowledge_index()
    documents = _workspace_documents(workspace)
    entities = _workspace_entities(workspace)
    fingerprint = _fingerprint(workspace)

    with _connect() as connection:
        fts5_enabled = _ensure_schema(connection)
        _ensure_runtime_schema(connection)
        current = connection.execute(
            "SELECT fingerprint, document_count FROM rag_runtime_state WHERE id = 1"
        ).fetchone()
        actual_count = int(connection.execute(
            "SELECT COUNT(*) FROM knowledge_documents WHERE source LIKE ?",
            (f"{RUNTIME_SOURCE_PREFIX}%",),
        ).fetchone()[0])
        entity_count = int(connection.execute("SELECT COUNT(*) FROM rag_runtime_entities").fetchone()[0])
        if (
            current
            and str(current["fingerprint"]) == fingerprint
            and actual_count == len(documents)
            and entity_count == len(entities)
        ):
            status = knowledge_index_status(connection=connection, fts5_enabled=fts5_enabled)
            return {
                **status,
                "workspace_fingerprint": fingerprint,
                "runtime_document_count": actual_count,
                "runtime_entity_count": entity_count,
            }

        _delete_runtime_documents(connection, fts5_enabled)
        for document in documents:
            _insert_document(
                connection,
                source=document.source,
                category="current",
                title=document.title,
                content=document.content,
                chunks=[(document.title, document.content)],
                fts5_enabled=fts5_enabled,
            )
        for entity in entities:
            connection.execute(
                """
                INSERT INTO rag_runtime_entities(entity_type, entity_key, scope, source, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (entity.entity_type, entity.entity_key, entity.scope, entity.source, _json(entity.payload)),
            )
        connection.execute(
            """
            INSERT INTO rag_runtime_state(id, fingerprint, document_count)
            VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint, document_count = excluded.document_count
            """,
            (fingerprint, len(documents)),
        )
        connection.commit()
        status = knowledge_index_status(connection=connection, fts5_enabled=fts5_enabled)
        return {
            **status,
            "workspace_fingerprint": fingerprint,
            "runtime_document_count": len(documents),
            "runtime_entity_count": len(entities),
        }


def load_runtime_entities(*, entity_type: str | None = None, entity_key: str | None = None, scope: str | None = None) -> list[dict]:
    with _connect() as connection:
        _ensure_schema(connection)
        _ensure_runtime_schema(connection)
        clauses: list[str] = []
        params: list[object] = []
        if entity_type:
            clauses.append("entity_type = ?")
            params.append(entity_type)
        if entity_key:
            clauses.append("lower(entity_key) = lower(?)")
            params.append(entity_key)
        if scope:
            clauses.append("scope = ?")
            params.append(scope)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = connection.execute(
            f"SELECT entity_type, entity_key, scope, source, payload_json FROM rag_runtime_entities{where} ORDER BY scope, entity_key",
            params,
        ).fetchall()
    result: list[dict] = []
    for row in rows:
        try:
            payload = json.loads(str(row["payload_json"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = {}
        result.append({
            "entity_type": str(row["entity_type"]),
            "entity_key": str(row["entity_key"]),
            "scope": str(row["scope"]),
            "source": str(row["source"]),
            "payload": payload if isinstance(payload, dict) else {},
        })
    return result


def load_chat_context(session_id: str) -> dict:
    if not session_id:
        return {}
    with _connect() as connection:
        _ensure_schema(connection)
        _ensure_runtime_schema(connection)
        row = connection.execute(
            "SELECT context_json FROM rag_chat_audit WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            (session_id,),
        ).fetchone()
    if row is None:
        return {}
    try:
        payload = json.loads(str(row["context_json"] or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def record_chat_audit(
    *,
    question: str,
    answer: str,
    provider: str,
    sources: list[str],
    workspace_fingerprint: str,
    session_id: str = "",
    resolved_question: str = "",
    context: dict | None = None,
    retrieval: list[dict] | None = None,
) -> int:
    with _connect() as connection:
        _ensure_schema(connection)
        _ensure_runtime_schema(connection)
        cursor = connection.execute(
            """
            INSERT INTO rag_chat_audit(
                question, answer, provider, sources_json, workspace_fingerprint,
                session_id, resolved_question, context_json, retrieval_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                question,
                answer,
                provider,
                _json(sources),
                workspace_fingerprint,
                session_id,
                resolved_question or question,
                _json(context or {}),
                _json(retrieval or []),
            ),
        )
        connection.commit()
        return int(cursor.lastrowid)
