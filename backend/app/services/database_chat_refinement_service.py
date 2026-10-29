from __future__ import annotations

import re
import unicodedata

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeChunk


_CODE_WORDS = {"python", "codigo", "implementacao", "implementar", "funcao", "metodo"}
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

    if "tipo funcao" in content or "tipo metodo" in content:
        score += 12.0
    if "tipo constante" in content:
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


def refine_database_answer(
    question: str,
    previous_context: dict,
    current: DatabaseKnowledgeAnswer,
) -> DatabaseKnowledgeAnswer:
    """Refino restrito ao código Python contextual.

    A antiga heurística de tópico por 'palavra mais longa' foi removida porque podia
    transformar `Explique ... WIU` em assunto `operacional` e degradar o retrieval.
    Entidades conceituais agora são resolvidas pelo roteador determinístico.
    """

    python_answer = _direct_python_answer(question, previous_context)
    return python_answer if python_answer is not None else current
