from __future__ import annotations

from dataclasses import dataclass, field
import json
import math
import re
import unicodedata

from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeChunk
from app.services.rag_runtime_service import load_runtime_entities


FORMULA_WORDS = {"formula", "fórmula", "calcula", "calcular", "calculo", "cálculo", "equacao", "equação"}
DEFINITION_WORDS = {"significa", "significado", "definicao", "definição", "definir"}
CANONICAL_FORMULA_SOURCES = ("motor-deterministico.md", "regras-globais.md")
DEICTIC_WORDS = {"esse", "essa", "este", "esta", "isso", "deste", "desta", "nesse", "nessa", "neste", "nesta"}

MATERIAL_FIELD_ALIASES = {
    "balance": {"saldo", "balance"},
    "nec": {"nec", "necessidade"},
    "stock_total": {"stk ttl", "stk total", "estoque total"},
    "stock_op": {"stk op", "estoque opcional"},
    "stock": {"stk", "estoque", "stk sap"},
    "explosion": {"explosao", "explosão"},
    "amount": {"amount", "valor saldo"},
    "price": {"preco", "preço"},
    "um": {"um", "unidade", "unidade medida"},
    "group_origin": {"grupo origem", "origem"},
    "optional_material": {"opc", "opcional", "material opcional"},
    "check": {"check"},
    "wiu": {"wiu"},
}

COMPARISON_FIELD_ALIASES = {
    "nec": "nec",
    "stk op": "stock_op",
    "stk ttl": "stock_total",
    "saldo": "balance",
    "explosao": "explosion",
    "explosão": "explosion",
    "stk sap": "stock_sap_effective",
    "stk": "stock_sap_effective",
}


@dataclass(slots=True)
class DatabaseKnowledgeAnswer:
    answer: str
    sources: list[str]
    chunks: list[KnowledgeChunk] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    table: dict | None = None
    resolved_question: str = ""
    context: dict = field(default_factory=dict)


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_-]+", " ", normalized).strip()


def _words(text: str) -> set[str]:
    return set(_normalize(text).split())


def _contains_phrase(normalized: str, phrase: str) -> bool:
    return f" {phrase} " in f" {normalized} "


def _format_number(value: object) -> str:
    if value in (None, ""):
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return str(value)
    if abs(number - round(number)) < 1e-9:
        return f"{int(round(number)):,}".replace(",", ".")
    text = f"{number:,.6f}".rstrip("0").rstrip(".")
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


def _as_chunk(item) -> KnowledgeChunk:
    return KnowledgeChunk(
        source=item.source,
        content=item.content,
        score=item.score,
        heading=item.heading,
        category=item.category,
    )


def _runtime_chunk(entity: dict, heading: str | None = None) -> KnowledgeChunk:
    payload = entity.get("payload") or {}
    return KnowledgeChunk(
        source=str(entity.get("source") or "sqlite://rag_runtime_entities"),
        content=json.dumps(payload, ensure_ascii=False, default=str),
        score=1000.0,
        heading=heading or f"{entity.get('entity_type')} {entity.get('entity_key')}",
        category="current",
    )


def _context_subject(context: dict) -> tuple[str, str]:
    subject_type = str(context.get("subject_type") or "")
    subject_key = str(context.get("subject_key") or "")
    return subject_type, subject_key


def _resolved_question(question: str, context: dict) -> str:
    normalized = _normalize(question)
    subject_type, subject_key = _context_subject(context)
    if subject_key and (_words(question) & DEICTIC_WORDS):
        return f"{question} Contexto anterior: {subject_type or 'assunto'} {subject_key}."
    return question


def _find_exact_entity_key(question: str, entity_type: str) -> str | None:
    normalized = _normalize(question)
    entities = load_runtime_entities(entity_type=entity_type)
    matches = [
        entity["entity_key"]
        for entity in entities
        if _normalize(entity["entity_key"]) and _normalize(entity["entity_key"]) in normalized
    ]
    if not matches:
        return None
    return max(matches, key=len)


def _find_material_key(question: str, context: dict) -> str | None:
    exact = _find_exact_entity_key(question, "material")
    if exact:
        return exact
    subject_type, subject_key = _context_subject(context)
    if subject_type == "material" and subject_key and (_words(question) & DEICTIC_WORDS):
        return subject_key
    return None


def _find_model_key(question: str, context: dict) -> str | None:
    exact = _find_exact_entity_key(question, "model")
    if exact:
        return exact
    subject_type, subject_key = _context_subject(context)
    if subject_type == "model" and subject_key and (_words(question) & DEICTIC_WORDS):
        return subject_key
    return None


def _requested_material_field(question: str) -> str | None:
    normalized = _normalize(question)
    ranked: list[tuple[int, str]] = []
    for field_name, aliases in MATERIAL_FIELD_ALIASES.items():
        for alias in aliases:
            normalized_alias = _normalize(alias)
            if _contains_phrase(normalized, normalized_alias):
                ranked.append((len(normalized_alias), field_name))
    return max(ranked)[1] if ranked else None


def _material_value(payload: dict, field_name: str, scope: str) -> object:
    if field_name == "stock":
        if scope == "scenario":
            return payload.get("stock_sap_effective", payload.get("stock_sap"))
        return payload.get("stock")
    if field_name == "optional_material":
        return payload.get("optional_material", payload.get("opc"))
    return payload.get(field_name)


def _material_is_critical(payload: dict, scope: str) -> bool:
    if scope == "scenario":
        return bool(payload.get("critical")) or str(payload.get("status") or "").upper() == "INVESTIGAR"
    return bool(payload.get("critical"))


def _single_material_answer(question: str, material_key: str) -> DatabaseKnowledgeAnswer | None:
    records = load_runtime_entities(entity_type="material", entity_key=material_key)
    if not records:
        return None
    by_scope = {record["scope"]: record for record in records}
    scenario = by_scope.get("scenario")
    final = by_scope.get("final")
    normalized = _normalize(question)
    sources = [record["source"] for record in records]
    chunks = [_runtime_chunk(record, f"Material {material_key} · {record['scope']}") for record in records]

    if "critic" in normalized or "investigar" in normalized or "risco" in normalized:
        lines: list[str] = []
        if scenario:
            payload = scenario["payload"]
            critical = _material_is_critical(payload, "scenario")
            status = str(payload.get("status") or "—")
            um = str(payload.get("um") or "—")
            lines.append(
                f"No Cenário ORION, o material {material_key} {'está crítico' if critical else 'não está crítico'}. "
                f"Status: {status}; UM: {um}; SALDO ORION: {_format_number(payload.get('balance'))}."
            )
        if final:
            payload = final["payload"]
            critical = _material_is_critical(payload, "final")
            lines.append(
                f"No DPP Final sincronizado, ele {'está marcado como crítico' if critical else 'não está marcado como crítico'} "
                f"e o SALDO Final é {_format_number(payload.get('balance'))}."
            )
        return DatabaseKnowledgeAnswer(
            answer=" ".join(lines),
            sources=sources,
            chunks=chunks,
            entities=[material_key],
            resolved_question=question,
            context={"subject_type": "material", "subject_key": material_key, "topic": "critical"},
        )

    field_name = _requested_material_field(question)
    if field_name:
        labels = {
            "balance": "SALDO", "nec": "NEC", "stock_total": "STK TTL", "stock_op": "STK OP",
            "stock": "STK", "explosion": "EXPLOSÃO", "amount": "Amount", "price": "Preço",
            "um": "UM", "group_origin": "Grupo Origem", "optional_material": "OPC", "check": "CHECK", "wiu": "WIU",
        }
        label = labels.get(field_name, field_name)
        values: list[str] = []
        if scenario:
            values.append(f"Cenário ORION: {_format_number(_material_value(scenario['payload'], field_name, 'scenario'))}")
        if final:
            values.append(f"DPP Final: {_format_number(_material_value(final['payload'], field_name, 'final'))}")
        return DatabaseKnowledgeAnswer(
            answer=f"{label} do material {material_key} — " + "; ".join(values) + ".",
            sources=sources,
            chunks=chunks,
            entities=[material_key, label],
            resolved_question=question,
            context={"subject_type": "material", "subject_key": material_key, "topic": field_name},
        )

    rows = []
    for scope_name, record in (("Cenário ORION", scenario), ("DPP Final", final)):
        if not record:
            continue
        payload = record["payload"]
        rows.append({
            "source": scope_name,
            "description": payload.get("description") or "—",
            "um": payload.get("um") or "—",
            "nec": _format_number(payload.get("nec")),
            "stock_total": _format_number(payload.get("stock_total")),
            "balance": _format_number(payload.get("balance")),
            "critical": "Sim" if _material_is_critical(payload, record["scope"]) else "Não",
        })
    return DatabaseKnowledgeAnswer(
        answer=f"Encontrei o material {material_key} no banco sincronizado. Os principais campos estão na tabela.",
        sources=sources,
        chunks=chunks,
        entities=[material_key],
        table={
            "title": f"Material {material_key}",
            "total_rows": len(rows),
            "columns": [
                {"key": "source", "label": "Fonte"},
                {"key": "description", "label": "Descrição"},
                {"key": "um", "label": "UM"},
                {"key": "nec", "label": "NEC", "align": "right"},
                {"key": "stock_total", "label": "STK TTL", "align": "right"},
                {"key": "balance", "label": "SALDO", "align": "right"},
                {"key": "critical", "label": "Crítico"},
            ],
            "rows": rows,
        },
        resolved_question=question,
        context={"subject_type": "material", "subject_key": material_key, "topic": "overview"},
    )


def _critical_materials_answer(question: str) -> DatabaseKnowledgeAnswer | None:
    normalized = _normalize(question)
    if "materia" not in normalized or not ("critic" in normalized or "investigar" in normalized):
        return None
    records = [
        record
        for record in load_runtime_entities(entity_type="material", scope="scenario")
        if _material_is_critical(record["payload"], "scenario")
    ]
    if not records:
        return DatabaseKnowledgeAnswer(
            answer="O banco sincronizado não possui materiais críticos no Cenário ORION atual.",
            sources=["sqlite://rag_runtime_entities/material/scenario"],
            resolved_question=question,
            context={"subject_type": "collection", "subject_key": "materiais críticos", "topic": "critical"},
        )
    records.sort(key=lambda record: (float(record["payload"].get("balance") or 0), record["entity_key"]))
    rows = [
        {
            "material": record["entity_key"],
            "description": record["payload"].get("description") or "—",
            "um": record["payload"].get("um") or "—",
            "balance": _format_number(record["payload"].get("balance")),
        }
        for record in records
    ]
    return DatabaseKnowledgeAnswer(
        answer=(
            f"O Cenário ORION atual possui {len(records)} materiais críticos no banco sincronizado. "
            "A lista completa está na tabela abaixo."
        ),
        sources=["sqlite://rag_runtime_entities/material/scenario"],
        chunks=[_runtime_chunk(records[0], "Materiais críticos · consulta estruturada")],
        entities=[record["entity_key"] for record in records],
        table={
            "title": "Materiais críticos · Cenário ORION",
            "total_rows": len(rows),
            "columns": [
                {"key": "material", "label": "Material", "kind": "code"},
                {"key": "description", "label": "Descrição", "kind": "description"},
                {"key": "um", "label": "UM"},
                {"key": "balance", "label": "SALDO ORION", "align": "right"},
            ],
            "rows": rows,
        },
        resolved_question=question,
        context={"subject_type": "collection", "subject_key": "materiais críticos", "topic": "critical"},
    )


def _single_model_answer(question: str, model_key: str) -> DatabaseKnowledgeAnswer | None:
    records = load_runtime_entities(entity_type="model", entity_key=model_key)
    if not records:
        return None
    rows = []
    for record in records:
        payload = record["payload"]
        rows.append({
            "source": "Cenário ORION" if record["scope"] == "scenario" else "DPP Final",
            "kit": _format_number(payload.get("kit_pgd", payload.get("pgd"))),
            "real": _format_number(payload.get("real")),
            "delta": _format_number(payload.get("difference_real_vs_kit", payload.get("delta"))),
        })
    return DatabaseKnowledgeAnswer(
        answer=f"Encontrei o modelo {model_key} no workspace sincronizado.",
        sources=[record["source"] for record in records],
        chunks=[_runtime_chunk(record, f"Modelo {model_key}") for record in records],
        entities=[model_key],
        table={
            "title": f"Modelo {model_key}",
            "total_rows": len(rows),
            "columns": [
                {"key": "source", "label": "Fonte"},
                {"key": "kit", "label": "KIT/PGD", "align": "right"},
                {"key": "real", "label": "REAL", "align": "right"},
                {"key": "delta", "label": "Diferença", "align": "right"},
            ],
            "rows": rows,
        },
        resolved_question=question,
        context={"subject_type": "model", "subject_key": model_key, "topic": "overview"},
    )


def _comparison_field(question: str) -> tuple[str, str] | None:
    normalized = _normalize(question)
    ranked: list[tuple[int, str, str]] = []
    for alias, field_name in COMPARISON_FIELD_ALIASES.items():
        normalized_alias = _normalize(alias)
        if _contains_phrase(normalized, normalized_alias):
            ranked.append((len(normalized_alias), alias, field_name))
    if not ranked:
        return None
    _, alias, field_name = max(ranked)
    return alias.upper(), field_name


def _comparison_answer(question: str) -> DatabaseKnowledgeAnswer | None:
    normalized = _normalize(question)
    if not ("comparativ" in normalized or "diverg" in normalized):
        return None
    field = _comparison_field(question)
    if field and "diverg" in normalized:
        label, field_name = field
        scenario_records = {record["entity_key"]: record for record in load_runtime_entities(entity_type="material", scope="scenario")}
        final_records = {record["entity_key"]: record for record in load_runtime_entities(entity_type="material", scope="final")}
        rows = []
        for key in sorted(set(scenario_records) | set(final_records)):
            scenario = scenario_records.get(key)
            final = final_records.get(key)
            if scenario:
                scenario_value = _material_value(scenario["payload"], field_name, "scenario")
            else:
                scenario_value = None
            if final:
                final_value = _material_value(final["payload"], field_name, "final")
            else:
                final_value = None
            try:
                left = float(scenario_value or 0)
                right = float(final_value or 0)
                delta = right - left
                divergent = scenario is None or final is None or abs(delta) > 1e-4
            except (TypeError, ValueError):
                delta = None
                divergent = str(scenario_value or "") != str(final_value or "")
            if not divergent:
                continue
            payload = (scenario or final or {}).get("payload") or {}
            rows.append({
                "material": key,
                "description": payload.get("description") or "—",
                "orion": _format_number(scenario_value),
                "final": _format_number(final_value),
                "delta": _format_number(delta) if delta is not None else "—",
            })
        return DatabaseKnowledgeAnswer(
            answer=f"A comparação de {label} possui {len(rows)} divergências calculadas a partir dos valores armazenados no SQLite.",
            sources=["sqlite://rag_runtime_entities/material/scenario", "sqlite://rag_runtime_entities/material/final"],
            entities=[label],
            table={
                "title": f"Divergências · {label}",
                "total_rows": len(rows),
                "columns": [
                    {"key": "material", "label": "Material", "kind": "code"},
                    {"key": "description", "label": "Descrição", "kind": "description"},
                    {"key": "orion", "label": "Cenário ORION", "align": "right"},
                    {"key": "final", "label": "DPP Final", "align": "right"},
                    {"key": "delta", "label": "Diferença", "align": "right"},
                ],
                "rows": rows,
            },
            resolved_question=question,
            context={"subject_type": "comparison", "subject_key": label, "topic": "divergence"},
        )

    summaries = load_runtime_entities(entity_type="comparison_summary")
    if not summaries:
        return None
    payload = summaries[0]["payload"]
    columns = load_runtime_entities(entity_type="comparison_column")
    rows = []
    for record in columns:
        item = record["payload"]
        if not item.get("supported"):
            continue
        rows.append({
            "column": item.get("name") or record["entity_key"],
            "differences": item.get("difference_count"),
            "delta": _format_number(item.get("delta")),
        })
    rows.sort(key=lambda row: int(row.get("differences") or 0), reverse=True)
    return DatabaseKnowledgeAnswer(
        answer=(
            f"O comparativo sincronizado possui {payload.get('columns_total', len(rows))} colunas, "
            f"{payload.get('comparable_columns', len(rows))} comparáveis e {payload.get('divergent_columns', 0)} com divergência."
        ),
        sources=[summaries[0]["source"], *[record["source"] for record in columns[:5]]],
        chunks=[_runtime_chunk(summaries[0], "Resumo do comparativo")],
        table={
            "title": "Comparativo completo das colunas do DPP",
            "total_rows": len(rows),
            "columns": [
                {"key": "column", "label": "Coluna"},
                {"key": "differences", "label": "Valores divergentes", "align": "right"},
                {"key": "delta", "label": "Diferença agregada", "align": "right"},
            ],
            "rows": rows,
        },
        resolved_question=question,
        context={"subject_type": "comparison", "subject_key": "comparativo completo", "topic": "summary"},
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


def _definition_answer(question: str) -> DatabaseKnowledgeAnswer | None:
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
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=[item.source],
        chunks=[_as_chunk(item)],
        entities=[term],
        resolved_question=question,
        context={"subject_type": "concept", "subject_key": term, "topic": "definition"},
    )


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


def _formula_answer(question: str) -> DatabaseKnowledgeAnswer | None:
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

    implementation = ""
    explanation = ""
    for block in [block.strip() for block in re.split(r"\n\s*\n", item.content) if block.strip()]:
        clean = re.sub(r"^#{1,6}\s*", "", block.strip()).replace("**", "").replace("__", "")
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
    subject = max((word for word in query_words if word not in FORMULA_WORDS and len(word) > 2), key=len, default=item.heading)
    return DatabaseKnowledgeAnswer(
        answer=answer[:1400],
        sources=[item.source],
        chunks=[_as_chunk(item)],
        entities=[subject],
        resolved_question=question,
        context={"subject_type": "rule", "subject_key": subject, "topic": item.heading},
    )


def _python_answer(question: str, context: dict) -> DatabaseKnowledgeAnswer | None:
    normalized = _normalize(question)
    if "python" not in normalized and "codigo" not in normalized and "implement" not in normalized:
        return None
    subject_type, subject_key = _context_subject(context)
    resolved = _resolved_question(question, context)
    query = resolved if subject_key else question
    candidates = bm25_retrieve(query, limit=80, category="deterministic")
    python_candidates = [
        item for item in candidates
        if item.source.startswith("python://")
        and not re.search(r"(?:demo|mock|test|fixture)", item.source, flags=re.IGNORECASE)
    ]
    if not python_candidates:
        return None
    item = python_candidates[0]
    lines = [line.strip() for line in item.content.splitlines() if line.strip()]
    metadata = [line for line in lines if line.startswith(("Símbolo:", "Arquivo:", "Linhas:", "Assinatura:", "Documentação do código:"))]
    implementation_index = next((index for index, line in enumerate(lines) if line == "Implementação Python:"), None)
    implementation = ""
    if implementation_index is not None:
        implementation = " ".join(lines[implementation_index + 1:])[:1200]
    answer = " ".join(metadata[:5])
    if implementation:
        answer += f" Implementação: {implementation}"
    if not answer:
        answer = item.content[:1400]
    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=[item.source],
        chunks=[_as_chunk(item)],
        entities=[subject_key] if subject_key else [],
        resolved_question=resolved,
        context={"subject_type": subject_type or "rule", "subject_key": subject_key or item.heading, "topic": item.heading},
    )


def _source_authority(source: str, question: str) -> float:
    normalized_source = source.lower()
    normalized_question = _normalize(question)
    if normalized_source.endswith("readme.md"):
        return 0.15
    if re.search(r"(?:demo|mock|test|fixture)", normalized_source):
        return 0.05
    if source.startswith("workspace://"):
        return 1.35
    if source == "motor-deterministico.md":
        return 1.45
    if source == "regras-globais.md":
        return 1.35
    if source == "glossario.md":
        return 1.30
    if source.startswith("python://"):
        return 1.15 if ("python" in normalized_question or "codigo" in normalized_question) else 0.55
    return 1.0


def _relevant_sentences(question: str, content: str, max_chars: int = 900) -> str:
    query_words = {word for word in _words(question) if len(word) > 2}
    cleaned = re.sub(r"^#{1,6}\s*", "", content, flags=re.MULTILINE)
    cleaned = cleaned.replace("**", "").replace("__", "")
    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", cleaned) if part.strip()]
    ranked: list[tuple[int, int, str]] = []
    for index, part in enumerate(parts):
        if part.startswith("|") or part == "---":
            continue
        overlap = len(query_words & _words(part))
        if overlap:
            ranked.append((overlap, -index, part))
    ranked.sort(reverse=True)
    selected: list[str] = []
    size = 0
    for _, _, part in ranked:
        if part in selected:
            continue
        if selected and size + len(part) > max_chars:
            continue
        selected.append(part)
        size += len(part)
        if len(selected) >= 4:
            break
    return " ".join(selected).strip()


def _generic_rag_answer(question: str, context: dict) -> DatabaseKnowledgeAnswer | None:
    resolved = _resolved_question(question, context)
    candidates = bm25_retrieve(resolved, limit=40)
    if not candidates:
        return None
    ranked = sorted(
        candidates,
        key=lambda item: item.score * _source_authority(item.source, resolved),
        reverse=True,
    )
    selected = []
    for item in ranked:
        if _source_authority(item.source, resolved) < 0.2:
            continue
        text = _relevant_sentences(resolved, item.content)
        if not text:
            continue
        selected.append((item, text))
        if len(selected) >= 2:
            break
    if not selected:
        return None
    answer = " ".join(text for _, text in selected)
    sources = list(dict.fromkeys(item.source for item, _ in selected))
    subject_type, subject_key = _context_subject(context)
    if not subject_key:
        meaningful = [word for word in _words(question) if len(word) > 3 and word not in {"qual", "quais", "como", "sobre", "sabemos"}]
        subject_key = max(meaningful, key=len, default=selected[0][0].heading)
        subject_type = "knowledge"
    return DatabaseKnowledgeAnswer(
        answer=answer[:1800],
        sources=sources,
        chunks=[_as_chunk(item) for item, _ in selected],
        entities=[subject_key] if subject_key else [],
        resolved_question=resolved,
        context={"subject_type": subject_type or "knowledge", "subject_key": subject_key, "topic": selected[0][0].heading},
    )


def answer_database_knowledge(question: str, context: dict | None = None) -> DatabaseKnowledgeAnswer:
    context = context or {}
    resolved = _resolved_question(question, context)

    material_key = _find_material_key(question, context)
    if material_key:
        answer = _single_material_answer(resolved, material_key)
        if answer is not None:
            return answer

    critical = _critical_materials_answer(resolved)
    if critical is not None:
        return critical

    model_key = _find_model_key(question, context)
    if model_key:
        answer = _single_model_answer(resolved, model_key)
        if answer is not None:
            return answer

    comparison = _comparison_answer(resolved)
    if comparison is not None:
        return comparison

    definition = _definition_answer(resolved)
    if definition is not None:
        return definition

    formula = _formula_answer(resolved)
    if formula is not None:
        return formula

    python_answer = _python_answer(question, context)
    if python_answer is not None:
        return python_answer

    generic = _generic_rag_answer(question, context)
    if generic is not None:
        return generic

    return DatabaseKnowledgeAnswer(
        answer=(
            "Não encontrei evidência suficiente no SQLite/RAG do ORION para responder essa pergunta. "
            "Nenhuma resposta externa ou pré-definida foi usada."
        ),
        sources=[],
        chunks=[],
        resolved_question=resolved,
        context=context,
    )
