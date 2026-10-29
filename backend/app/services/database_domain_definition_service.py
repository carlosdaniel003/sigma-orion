from __future__ import annotations

"""Resolução direta de termos; o glossário versionado é a fonte única dos significados."""

from pathlib import Path
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR
from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_service import KnowledgeChunk


def _normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", str(text or "").casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", value).strip()


def _subject(question: str) -> str | None:
    normalized = _normalize(question).strip(" ?.!")
    templates = (
        r"(?:o que e|o que sao|o que significa|qual (?:e )?o significado de|"
        r"qual (?:e )?a definicao de|defina|"
        r"me (?:fala|fale|explica|explique) sobre|explique|"
        r"o que quer dizer)\s+(.+)",
    )
    match = re.fullmatch(templates[0], normalized)
    if match:
        subject = match.group(1).strip(" ?.!")
        subject = re.sub(r"\s+(?:no|dentro do) orion$", "", subject).strip()
        subject = re.sub(r"\s+(?:no|dentro do) dpp$", "", subject).strip()
        return subject
    # Siglas isoladas também podem ser consultadas sem pergunta explícita.
    if re.fullmatch(r"[a-z]{2,6}(?: [a-z]{2,6})?", normalized) and question.strip().upper() == question.strip().strip(" ?.!"):
        return normalized
    return None


def _glossary_entries(path: Path) -> dict[str, tuple[str, str, str]]:
    result: dict[str, tuple[str, str, str]] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not (line.startswith("|") and line.endswith("|")):
            continue
        cells = [part.strip() for part in line.strip("|").split("|")]
        if len(cells) < 3:
            continue
        term, meaning, validation = cells[:3]
        if term == "Termo" or set(term) <= {":", "-"}:
            continue
        result[_normalize(term)] = (term, meaning, validation)
    return result


def answer_domain_definition(question: str) -> DatabaseKnowledgeAnswer | None:
    subject = _subject(question)
    if not subject:
        return None
    path = KNOWLEDGE_DIR / "glossario.md"
    if not path.is_file():
        return None
    match = _glossary_entries(path).get(subject)
    if not match:
        return None
    term, meaning, validation = match
    content = f"{term}: {meaning}"
    if validation and _normalize(validation) != "a confirmar":
        content += f" Fonte/validação: {validation}."
    elif not content.endswith("."):
        content += "."
    source = "glossario.md"
    return DatabaseKnowledgeAnswer(
        answer=content,
        sources=[source],
        chunks=[KnowledgeChunk(source=source, content=f"{term}: {meaning}\nValidação: {validation}",
                               score=1000.0, heading=f"Glossário · {term}", category="operational")],
        entities=[term],
        resolved_question=question,
        context={"subject_type": "concept", "subject_key": term, "topic": "definition",
                 "structured_evidence_complete": True, "skip_llm": True},
    )
