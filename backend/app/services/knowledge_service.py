from dataclasses import dataclass
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR, RAG_TOP_K
from app.services.knowledge_catalog_service import bm25_retrieve, knowledge_index_status, sync_knowledge_index


STOP_WORDS = {
    "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "no", "na",
    "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
    "qual", "quais", "como", "quando", "onde", "porque", "significa", "significado",
    "definicao", "definir", "formula", "calcula", "calculo", "calculado", "calcular",
    "equacao", "regra",
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

MIN_GENERIC_SCORE = 0.000001


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


def _lexical_fallback(query: str, limit: int) -> list[KnowledgeChunk]:
    query_tokens = _tokens(query)
    if not query_tokens:
        return []
    ranked: list[KnowledgeChunk] = []
    for chunk in load_knowledge_chunks():
        chunk_tokens = _tokens(chunk.content)
        heading_tokens = _tokens(_heading(chunk))
        overlap = query_tokens & chunk_tokens
        heading_overlap = query_tokens & heading_tokens
        if not overlap and not heading_overlap:
            continue
        score = float(len(overlap) * 3 + len(heading_overlap) * 9)
        ranked.append(KnowledgeChunk(source=chunk.source, content=chunk.content, score=score))
    ranked.sort(key=lambda item: item.score, reverse=True)
    return ranked[:limit]


def retrieve_context(query: str, top_k: int | None = None) -> list[KnowledgeChunk]:
    limit = top_k or RAG_TOP_K
    try:
        indexed = bm25_retrieve(query, limit=limit)
        if indexed:
            return [
                KnowledgeChunk(source=item.source, content=item.content, score=item.score)
                for item in indexed
            ]
    except Exception:
        pass
    return _lexical_fallback(query, limit)


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
    lines = chunk.content.splitlines()
    for index, raw_line in enumerate(lines):
        if _normalize(raw_line) != "formula":
            continue
        for next_line in lines[index + 1:index + 4]:
            cleaned = _clean_inline_markdown(next_line)
            if cleaned and "=" in cleaned:
                return cleaned
    return None


def _best_formula_chunk(query: str, chunks: list[KnowledgeChunk]) -> KnowledgeChunk | None:
    subject_tokens = _tokens(query)
    candidates: list[KnowledgeChunk] = []
    for chunk in chunks:
        if chunk.source not in ENGINE_KNOWLEDGE_SOURCES:
            continue
        if not _formula_from_chunk(chunk):
            continue
        if subject_tokens and not (subject_tokens & _tokens(_heading(chunk))):
            continue
        candidates.append(chunk)
    return candidates[0] if candidates else None


def _formula_answer(chunk: KnowledgeChunk) -> str:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", chunk.content) if block.strip()]
    heading = _heading(chunk)
    formula = _formula_from_chunk(chunk)
    definition = ""
    explanation = ""
    implementation = ""
    formula_seen = False

    for block in blocks[1:]:
        clean = _clean_markdown_for_chat(block)
        normalized = _normalize(clean)
        if not clean:
            continue
        if normalized == "formula":
            formula_seen = True
            continue
        if formula and formula in clean:
            formula_seen = True
            remainder = clean.replace(formula, "").strip(" .:-")
            if _normalize(remainder) in {"", "formula"}:
                continue
            clean = remainder
            normalized = _normalize(clean)
        if normalized.startswith("implementacao") or normalized.startswith("fonte tecnica"):
            implementation = clean
            continue
        if not formula_seen and not definition:
            definition = clean
            continue
        if formula_seen and not explanation:
            explanation = clean
            continue
        if not definition:
            definition = clean
        elif not explanation:
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
    answer = re.sub(r"\bFórmula\s*:\s*\.", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"\s{2,}", " ", answer).strip()
    if answer and not answer.endswith("."):
        answer += "."
    return answer


def _glossary_answer(query: str) -> KnowledgeAnswer | None:
    if not _is_definition_query(query):
        return None
    path = KNOWLEDGE_DIR / "glossario.md"
    if not path.exists():
        return None
    normalized_query = _normalize(query)
    matches: list[tuple[str, str, str]] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
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
            matches.append((term, meaning, validation))
    if not matches:
        return None
    matches.sort(key=lambda item: len(_normalize(item[0])), reverse=True)
    term, meaning, validation = matches[0]
    answer = f"{term}: {meaning}"
    if validation and _normalize(validation) != "a confirmar":
        answer += f" Fonte/validação: {validation}."
    elif not answer.endswith("."):
        answer += "."
    chunk = KnowledgeChunk(
        source="glossario.md",
        content=f"{term}: {meaning}\nFonte/Validação: {validation}",
        score=100.0,
    )
    return KnowledgeAnswer(answer=answer, sources=["glossario.md"], chunks=[chunk])


def _insufficient_answer() -> KnowledgeAnswer:
    return KnowledgeAnswer(
        answer=(
            "Não encontrei informação validada na base local do ORION para responder essa pergunta. "
            "Nesta etapa, o Agente responde sobre o sistema ORION, o motor determinístico Python e os dados DPP sincronizados; ele não deve preencher lacunas com uma resposta não suportada pelas fontes."
        ),
        sources=[],
        chunks=[],
    )


def answer_from_knowledge(query: str, top_k: int | None = None) -> KnowledgeAnswer:
    glossary_answer = _glossary_answer(query)
    if glossary_answer is not None:
        return glossary_answer

    chunks = retrieve_context(query, top_k=top_k or max(RAG_TOP_K, 6))
    if not chunks:
        return _insufficient_answer()

    if _is_formula_query(query):
        formula_chunk = _best_formula_chunk(query, chunks)
        if formula_chunk is not None:
            answer = _formula_answer(formula_chunk)
            if answer:
                return KnowledgeAnswer(answer=answer, sources=[formula_chunk.source], chunks=[formula_chunk])
        return _insufficient_answer()

    if chunks[0].score < MIN_GENERIC_SCORE:
        return _insufficient_answer()

    best_score = chunks[0].score
    selected = [chunks[0]]
    for chunk in chunks[1:]:
        if len(selected) >= 2:
            break
        threshold = best_score * 0.72 if best_score > 0 else 0
        if chunk.score >= threshold:
            selected.append(chunk)

    answer_parts = [_clean_markdown_for_chat(chunk.content) for chunk in selected]
    answer_parts = [part for part in answer_parts if part]
    sources = list(dict.fromkeys(chunk.source for chunk in selected))
    if not answer_parts:
        return _insufficient_answer()
    return KnowledgeAnswer(answer="\n\n".join(answer_parts), sources=sources, chunks=selected)


def knowledge_status() -> dict:
    try:
        status = sync_knowledge_index()
        status.update(
            {
                "files": sorted(path.relative_to(KNOWLEDGE_DIR).as_posix() for path in KNOWLEDGE_DIR.rglob("*.md")),
                "message": (
                    "RAG local ativo com índice persistido em SQLite, recuperação FTS5/BM25, "
                    "tratamento determinístico para definições e fórmulas e fallback lexical quando necessário."
                ),
            }
        )
        return status
    except Exception:
        chunks = load_knowledge_chunks()
        return {
            "mode": "lexical-local",
            "embedding_enabled": False,
            "fts5_enabled": False,
            "files": sorted(path.relative_to(KNOWLEDGE_DIR).as_posix() for path in KNOWLEDGE_DIR.rglob("*.md")),
            "document_count": len({chunk.source for chunk in chunks}),
            "chunk_count": len(chunks),
            "message": "Índice SQLite indisponível; RAG operando em fallback lexical local.",
        }
