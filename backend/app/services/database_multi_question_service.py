from __future__ import annotations

"""Combina apenas perguntas independentes, sem dividir cálculos/comparações correlacionados."""

import re
import unicodedata

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_service import KnowledgeChunk


def _normalize(text: str) -> str:
    value = unicodedata.normalize("NFKD", text.casefold())
    return "".join(ch for ch in value if not unicodedata.combining(ch)).strip()


def split_independent_questions(question: str) -> list[str]:
    segments = [item.strip() for item in str(question or "").split("?") if item.strip()]
    if len(segments) < 2 or len(segments) > 5:
        return []
    # Só dividimos questões independentes de definição ou utilidade. Perguntas
    # encadeadas sobre causa, fórmula ou divergência devem preservar o plano composto.
    independent = re.compile(
        r"^(?:e\s+)?(?:o que e |o que sao |o que significa |qual (?:e )?o significado de |"
        r"qual (?:e )?a definicao de |que dia e hoje|qual e a data de hoje|"
        r"que horas sao(?: agora)?|qual e o dia de hoje)",
    )
    cleaned = []
    for part in segments:
        part = re.sub(r"^e\s+", "", part, flags=re.IGNORECASE).strip()
        if not independent.match(_normalize(part)):
            return []
        cleaned.append(f"{part}?")
    return cleaned


def combine_knowledge_answers(
    questions: list[str],
    answers: list[DatabaseKnowledgeAnswer],
) -> DatabaseKnowledgeAnswer:
    if len(questions) != len(answers) or not answers:
        raise ValueError("Partes da pergunta e respostas inconsistentes.")

    unique_sources: list[str] = []
    unique_entities: list[str] = []
    chunks: list[KnowledgeChunk] = []
    parts = []
    tables = []
    for question, result in zip(questions, answers):
        parts.append(f"**{question}**\n{result.answer}")
        for source in result.sources:
            if source not in unique_sources:
                unique_sources.append(source)
        for entity in result.entities:
            if entity not in unique_entities:
                unique_entities.append(entity)
        for chunk in result.chunks:
            if not any(existing.source == chunk.source and existing.heading == chunk.heading for existing in chunks):
                chunks.append(chunk)
        if result.table:
            tables.append((question, result.table))

    table = None
    if len(tables) == 1:
        table = tables[0][1]
    elif tables:
        # O contrato atual ChatResponse suporta somente uma tabela. Para múltiplas
        # listas independentes, não descartar os registros das demais consultas.
        rows = []
        for question, item in tables:
            for record in item.get("rows") or []:
                values = [f"{col.get('label')}: {record[col['key']]}"
                          for col in item.get("columns") or [] if col.get("key") in record]
                rows.append({"question": question, "details": "; ".join(values)})
        table = {
            "title": "Resultados das consultas",
            "total_rows": len(rows),
            "columns": [{"key": "question", "label": "Pergunta"},
                        {"key": "details", "label": "Dados do registro"}],
            "rows": rows,
        }

    return DatabaseKnowledgeAnswer(
        answer="\n\n".join(parts),
        sources=unique_sources,
        chunks=chunks,
        entities=unique_entities,
        table=table,
        resolved_question=" ".join(questions),
        context={"subject_type": "collection", "subject_key": "perguntas independentes",
                 "topic": "multi_question", "structured_evidence_complete": True,
                 "skip_llm": True},
    )
