from __future__ import annotations

import re
import unicodedata

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeChunk


_CODE_WORDS = {"python", "codigo", "implementacao", "implementar", "funcao", "metodo"}
_ABOUT_STOP_WORDS = {
    "o", "a", "os", "as", "que", "de", "do", "da", "dos", "das", "e", "em", "no", "na",
    "nos", "nas", "um", "uma", "sobre", "sabemos", "sabe", "conhecemos", "conhecimento", "qual",
    "quais", "me", "diga", "fale", "explique", "orion",
}
_NOISE_SOURCE_RE = re.compile(r"(?:demo|mock|test|fixture)", flags=re.IGNORECASE)


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_.-]+", " ", normalized).strip()


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


def _is_code_question(question: str) -> bool:
    words = _words(question)
    normalized = _normalize(question)
    return bool(words & _CODE_WORDS) or ".py" in normalized


def _python_candidate_score(item, subject: str) -> float:
    subject_normalized = _normalize(subject)
    subject_words = {word for word in _words(subject) if len(word) > 1}
    heading = _normalize(item.heading)
    content = _normalize(item.content)
    source = _normalize(item.source)
    searchable_words = _words(f"{item.heading} {item.content} {item.source}")

    score = float(item.score)
    if subject_normalized and subject_normalized in heading:
        score += 50.0
    if subject_normalized and subject_normalized in source:
        score += 25.0
    score += 8.0 * len(subject_words & _words(item.heading))
    score += 3.0 * len(subject_words & searchable_words)
    score += min(content.count(subject_normalized), 8) * 1.5 if subject_normalized else 0.0

    normalized_content = _normalize(item.content)
    if "tipo funcao" in normalized_content or "tipo metodo" in normalized_content:
        score += 12.0
    if "tipo constante" in normalized_content:
        score -= 8.0
    return score


def _direct_python_answer(question: str, previous_context: dict) -> DatabaseKnowledgeAnswer | None:
    if not _is_code_question(question):
        return None
    subject = str(previous_context.get("subject_key") or "").strip()
    if not subject:
        return None

    candidates = bm25_retrieve(subject, limit=100, category="deterministic")
    python_candidates = [
        item
        for item in candidates
        if item.source.startswith("python://")
        and not _NOISE_SOURCE_RE.search(item.source)
        and (_words(subject) & _words(f"{item.heading} {item.content} {item.source}"))
    ]
    if not python_candidates:
        return DatabaseKnowledgeAnswer(
            answer=(
                f"Não encontrei uma função ou método Python indexado com vínculo direto ao assunto {subject}. "
                "O ORION não vai substituir essa ausência por uma função apenas lexicalmente parecida."
            ),
            sources=[],
            chunks=[],
            entities=[subject],
            resolved_question=f"{question} Contexto anterior: {subject}.",
            context={**previous_context, "subject_key": subject},
        )

    python_candidates.sort(key=lambda item: _python_candidate_score(item, subject), reverse=True)
    item = python_candidates[0]
    lines = [line.strip() for line in item.content.splitlines() if line.strip()]
    metadata = [
        line
        for line in lines
        if line.startswith(("Símbolo:", "Arquivo:", "Linhas:", "Assinatura:", "Documentação do código:"))
    ]
    implementation_index = next((index for index, line in enumerate(lines) if line == "Implementação Python:"), None)
    implementation = ""
    if implementation_index is not None:
        implementation = " ".join(lines[implementation_index + 1:])[:1200]

    answer = f"Implementação Python diretamente relacionada a {subject}. " + " ".join(metadata[:5])
    if implementation:
        answer += f" Implementação: {implementation}"

    return DatabaseKnowledgeAnswer(
        answer=answer[:1700],
        sources=[item.source],
        chunks=[_as_chunk(item)],
        entities=[subject],
        resolved_question=f"{question} Contexto anterior: {subject}.",
        context={
            "subject_type": previous_context.get("subject_type") or "rule",
            "subject_key": subject,
            "topic": item.heading,
        },
    )


def _topical_subject(question: str) -> str | None:
    normalized = _normalize(question)
    if not (
        normalized.startswith("o que sabemos sobre ")
        or normalized.startswith("o que sabe sobre ")
        or normalized.startswith("fale sobre ")
        or normalized.startswith("explique ")
    ):
        return None
    words = [word for word in _normalize(question).split() if len(word) > 1 and word not in _ABOUT_STOP_WORDS]
    if not words:
        return None
    return max(words, key=len)


def _source_authority(source: str) -> float:
    source_lower = source.lower()
    if source_lower.endswith("readme.md"):
        return 0.05
    if _NOISE_SOURCE_RE.search(source_lower):
        return 0.01
    if source == "motor-deterministico.md":
        return 1.50
    if source == "regras-globais.md":
        return 1.45
    if source == "glossario.md":
        return 1.35
    if source.startswith("python://"):
        return 0.45
    return 1.0


def _clean_sentence(text: str) -> str:
    cleaned = re.sub(r"^#{1,6}\s*", "", text.strip())
    return cleaned.replace("**", "").replace("__", "").strip()


def _subject_sentences(subject: str, content: str, max_chars: int = 1300) -> str:
    subject_words = _words(subject)
    parts = [
        _clean_sentence(part)
        for part in re.split(r"(?<=[.!?])\s+|\n+", content)
        if part.strip()
    ]
    selected: list[str] = []
    size = 0
    for part in parts:
        if not part or part.startswith("|") or part == "---":
            continue
        if not (subject_words & _words(part)):
            continue
        if selected and size + len(part) > max_chars:
            break
        selected.append(part)
        size += len(part)
        if len(selected) >= 5:
            break
    return " ".join(selected).strip()


def _topical_answer(question: str) -> DatabaseKnowledgeAnswer | None:
    subject = _topical_subject(question)
    if not subject:
        return None
    candidates = bm25_retrieve(subject, limit=80)
    if not candidates:
        return None

    subject_words = _words(subject)
    ranked = []
    for item in candidates:
        if _source_authority(item.source) < 0.1:
            continue
        heading_overlap = len(subject_words & _words(item.heading))
        content_overlap = len(subject_words & _words(item.content))
        if not heading_overlap and not content_overlap:
            continue
        score = float(item.score) * _source_authority(item.source)
        score += heading_overlap * 25.0
        score += min(content_overlap, 3) * 4.0
        ranked.append((score, item))
    if not ranked:
        return None
    ranked.sort(key=lambda row: row[0], reverse=True)

    selected = []
    for _, item in ranked:
        text = _subject_sentences(subject, item.content)
        if not text:
            continue
        selected.append((item, text))
        if len(selected) >= 2:
            break
    if not selected:
        return None

    answer = " ".join(text for _, text in selected)
    sources = list(dict.fromkeys(item.source for item, _ in selected))
    return DatabaseKnowledgeAnswer(
        answer=answer[:1800],
        sources=sources,
        chunks=[_as_chunk(item) for item, _ in selected],
        entities=[subject.upper() if len(subject) <= 8 else subject],
        resolved_question=question,
        context={"subject_type": "knowledge", "subject_key": subject.upper(), "topic": selected[0][0].heading},
    )


def refine_database_answer(
    question: str,
    previous_context: dict,
    current: DatabaseKnowledgeAnswer,
) -> DatabaseKnowledgeAnswer:
    python_answer = _direct_python_answer(question, previous_context)
    if python_answer is not None:
        return python_answer

    topical = _topical_answer(question)
    if topical is not None:
        return topical

    return current
