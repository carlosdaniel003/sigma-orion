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


def _chunk_markdown(source: str, content: str, max_chars: int = 1600) -> list[KnowledgeChunk]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", content) if block.strip()]
    chunks: list[KnowledgeChunk] = []
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
            "RAG inicial ativo com recuperação lexical local. A interface já está desacoplada "
            "para substituir este retriever por embeddings posteriormente."
        ),
    }
