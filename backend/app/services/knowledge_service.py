from dataclasses import dataclass
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR, RAG_TOP_K


STOP_WORDS = {
    "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "no", "na",
    "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
}

FORMULA_INTENT_TOKENS = {
    "formula", "calcula", "calculo", "calculado", "calcular", "equacao", "regra",
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


def _heading(chunk: KnowledgeChunk) -> str:
    first_line = chunk.content.splitlines()[0].strip() if chunk.content else ""
    return re.sub(r"^#{1,6}\s*", "", first_line).strip()


def _is_formula_query(query: str) -> bool:
    tokens = _tokens(query)
    normalized = _normalize(query)
    return bool(tokens & FORMULA_INTENT_TOKENS) or "como o orion calcula" in normalized


def _table_density(content: str) -> float:
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not lines:
        return 0.0
    table_lines = sum(1 for line in lines if line.startswith("|") and line.endswith("|"))
    return table_lines / len(lines)


def retrieve_context(query: str, top_k: int | None = None) -> list[KnowledgeChunk]:
    query_tokens = _tokens(query)
    limit = top_k or RAG_TOP_K
    ranked: list[KnowledgeChunk] = []
    formula_query = _is_formula_query(query)

    for chunk in load_knowledge_chunks():
        chunk_tokens = _tokens(chunk.content)
        heading_tokens = _tokens(_heading(chunk))
        overlap = query_tokens & chunk_tokens
        heading_overlap = query_tokens & heading_tokens
        source_tokens = _tokens(chunk.source)

        score = float(
            len(overlap) * 3
            + len(heading_overlap) * 9
            + len(query_tokens & source_tokens) * 2
        )

        if formula_query:
            if chunk.source in ENGINE_KNOWLEDGE_SOURCES:
                score += 6
            if "formula" in chunk_tokens or "fórmula" in chunk.content.lower():
                score += 5
            if "=" in chunk.content:
                score += 3
            if _table_density(chunk.content) >= 0.45:
                score -= 12

        if "guardrails" in chunk.source:
            score += 0.25

        if score > 0:
            ranked.append(
                KnowledgeChunk(source=chunk.source, content=chunk.content, score=score)
            )

    ranked.sort(key=lambda item: item.score, reverse=True)
    return ranked[:limit]


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
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _formula_from_chunk(chunk: KnowledgeChunk) -> str | None:
    candidates = re.findall(r"`([^`]*=[^`]*)`", chunk.content)
    if candidates:
        return _clean_inline_markdown(candidates[0])

    lines = chunk.content.splitlines()
    for index, raw_line in enumerate(lines):
        if _normalize(raw_line).strip() != "formula":
            continue
        for next_line in lines[index + 1:index + 4]:
            cleaned = _clean_inline_markdown(next_line)
            if cleaned and "=" in cleaned:
                return cleaned
    return None


def _formula_answer(chunk: KnowledgeChunk) -> str:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", chunk.content) if block.strip()]
    heading = _heading(chunk)
    formula = _formula_from_chunk(chunk)

    definition = ""
    explanation = ""
    implementation = ""

    for block in blocks[1:]:
        clean = _clean_markdown_for_chat(block)
        if not clean:
            continue
        normalized = _normalize(clean)
        if normalized == "formula" or (formula and formula in clean):
            continue
        if normalized.startswith("implementacao") or normalized.startswith("fonte tecnica"):
            implementation = clean
            continue
        if not definition:
            definition = clean
            continue
        if not explanation:
            explanation = clean

    parts: list[str] = []
    if definition:
        parts.append(definition.rstrip("."))
    elif heading:
        parts.append(heading)
    if formula:
        parts.append(f"Fórmula: {formula}")
    if explanation:
        parts.append(explanation.rstrip("."))
    if implementation:
        parts.append(implementation.rstrip("."))

    answer = ". ".join(part for part in parts if part).strip()
    if answer and not answer.endswith("."):
        answer += "."
    return answer


def _best_formula_chunk(query: str, chunks: list[KnowledgeChunk]) -> KnowledgeChunk | None:
    query_tokens = _tokens(query)
    for chunk in chunks:
        if chunk.source not in ENGINE_KNOWLEDGE_SOURCES:
            continue
        if not _formula_from_chunk(chunk):
            continue
        heading_tokens = _tokens(_heading(chunk))
        if query_tokens & heading_tokens:
            return chunk

    for chunk in chunks:
        if _formula_from_chunk(chunk):
            return chunk
    return None


def answer_from_knowledge(query: str, top_k: int | None = None) -> KnowledgeAnswer:
    chunks = retrieve_context(query, top_k=top_k or max(RAG_TOP_K, 6))
    if not chunks:
        return KnowledgeAnswer(
            answer=(
                "Não encontrei uma regra validada na base de conhecimento local para responder essa pergunta. "
                "Posso responder somente sobre informações registradas e validadas do motor ORION nesta etapa."
            ),
            sources=[],
            chunks=[],
        )

    if _is_formula_query(query):
        formula_chunk = _best_formula_chunk(query, chunks)
        if formula_chunk is not None:
            answer = _formula_answer(formula_chunk)
            if answer:
                return KnowledgeAnswer(
                    answer=answer,
                    sources=[formula_chunk.source],
                    chunks=[formula_chunk],
                )

    best_score = chunks[0].score
    selected = [chunks[0]]
    for chunk in chunks[1:]:
        if len(selected) >= 2:
            break
        if chunk.score >= max(best_score * 0.82, best_score - 3):
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
            "RAG local ativo com recuperação lexical por seções e síntese determinística por intenção. "
            "Perguntas objetivas de fórmula retornam somente a regra relevante; uma LLM poderá usar "
            "os mesmos trechos depois."
        ),
    }
