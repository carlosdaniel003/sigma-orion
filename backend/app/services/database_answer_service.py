from __future__ import annotations

import re
import unicodedata

from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeAnswer, KnowledgeChunk, answer_from_knowledge


FORMULA_WORDS = {"formula", "fórmula", "calcula", "calcular", "calculo", "cálculo", "equacao", "equação"}
DEFINITION_WORDS = {"significa", "significado", "definicao", "definição", "definir"}
CANONICAL_FORMULA_SOURCES = ("motor-deterministico.md", "regras-globais.md")


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized).strip()


def _words(text: str) -> set[str]:
    return set(_normalize(text).split())


def _as_chunk(item) -> KnowledgeChunk:
    return KnowledgeChunk(
        source=item.source,
        content=item.content,
        score=item.score,
        heading=item.heading,
        category=item.category,
    )


def _is_definition(question: str) -> bool:
    normalized = _normalize(question)
    words = _words(question)
    return (
        bool(words & {_normalize(word) for word in DEFINITION_WORDS})
        or normalized.startswith("o que e ")
        or normalized.startswith("o que sao ")
        or normalized.startswith("o que significa ")
    )


def _definition_answer(question: str) -> KnowledgeAnswer | None:
    if not _is_definition(question):
        return None
    normalized_question = _normalize(question)
    candidates = bm25_retrieve(question, limit=100, category="operational")
    glossary = [item for item in candidates if item.source == "glossario.md"]
    matches: list[tuple[str, str, str, object]] = []
    for item in glossary:
        for raw_line in item.content.splitlines():
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
            if normalized_term and re.search(rf"(?:^|\s){re.escape(normalized_term)}(?:\s|$)", normalized_question):
                matches.append((term, meaning, validation, item))
    if not matches:
        return None
    matches.sort(key=lambda row: len(_normalize(row[0])), reverse=True)
    term, meaning, validation, item = matches[0]
    answer = f"{term}: {meaning}"
    if validation and _normalize(validation) != "a confirmar":
        answer += f" Fonte/validação: {validation}."
    elif not answer.endswith("."):
        answer += "."
    chunk = _as_chunk(item)
    return KnowledgeAnswer(answer=answer, sources=[item.source], chunks=[chunk])


def _is_formula(question: str) -> bool:
    words = _words(question)
    return bool(words & {_normalize(word) for word in FORMULA_WORDS}) or "como o orion calcula" in _normalize(question)


def _formula_from_content(content: str) -> str | None:
    formulas = re.findall(r"`([^`\n]*=[^`\n]*)`", content)
    if formulas:
        return formulas[0].strip()
    for raw_line in content.splitlines():
        line = raw_line.strip().strip("` ")
        if "=" in line and len(line) < 280 and not line.startswith(("http", "{")):
            return line
    return None


def _formula_answer(question: str) -> KnowledgeAnswer | None:
    if not _is_formula(question):
        return None
    query_words = _words(question)
    candidates = bm25_retrieve(question, limit=100, category="deterministic")
    ranked = []
    for item in candidates:
        if item.source not in CANONICAL_FORMULA_SOURCES:
            continue
        formula = _formula_from_content(item.content)
        if not formula:
            continue
        heading_words = _words(item.heading)
        meaningful = {word for word in query_words if len(word) > 2 and word not in {"qual", "para", "como", "formula", "calcula", "calcular", "calculo"}}
        if meaningful and not (meaningful & heading_words):
            continue
        ranked.append((CANONICAL_FORMULA_SOURCES.index(item.source), -item.score, item, formula))
    if not ranked:
        return None
    ranked.sort(key=lambda row: (row[0], row[1]))
    _, _, item, formula = ranked[0]

    blocks = [block.strip() for block in re.split(r"\n\s*\n", item.content) if block.strip()]
    explanation = ""
    implementation = ""
    for block in blocks:
        clean = re.sub(r"^#{1,6}\s*", "", block.strip())
        clean = clean.replace("**", "").replace("__", "")
        if formula in clean:
            clean = clean.replace(f"`{formula}`", "").replace(formula, "").strip(" .:\n")
        normalized = _normalize(clean)
        if not clean or normalized == "formula":
            continue
        if "implementacao canonica" in normalized or normalized.startswith("implementacao"):
            implementation = clean
            continue
        if not explanation and (query_words & _words(clean)):
            explanation = clean
    parts = [re.sub(r"^#{1,6}\s*", "", item.heading).strip(), f"Fórmula: {formula}"]
    if explanation and explanation not in parts:
        parts.append(explanation)
    if implementation:
        parts.append(implementation)
    answer = ". ".join(part.rstrip(".") for part in parts if part).strip() + "."
    chunk = _as_chunk(item)
    return KnowledgeAnswer(answer=answer[:1400], sources=[item.source], chunks=[chunk])


def answer_database_knowledge(question: str) -> KnowledgeAnswer:
    definition = _definition_answer(question)
    if definition is not None:
        return definition
    formula = _formula_answer(question)
    if formula is not None:
        return formula
    return answer_from_knowledge(question)
