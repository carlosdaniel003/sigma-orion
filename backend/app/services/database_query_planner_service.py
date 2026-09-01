from __future__ import annotations

from dataclasses import dataclass, field
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR
from app.services.dpp_rule_registry import known_rule_codes
from app.services.dpp_status_registry import known_status_codes


DEICTIC_WORDS = {
    "esse", "essa", "este", "esta", "isso", "deste", "desta", "nesse", "nessa",
    "neste", "nesta", "ele", "ela", "dele", "dela",
}
EXPLANATION_MARKERS = (
    "por que", "porque", "explique", "explica", "causa", "motivo", "impacto",
    "interfere", "influencia", "como funciona", "o que aconteceu", "o que mudou",
    "mudou", "divergiu",
)
CODE_MARKERS = ("python", "codigo", "implementacao", "implementar", "funcao", "metodo", ".py")
SMALLTALK_PREFIXES = (
    "oi", "ola", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada", "valeu",
)
DEFINITION_FOCUS_MARKERS = (
    "significado", "significa", "definicao", "quer dizer", "o que e", "o que sao", "sobre",
)


@dataclass(slots=True)
class QueryPlan:
    original_question: str
    resolved_question: str
    retrieval_question: str
    intent: str
    entities: list[str] = field(default_factory=list)
    concept_entities: list[str] = field(default_factory=list)
    status_entities: list[str] = field(default_factory=list)
    rule_entities: list[str] = field(default_factory=list)
    required_queries: list[str] = field(default_factory=list)
    required_terms: list[str] = field(default_factory=list)
    needs_synthesis: bool = False
    allow_python: bool = False
    smalltalk: bool = False


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_.-]+", " ", normalized).strip()


def _words(text: str) -> set[str]:
    return set(_normalize(text).split())


def _glossary_terms() -> list[str]:
    path = KNOWLEDGE_DIR / "glossario.md"
    if not path.exists():
        return []
    terms: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not (line.startswith("|") and line.endswith("|")):
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        term = cells[0]
        if not term or _normalize(term) == "termo" or set(term) <= {"-", ":"}:
            continue
        terms.append(term)
    return sorted(dict.fromkeys(terms), key=lambda item: len(_normalize(item)), reverse=True)


def _concept_entities(question: str) -> list[str]:
    matches: list[str] = []
    occupied: list[tuple[int, int]] = []
    normalized_question = f" {_normalize(question)} "
    for term in _glossary_terms():
        normalized_term = _normalize(term)
        if not normalized_term:
            continue
        pattern = re.compile(rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])")
        match = pattern.search(normalized_question)
        if not match:
            continue
        span = match.span()
        if any(not (span[1] <= left or span[0] >= right) for left, right in occupied):
            continue
        occupied.append(span)
        matches.append(term)
    return matches


def _status_entities(question: str) -> list[str]:
    normalized = _normalize(question)
    matches: list[str] = []
    for code in known_status_codes():
        if re.search(rf"(?<![a-z0-9_]){re.escape(_normalize(code))}(?![a-z0-9_])", normalized):
            matches.append(code)
    return matches


def _rule_entities(question: str) -> list[str]:
    known = set(known_rule_codes())
    found: list[str] = []
    for match in re.finditer(r"\bREGRA\s*[-_]?\s*(\d{3})\b", str(question or ""), flags=re.IGNORECASE):
        code = f"REGRA-{match.group(1)}"
        if code in known and code not in found:
            found.append(code)
    return found


def _definition_focus(question: str, concepts: list[str]) -> str | None:
    if not concepts:
        return None
    normalized = _normalize(question)
    anchors = [normalized.find(marker) for marker in DEFINITION_FOCUS_MARKERS if normalized.find(marker) >= 0]
    if not anchors:
        return None
    anchor = min(anchors)
    ranked: list[tuple[int, int, str]] = []
    for concept in concepts:
        position = normalized.find(_normalize(concept))
        if position < 0:
            continue
        after_penalty = 0 if position >= anchor else 10000
        ranked.append((after_penalty + abs(position - anchor), position, concept))
    if not ranked:
        return None
    ranked.sort(key=lambda row: (row[0], row[1]))
    return ranked[0][2]


def _last_entity(context: dict, entity_type: str | None = None) -> tuple[str, str] | None:
    items = context.get("last_entities") or []
    if not isinstance(items, list):
        return None
    for item in reversed(items):
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "")
        key = str(item.get("key") or "").strip()
        if key and (entity_type is None or item_type == entity_type):
            return item_type or "assunto", key
    return None


def _context_reference(question: str, context: dict) -> tuple[str, str] | None:
    words = _words(question)
    normalized = _normalize(question)
    elliptical = len(words) <= 5 and any(marker in normalized for marker in ("por que", "porque", "e esse", "e ele", "e ela"))
    if not (words & DEICTIC_WORDS or elliptical):
        return None

    if "status" in words:
        status = _last_entity(context, "status")
        if status:
            return status
    if "regra" in words:
        rule = _last_entity(context, "rule")
        if rule:
            return rule
    if "material" in words:
        material = _last_entity(context, "material")
        if material:
            return material

    if "isso" in words:
        recent = _last_entity(context)
        if recent:
            return recent

    subject_key = str(context.get("subject_key") or "").strip()
    if subject_key:
        return str(context.get("subject_type") or "assunto"), subject_key
    return _last_entity(context)


def _intent(question: str) -> str:
    normalized = _normalize(question)
    words = _words(question)
    if any(marker in normalized for marker in CODE_MARKERS):
        return "code"
    if "compar" in normalized or "diverg" in normalized or "diferenc" in normalized:
        return "comparison"
    if any(marker in normalized for marker in EXPLANATION_MARKERS):
        return "explanation"
    if words & {"formula", "calculo", "calcula", "calcular", "equacao"}:
        return "formula"
    if (
        "significa" in normalized
        or "significado" in normalized
        or "definicao" in normalized
        or "quer dizer" in normalized
        or normalized.startswith("o que e ")
        or normalized.startswith("o que sao ")
        or normalized.startswith("o que sabemos sobre ")
        or normalized.startswith("fale sobre ")
        or normalized.startswith("o que diz ")
        or normalized.startswith("e o que diz ")
    ):
        return "definition"
    return "fact"


def _is_smalltalk(question: str) -> bool:
    normalized = _normalize(question)
    if not normalized:
        return False
    words = normalized.split()
    return len(words) <= 5 and any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in SMALLTALK_PREFIXES)


def _rule_requirements(question: str, context: dict, concepts: list[str], statuses: list[str], intent: str) -> tuple[list[str], list[str]]:
    normalized = _normalize(question)
    normalized_concepts = {_normalize(item): item for item in concepts}
    queries: list[str] = []
    terms: list[str] = list(concepts)

    def add(query: str, term: str | None = None) -> None:
        if query and query not in queries:
            queries.append(query)
        if term and term not in terms:
            terms.append(term)

    for concept in concepts:
        add(concept)

    context_topic = _normalize(str(context.get("topic") or ""))
    if intent == "explanation" and ("critic" in normalized or context_topic == "critical"):
        add("REGRA-004 material crítico UM SALDO", "REGRA-004")

    if any(status in {"FORA_ESCOPO_UM", "OK", "INVESTIGAR"} for status in statuses) and intent == "explanation":
        add("REGRA-004 material crítico UM SALDO", "REGRA-004")

    if "opc" in normalized_concepts:
        add("REGRA-005 OPC STK OP material opcional", "OPC")
    if "stk ttl" in normalized_concepts:
        add("REGRA-002 STK TTL STK SAP EXPLOSÃO STK OP", "STK TTL")
    if "saldo" in normalized_concepts:
        add("REGRA-003 SALDO STK TTL NEC", "SALDO")
    if "nec" in normalized_concepts:
        add("REGRA-001 NEC REAL consumo", "NEC")

    return queries, terms


def plan_database_question(question: str, context: dict | None = None) -> QueryPlan:
    """Planeja a consulta sem chamar LLM.

    O plano usa somente a pergunta, catálogos versionados e o contexto persistido.
    Depois de definida a intenção, os executores não devem reinterpretar a pergunta
    para escolher outra rota. A LLM só entra após SQL/Python/RAG produzirem evidências.
    """

    context = context or {}
    stripped = str(question or "").strip()
    if _is_smalltalk(stripped):
        return QueryPlan(
            original_question=stripped,
            resolved_question=stripped,
            retrieval_question=stripped,
            intent="smalltalk",
            smalltalk=True,
        )

    concepts = _concept_entities(stripped)
    statuses = _status_entities(stripped)
    rules = _rule_entities(stripped)
    normalized_question = _normalize(stripped)
    focus = _definition_focus(stripped, concepts)
    has_definition_focus = any(marker in normalized_question for marker in ("significado", "significa", "definicao", "quer dizer"))
    if focus and has_definition_focus:
        concepts = [focus]

    context_ref = None if statuses or rules else _context_reference(stripped, context)
    resolved = stripped
    entities = [*concepts, *statuses, *rules]
    if context_ref:
        subject_type, subject_key = context_ref
        if _normalize(subject_key) not in _normalize(resolved):
            resolved = f"{stripped} Contexto anterior: {subject_type} {subject_key}."
        if subject_key not in entities:
            entities.insert(0, subject_key)
        if subject_type == "status" and subject_key.upper() in known_status_codes() and subject_key.upper() not in statuses:
            statuses.append(subject_key.upper())
        if subject_type == "rule" and subject_key.upper() in known_rule_codes() and subject_key.upper() not in rules:
            rules.append(subject_key.upper())

    intent = _intent(stripped)
    retrieval_question = resolved

    if rules:
        retrieval_question = rules[0]
    elif statuses and intent == "definition":
        retrieval_question = f"Status {statuses[0]}"
    elif len(concepts) == 1 and (
        intent == "definition"
        or (intent == "explanation" and ("significado" in normalized_question or "significa" in normalized_question))
    ):
        retrieval_question = f"O que significa {concepts[0]}?"

    allow_python = intent == "code"
    required_queries, required_terms = _rule_requirements(stripped, context, concepts, statuses, intent)

    needs_synthesis = intent in {"explanation", "comparison", "code"}
    if rules:
        needs_synthesis = False
    if statuses and intent == "definition":
        needs_synthesis = False
    if intent == "definition" and normalized_question.startswith(("explique ", "fale sobre ")):
        needs_synthesis = True
    if normalized_question.startswith("explique "):
        needs_synthesis = True

    return QueryPlan(
        original_question=stripped,
        resolved_question=resolved,
        retrieval_question=retrieval_question,
        intent=intent,
        entities=entities,
        concept_entities=concepts,
        status_entities=statuses,
        rule_entities=rules,
        required_queries=required_queries,
        required_terms=required_terms,
        needs_synthesis=needs_synthesis,
        allow_python=allow_python,
        smalltalk=False,
    )


def smalltalk_answer() -> str:
    return (
        "Olá. O Agente ORION está disponível. Você pode consultar materiais, modelos, "
        "regras, cálculos e informações do DPP sincronizado."
    )
