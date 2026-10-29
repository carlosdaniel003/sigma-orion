from __future__ import annotations

"""Serviço utilitário para data/hora de operação, sem necessidade de RAG ou LLM."""

from datetime import datetime
import os
import re
import unicodedata
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_service import KnowledgeChunk


WEEKDAYS = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
            "sexta-feira", "sábado", "domingo")


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).strip(" ?.! ")


def _clock_now(timezone: str) -> datetime:
    return datetime.now(ZoneInfo(timezone))


def answer_clock_question(question: str) -> DatabaseKnowledgeAnswer | None:
    normalized = _normalize(question)
    wants_date = bool(re.fullmatch(
        r"(?:que|qual)(?: e o| e a| e)? dia(?: da semana)? (?:e )?hoje|"
        r"(?:qual (?:e )?a |que )?data (?:de )?hoje|"
        r"(?:hoje e|qual e a data atual|qual e o dia atual)",
        normalized,
    ))
    wants_time = bool(re.fullmatch(
        r"(?:que|qual)(?: e a| e)? hora(?:s)? (?:sao|e|agora)|"
        r"(?:que horas sao agora|hora atual|horario atual|"
        r"me diga (?:a hora|o horario) atual)",
        normalized,
    ))
    if not wants_date and not wants_time:
        return None
    timezone = os.getenv("ORION_TIMEZONE", "America/Manaus")
    try:
        now = _clock_now(timezone)
    except ZoneInfoNotFoundError:
        timezone = "UTC"
        now = _clock_now(timezone)

    date_text = f"{WEEKDAYS[now.weekday()]}, {now.day:02d}/{now.month:02d}/{now.year:04d}"
    if wants_time:
        answer = f"Agora são {now:%H:%M} ({timezone}). Hoje é {date_text}."
    else:
        answer = f"Hoje é {date_text} (fuso horário: {timezone})."
    source = f"runtime://clock/{timezone}"
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=[source],
        chunks=[KnowledgeChunk(source=source, content=f"Relógio do servidor: {now.isoformat()}",
                               score=1000, heading="Data e hora atual", category="runtime")],
        entities=[],
        resolved_question=question,
        context={"subject_type": "utility", "subject_key": "clock",
                 "topic": "current_time" if wants_time else "current_date",
                 "structured_evidence_complete": True, "skip_llm": True},
    )
