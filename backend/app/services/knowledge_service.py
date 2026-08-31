from dataclasses import dataclass
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR, RAG_TOP_K


STOP_WORDS = {
    "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "no", "na",
    "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
}


@dataclass(slots=True)
class KnowledgeChunk:
    source: str
    content: str
    score: float = 0.0


@dataclass(slots=True)
class KnowledgeAnswer:
    answer: str
    sources: list[str]
    chunks: list[KnowledgeChunk]


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text.lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized)


def _tokens(text: str) -> set[str]:
    return {
        token
        for token in _normalize(text).split()
        if len(token) > 2 and token not in STOP_WORDS
    }


def _split_markdown_sections(content: str) -> list[str]:
    sections = [
        section.strip()
        for section in re.split(r"(?=^#{2,4}\s+)", content, flags=re.MULTILINE)
        if section.strip()
    ]
    return sections or ([content.strip()] if content.strip() else [])


def _chunk_markdown(source: str, content: str, max_chars: int = 1800) -> list[KnowledgeChunk]:
    chunks: list[KnowledgeChunk] = []

    for section in _split_markdown_sections(content):
        if len(section) <= max_chars:
            chunks.append(KnowledgeChunk(source=source, content=section))
            continue

        blocks = [block.strip() for block in re.split(r"\n\s*\n", section) if block.strip()]
        current: list[str] = []
        current_size = 0
        for block in blocks:
            if current and current_size + len(block) > max_chars:
                chunks.append(KnowledgeChunk(source=source, content="\n\n".join(current)))
                current = []
                current_size = 0
            current.append(block)
            current_size += len(block)
        if current:
            chunks.append(KnowledgeChunk(source=source, content="\n\n".join(current)))

    return chunks


def load_knowledge_chunks() -> list[KnowledgeChunk]:
    chunks: list[KnowledgeChunk] = []

    for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        relative = path.relative_to(KNOWLEDGE_DIR).as_posix()
        content = path.read_text(encoding="utf-8").strip()
        if content:
            chunks.extend(_chunk_markdown(relative, content))

    return chunks


def load_guardrails() -> str:
    path = KNOWLEDGE_DIR / "guardrails.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def retrieve_context(query: str, top_k: int | None = None) -> list[KnowledgeChunk]:
    query_tokens = _tokens(query)
    limit = top_k or RAG_TOP_K
    ranked: list[KnowledgeChunk] = []

    for chunk in load_knowledge_chunks():
        chunk_tokens = _tokens(chunk.content)
        overlap = query_tokens & chunk_tokens
        source_tokens = _tokens(chunk.source)

        score = float(len(overlap) * 3 + len(query_tokens & source_tokens) * 2)
        if "guardrails" in chunk.source:
            score += 0.25

        if score > 0:
            ranked.append(
                KnowledgeChunk(source=chunk.source, content=chunk.content, score=score)
            )

    ranked.sort(key=lambda item: item.score, reverse=True)
    return ranked[:limit]


def _clean_markdown_for_chat(content: str) -> str:
    lines: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line == "---":
            continue
        line = re.sub(r"^#{1,6}\s*", "", line)
        line = re.sub(r"^>\s*", "", line)
        line = line.replace("**", "").replace("__", "")
        line = re.sub(r"`([^`]+)`", r"\1", line)
        lines.append(line)
    return "\n".join(lines).strip()


def answer_from_knowledge(query: str, top_k: int | None = None) -> KnowledgeAnswer:
    chunks = retrieve_context(query, top_k=top_k or max(RAG_TOP_K, 4))
    if not chunks:
        return KnowledgeAnswer(
            answer=(
                "Não encontrei uma regra validada na base de conhecimento local para responder essa pergunta. "
                "Posso responder somente sobre informações registradas e validadas do motor ORION nesta etapa."
            ),
            sources=[],
            chunks=[],
        )

    best_score = chunks[0].score
    selected = [chunks[0]]
    for chunk in chunks[1:]:
        if len(selected) >= 2:
            break
        if chunk.score >= max(best_score * 0.72, best_score - 4):
            selected.append(chunk)

    answer_parts = [_clean_markdown_for_chat(chunk.content) for chunk in selected]
    answer_parts = [part for part in answer_parts if part]
    sources = list(dict.fromkeys(chunk.source for chunk in selected))

    return KnowledgeAnswer(
        answer="\n\n".join(answer_parts),
        sources=sources,
        chunks=selected,
    )


def knowledge_status() -> dict:
    files = sorted(path.relative_to(KNOWLEDGE_DIR).as_posix() for path in KNOWLEDGE_DIR.rglob("*.md"))
    chunks = load_knowledge_chunks()
    return {
        "mode": "lexical-local",
        "embedding_enabled": False,
        "files": files,
        "document_count": len(files),
        "chunk_count": len(chunks),
        "message": (
            "RAG local ativo com recuperação lexical por seções. No modo offline, o chat responde "
            "diretamente com trechos validados desta base; uma LLM poderá usar os mesmos trechos depois."
        ),
    }
