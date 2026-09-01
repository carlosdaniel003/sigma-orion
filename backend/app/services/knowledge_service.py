from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR, RAG_TOP_K
from app.services.knowledge_catalog_service import _connect, bm25_retrieve, sync_knowledge_index


STOP_WORDS = {
    "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "no", "na",
    "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
    "qual", "quais", "como", "quando", "onde", "porque", "significa", "significado",
    "definicao", "definir", "formula", "calcula", "calculo", "calculado", "calcular",
    "equacao", "regra", "dia", "hoje",
}

FORMULA_INTENT_TOKENS = {
    "formula", "calcula", "calculo", "calculado", "calcular", "equacao",
}

DEFINITION_INTENT_TOKENS = {
    "significa", "significado", "definicao", "definir",
}

ENGINE_KNOWLEDGE_SOURCES = {
    "motor-deterministico.md",
    "regras-globais.md",
}


@dataclass(slots=True)
class KnowledgeChunk:
    source: str
    content: str
    score: float = 0.0
    heading: str = ""
    category: str = ""


@dataclass(slots=True)
class KnowledgeAnswer:
    answer: str
    sources: list[str]
    chunks: list[KnowledgeChunk]


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized).strip()


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in _normalize(text).split()
        if len(token) > 2 and token not in STOP_WORDS
    }


def _raw_tokens(text: str) -> set[str]:
    return {token for token in _normalize(text).split() if len(token) > 2}


def load_knowledge_chunks() -> list[KnowledgeChunk]:
    """Read the indexed knowledge from SQLite. Chat answers never reread source files directly."""
    sync_knowledge_index()
    with _connect() as connection:
        rows = connection.execute(
            "SELECT source, category, heading, content FROM knowledge_chunks ORDER BY id"
        ).fetchall()
    return [
        KnowledgeChunk(
            source=str(row["source"]),
            category=str(row["category"]),
            heading=str(row["heading"]),
            content=str(row["content"]),
        )
        for row in rows
    ]


def load_guardrails() -> str:
    sync_knowledge_index()
    with _connect() as connection:
        row = connection.execute(
            "SELECT content FROM knowledge_documents WHERE source = ? LIMIT 1",
            ("guardrails.md",),
        ).fetchone()
    return str(row["content"]) if row is not None else ""


def _is_formula_query(query: str) -> bool:
    raw_tokens = _raw_tokens(query)
    normalized = _normalize(query)
    return bool(raw_tokens & FORMULA_INTENT_TOKENS) or "como o orion calcula" in normalized


def _is_definition_query(query: str) -> bool:
    raw_tokens = _raw_tokens(query)
    normalized = _normalize(query)
    return (
        bool(raw_tokens & DEFINITION_INTENT_TOKENS)
        or normalized.startswith("o que e ")
        or normalized.startswith("o que sao ")
        or normalized.startswith("o que significa ")
    )


def retrieve_context(query: str, top_k: int | None = None) -> list[KnowledgeChunk]:
    """Retrieve exclusively from the synchronized SQLite FTS5/BM25 index."""
    if not _tokens(query):
        return []
    indexed = bm25_retrieve(query, limit=top_k or RAG_TOP_K)
    return [
        KnowledgeChunk(
            source=item.source,
            content=item.content,
            score=item.score,
            heading=item.heading,
            category=item.category,
        )
        for item in indexed
    ]


def _clean_inline_markdown(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^#{1,6}\s*", "", cleaned)
    cleaned = re.sub(r"^>\s*", "", cleaned)
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    return cleaned.strip()


def _clean_markdown_for_chat(content: str) -> str:
    lines: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line == "---":
            continue
        if line.startswith("|") and line.endswith("|"):
            continue
        line = _clean_inline_markdown(line)
        if _normalize(line) == "formula":
            continue
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _formula_from_chunk(chunk: KnowledgeChunk) -> str | None:
    candidates = re.findall(r"`([^`]*=[^`]*)`", chunk.content)
    if candidates:
        return _clean_inline_markdown(candidates[0])
    for raw_line in chunk.content.splitlines():
        cleaned = _clean_inline_markdown(raw_line)
        if "=" in cleaned and len(cleaned) <= 280 and not cleaned.startswith(("http", "{")):
            return cleaned
    return None


def _formula_candidates(query: str, initial: list[KnowledgeChunk]) -> list[KnowledgeChunk]:
    indexed = bm25_retrieve(query, limit=max(30, RAG_TOP_K * 6), category="deterministic")
    if not indexed:
        return initial
    return [
        KnowledgeChunk(
            source=item.source,
            content=item.content,
            score=item.score,
            heading=item.heading,
            category=item.category,
        )
        for item in indexed
    ]


def _best_formula_chunk(query: str, chunks: list[KnowledgeChunk]) -> KnowledgeChunk | None:
    subject_tokens = _tokens(query)
    candidates: list[KnowledgeChunk] = []
    for chunk in chunks:
        if chunk.source not in ENGINE_KNOWLEDGE_SOURCES:
            continue
        if not _formula_from_chunk(chunk):
            continue
        heading_tokens = _tokens(chunk.heading or chunk.content.splitlines()[0])
        if subject_tokens and not (subject_tokens & heading_tokens):
            continue
        candidates.append(chunk)
    source_order = {"motor-deterministico.md": 0, "regras-globais.md": 1}
    candidates.sort(key=lambda item: (source_order.get(item.source, 99), -item.score))
    return candidates[0] if candidates else None


def _formula_answer(chunk: KnowledgeChunk) -> str:
    formula = _formula_from_chunk(chunk)
    blocks = [block.strip() for block in re.split(r"\n\s*\n", chunk.content) if block.strip()]
    parts: list[str] = []
    for block in blocks:
        clean = _clean_markdown_for_chat(block)
        if not clean:
            continue
        if formula and formula in clean:
            clean = clean.replace(formula, "").strip(" .:-")
        normalized = _normalize(clean)
        if normalized in {"", "formula"}:
            continue
        parts.append(clean.rstrip("."))
        if len(parts) >= 3:
            break
    answer_parts = []
    if parts:
        answer_parts.append(parts[0])
    if formula:
        answer_parts.append(f"Fórmula: {formula}")
    answer_parts.extend(parts[1:])
    answer = ". ".join(part for part in answer_parts if part).strip()
    answer = re.sub(r"\s{2,}", " ", answer)
    if answer and not answer.endswith("."):
        answer += "."
    return answer[:1200]


def _glossary_answer(query: str, chunks: list[KnowledgeChunk]) -> KnowledgeAnswer | None:
    if not _is_definition_query(query):
        return None
    normalized_query = _normalize(query)
    matches: list[tuple[str, str, str, KnowledgeChunk]] = []
    for chunk in chunks:
        if chunk.source != "glossario.md":
            continue
        for raw_line in chunk.content.splitlines():
            line = raw_line.strip()
            if not (line.startswith("|") and line.endswith("|")):
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) < 3:
                continue
            term, meaning, validation = cells[:3]
            if term.lower() == "termo" or set(term) <= {"-", ":"}:
                continue
            normalized_term = _normalize(term)
            if normalized_term and re.search(rf"(?:^|\s){re.escape(normalized_term)}(?:\s|$)", normalized_query):
                matches.append((term, meaning, validation, chunk))
    if not matches:
        return None
    matches.sort(key=lambda item: len(_normalize(item[0])), reverse=True)
    term, meaning, validation, chunk = matches[0]
    answer = f"{term}: {meaning}"
    if validation and _normalize(validation) != "a confirmar":
        answer += f" Fonte/validação: {validation}."
    elif not answer.endswith("."):
        answer += "."
    return KnowledgeAnswer(answer=answer, sources=[chunk.source], chunks=[chunk])


def _relevant_text(query: str, chunk: KnowledgeChunk) -> str:
    if chunk.source.startswith("workspace://"):
        return chunk.content.strip()[:1800]

    query_tokens = _tokens(query)
    blocks = [block.strip() for block in re.split(r"\n\s*\n", chunk.content) if block.strip()]
    selected: list[str] = []
    for block in blocks:
        if query_tokens and not (query_tokens & _tokens(block)):
            continue
        cleaned = _clean_markdown_for_chat(block)
        if cleaned:
            selected.append(cleaned)
        if len(selected) >= 2:
            break
    if not selected:
        cleaned = _clean_markdown_for_chat(chunk.content)
        if cleaned:
            selected.append(cleaned)
    return "\n".join(selected).strip()[:1800]


def _insufficient_answer() -> KnowledgeAnswer:
    return KnowledgeAnswer(
        answer=(
            "Não encontrei evidência suficiente no banco de conhecimento SQLite do ORION para responder essa pergunta. "
            "O Agente não completa a resposta com conhecimento externo nem com respostas pré-definidas."
        ),
        sources=[],
        chunks=[],
    )


def answer_from_knowledge(query: str, top_k: int | None = None) -> KnowledgeAnswer:
    chunks = retrieve_context(query, top_k=top_k or max(RAG_TOP_K, 12))
    if not chunks:
        return _insufficient_answer()

    glossary_answer = _glossary_answer(query, chunks)
    if glossary_answer is not None:
        return glossary_answer

    if _is_formula_query(query):
        formula_chunk = _best_formula_chunk(query, _formula_candidates(query, chunks))
        if formula_chunk is not None:
            answer = _formula_answer(formula_chunk)
            if answer:
                return KnowledgeAnswer(answer=answer, sources=[formula_chunk.source], chunks=[formula_chunk])

    selected: list[KnowledgeChunk] = []
    best_score = chunks[0].score
    for chunk in chunks:
        if len(selected) >= 3:
            break
        if selected and best_score > 0 and chunk.score < best_score * 0.45:
            continue
        text = _relevant_text(query, chunk)
        if not text:
            continue
        selected.append(chunk)

    if not selected:
        return _insufficient_answer()

    answer_parts = [_relevant_text(query, chunk) for chunk in selected]
    answer_parts = [part for part in answer_parts if part]
    if not answer_parts:
        return _insufficient_answer()
    sources = list(dict.fromkeys(chunk.source for chunk in selected))
    return KnowledgeAnswer(answer="\n\n".join(answer_parts), sources=sources, chunks=selected)


def knowledge_status() -> dict:
    status = sync_knowledge_index()
    with _connect() as connection:
        runtime_documents = int(connection.execute(
            "SELECT COUNT(*) FROM knowledge_documents WHERE source LIKE 'workspace://%'"
        ).fetchone()[0])
        audit_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='rag_chat_audit'"
        ).fetchone()
        audit_count = int(connection.execute("SELECT COUNT(*) FROM rag_chat_audit").fetchone()[0]) if audit_table else 0
    status.update(
        {
            "files": sorted(path.relative_to(KNOWLEDGE_DIR).as_posix() for path in KNOWLEDGE_DIR.rglob("*.md")),
            "runtime_document_count": runtime_documents,
            "chat_audit_count": audit_count,
            "message": (
                "RAG DB-first ativo: respostas consultam exclusivamente o índice SQLite/FTS5/BM25. "
                "Documentos, regras Python e o workspace DPP sincronizado são recuperados do banco antes da resposta."
            ),
        }
    )
    return status
