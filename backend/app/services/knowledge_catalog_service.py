from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import sqlite3
from threading import Lock
import unicodedata

from app.core.config import BASE_DIR, DATABASE_URL, KNOWLEDGE_DIR
from app.services.python_knowledge_inventory_service import scan_python_knowledge


_INDEX_LOCK = Lock()
_LAST_FINGERPRINT: tuple[tuple[str, int, int], ...] | None = None
_FTS5_AVAILABLE: bool | None = None

_SEARCH_STOP_WORDS = {
    "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "no", "na",
    "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
    "qual", "quais", "como", "quando", "onde", "porque",
}


@dataclass(slots=True)
class IndexedKnowledgeChunk:
    chunk_id: int
    source: str
    category: str
    heading: str
    content: str
    score: float = 0.0
    kind: str = "documento"
    location: str = ""


def _database_path() -> Path:
    prefix = "sqlite:///"
    if not DATABASE_URL.startswith(prefix):
        raise RuntimeError("O índice BM25 local exige DATABASE_URL SQLite nesta etapa.")
    return Path(DATABASE_URL[len(prefix):])


def _connect() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=15)
    connection.row_factory = sqlite3.Row
    return connection


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized).strip()


def _search_terms(query: str) -> list[str]:
    terms: list[str] = []
    for token in re.findall(r"[a-z0-9]+", _normalize(query)):
        if len(token) <= 2 or token in _SEARCH_STOP_WORDS:
            continue
        if token not in terms:
            terms.append(token)
    return terms


def _category_for_source(source: str) -> str:
    normalized = source.lower()
    if normalized.startswith("python://"):
        return "deterministic"
    if normalized in {"motor-deterministico.md", "regras-globais.md", "guardrails.md"}:
        return "deterministic"
    if normalized.startswith("casos-aprovados/"):
        return "operational"
    return "operational"


def _heading(section: str, source: str) -> str:
    first_line = section.splitlines()[0].strip() if section else ""
    cleaned = re.sub(r"^#{1,6}\s*", "", first_line).strip()
    return cleaned or Path(source).stem.replace("-", " ").title()


def _split_markdown_sections(content: str) -> list[str]:
    sections = [
        section.strip()
        for section in re.split(r"(?=^#{2,4}\s+)", content, flags=re.MULTILINE)
        if section.strip()
    ]
    return sections or ([content.strip()] if content.strip() else [])


def _chunk_section(section: str, max_chars: int = 1800) -> list[str]:
    if len(section) <= max_chars:
        return [section]

    blocks = [block.strip() for block in re.split(r"\n\s*\n", section) if block.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_size = 0
    for block in blocks:
        if current and current_size + len(block) > max_chars:
            chunks.append("\n\n".join(current))
            current = []
            current_size = 0
        current.append(block)
        current_size += len(block)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def _fingerprint() -> tuple[tuple[str, int, int], ...]:
    result: list[tuple[str, int, int]] = []
    for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        stat = path.stat()
        result.append((f"knowledge/{path.relative_to(KNOWLEDGE_DIR).as_posix()}", stat.st_mtime_ns, stat.st_size))
    python_root = BASE_DIR / "backend" / "app"
    for path in sorted(python_root.rglob("*.py")):
        stat = path.stat()
        result.append((path.relative_to(BASE_DIR).as_posix(), stat.st_mtime_ns, stat.st_size))
    return tuple(result)


def _ensure_schema(connection: sqlite3.Connection) -> bool:
    global _FTS5_AVAILABLE

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            checksum TEXT NOT NULL,
            content TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id INTEGER NOT NULL,
            source TEXT NOT NULL,
            category TEXT NOT NULL,
            heading TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            content TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
        )
        """
    )

    if _FTS5_AVAILABLE is False:
        return False

    try:
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
                chunk_id UNINDEXED,
                heading,
                content,
                source,
                category UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            )
            """
        )
        _FTS5_AVAILABLE = True
    except sqlite3.OperationalError:
        _FTS5_AVAILABLE = False
    return bool(_FTS5_AVAILABLE)


def _insert_document(
    connection: sqlite3.Connection,
    *,
    source: str,
    category: str,
    title: str,
    content: str,
    chunks: list[tuple[str, str]],
    fts5_enabled: bool,
) -> None:
    checksum = hashlib.sha256(content.encode("utf-8")).hexdigest()
    cursor = connection.execute(
        "INSERT INTO knowledge_documents(source, category, title, checksum, content) VALUES (?, ?, ?, ?, ?)",
        (source, category, title, checksum, content),
    )
    document_id = int(cursor.lastrowid)
    for ordinal, (heading, chunk) in enumerate(chunks):
        chunk_cursor = connection.execute(
            """
            INSERT INTO knowledge_chunks(document_id, source, category, heading, ordinal, content)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (document_id, source, category, heading, ordinal, chunk),
        )
        chunk_id = int(chunk_cursor.lastrowid)
        if fts5_enabled:
            connection.execute(
                """
                INSERT INTO knowledge_chunks_fts(chunk_id, heading, content, source, category)
                VALUES (?, ?, ?, ?, ?)
                """,
                (chunk_id, heading, chunk, source, category),
            )


def sync_knowledge_index(force: bool = False) -> dict:
    global _LAST_FINGERPRINT

    current_fingerprint = _fingerprint()
    with _INDEX_LOCK:
        with _connect() as connection:
            fts5_enabled = _ensure_schema(connection)
            if not force and _LAST_FINGERPRINT == current_fingerprint:
                return knowledge_index_status(connection=connection, fts5_enabled=fts5_enabled)

            connection.execute("DELETE FROM knowledge_chunks")
            connection.execute("DELETE FROM knowledge_documents")
            if fts5_enabled:
                connection.execute("DELETE FROM knowledge_chunks_fts")

            for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
                source = path.relative_to(KNOWLEDGE_DIR).as_posix()
                content = path.read_text(encoding="utf-8").strip()
                if not content:
                    continue
                category = _category_for_source(source)
                document_chunks: list[tuple[str, str]] = []
                for section in _split_markdown_sections(content):
                    for chunk in _chunk_section(section):
                        document_chunks.append((_heading(chunk, source), chunk))
                _insert_document(
                    connection,
                    source=source,
                    category=category,
                    title=_heading(content, source),
                    content=content,
                    chunks=document_chunks,
                    fts5_enabled=fts5_enabled,
                )

            python_rules, scan_errors = scan_python_knowledge()
            for rule in python_rules:
                _insert_document(
                    connection,
                    source=rule.source,
                    category="deterministic",
                    title=rule.heading,
                    content=rule.content,
                    chunks=[(rule.heading, rule.content)],
                    fts5_enabled=fts5_enabled,
                )

            connection.commit()
            _LAST_FINGERPRINT = current_fingerprint
            status = knowledge_index_status(connection=connection, fts5_enabled=fts5_enabled)
            status["python_scan_errors"] = scan_errors
            status["scan_error_count"] = len(scan_errors)
            return status


def knowledge_index_status(
    connection: sqlite3.Connection | None = None,
    fts5_enabled: bool | None = None,
) -> dict:
    owns_connection = connection is None
    if connection is None:
        connection = _connect()
        fts5_enabled = _ensure_schema(connection)
    try:
        document_count = int(connection.execute("SELECT COUNT(*) FROM knowledge_documents").fetchone()[0])
        chunk_count = int(connection.execute("SELECT COUNT(*) FROM knowledge_chunks").fetchone()[0])
        python_rule_count = int(
            connection.execute("SELECT COUNT(*) FROM knowledge_documents WHERE source LIKE 'python://%'").fetchone()[0]
        )
        markdown_document_count = document_count - python_rule_count
        return {
            "mode": "sqlite-fts5-bm25" if fts5_enabled else "sqlite-lexical-fallback",
            "database": _database_path().name,
            "fts5_enabled": bool(fts5_enabled),
            "embedding_enabled": False,
            "document_count": document_count,
            "chunk_count": chunk_count,
            "markdown_document_count": markdown_document_count,
            "python_rule_count": python_rule_count,
        }
    finally:
        if owns_connection:
            connection.close()


def _kind_and_location(source: str, content: str) -> tuple[str, str]:
    if source.startswith("python://"):
        kind_match = re.search(r"^Tipo:\s*([^\.]+)", content, flags=re.MULTILINE)
        kind = kind_match.group(1).strip() if kind_match else "regra Python"
        return kind, source.removeprefix("python://")
    if source.startswith("casos-aprovados/") and not source.endswith("README.md"):
        return "caso aprovado", source
    return "documentação", source


def bm25_retrieve(query: str, limit: int = 5, category: str | None = None) -> list[IndexedKnowledgeChunk]:
    terms = _search_terms(query)
    if not terms:
        return []

    status = sync_knowledge_index()
    if not status["fts5_enabled"]:
        return []

    match_query = " OR ".join(f"{term}*" for term in terms)
    params: list[object] = [match_query]
    category_clause = ""
    if category:
        category_clause = " AND c.category = ?"
        params.append(category)
    params.append(max(1, min(int(limit), 100)))

    sql = f"""
        SELECT
            c.id,
            c.source,
            c.category,
            c.heading,
            c.content,
            bm25(knowledge_chunks_fts, 0.0, 8.0, 1.0, 1.5, 0.0) AS bm25_rank
        FROM knowledge_chunks_fts
        JOIN knowledge_chunks c ON c.id = CAST(knowledge_chunks_fts.chunk_id AS INTEGER)
        WHERE knowledge_chunks_fts MATCH ?{category_clause}
        ORDER BY bm25_rank ASC, c.source ASC, c.ordinal ASC
        LIMIT ?
    """

    with _connect() as connection:
        rows = connection.execute(sql, params).fetchall()
    result: list[IndexedKnowledgeChunk] = []
    for row in rows:
        kind, location = _kind_and_location(str(row["source"]), str(row["content"]))
        result.append(
            IndexedKnowledgeChunk(
                chunk_id=int(row["id"]),
                source=str(row["source"]),
                category=str(row["category"]),
                heading=str(row["heading"]),
                content=str(row["content"]),
                score=max(0.0, -float(row["bm25_rank"])),
                kind=kind,
                location=location,
            )
        )
    return result


def list_catalog_entries(category: str, query: str = "", limit: int = 500) -> dict:
    status = sync_knowledge_index()
    normalized_category = category if category in {"operational", "deterministic"} else "operational"
    requested_limit = max(1, min(int(limit), 2000))

    if query.strip() and status["fts5_enabled"]:
        chunks = bm25_retrieve(query, limit=requested_limit, category=normalized_category)
        items = [
            {
                "id": chunk.chunk_id,
                "source": chunk.source,
                "category": chunk.category,
                "heading": chunk.heading,
                "content": chunk.content,
                "score": round(chunk.score, 6),
                "kind": chunk.kind,
                "location": chunk.location,
            }
            for chunk in chunks
        ]
    else:
        with _connect() as connection:
            rows = connection.execute(
                """
                SELECT id, source, category, heading, content
                FROM knowledge_chunks
                WHERE category = ?
                ORDER BY CASE WHEN source LIKE 'python://%' THEN 1 ELSE 0 END ASC, source ASC, ordinal ASC
                LIMIT ?
                """,
                (normalized_category, requested_limit),
            ).fetchall()
        query_normalized = _normalize(query)
        items = []
        for row in rows:
            searchable = _normalize(f"{row['heading']} {row['content']} {row['source']}")
            if query_normalized and query_normalized not in searchable:
                continue
            kind, location = _kind_and_location(str(row["source"]), str(row["content"]))
            items.append(
                {
                    "id": int(row["id"]),
                    "source": str(row["source"]),
                    "category": str(row["category"]),
                    "heading": str(row["heading"]),
                    "content": str(row["content"]),
                    "score": None,
                    "kind": kind,
                    "location": location,
                }
            )

    return {"index": status, "category": normalized_category, "items": items}
