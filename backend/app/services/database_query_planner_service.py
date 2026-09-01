from __future__ import annotations

from dataclasses import dataclass, field
import re
import unicodedata

from app.core.config import KNOWLEDGE_DIR


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


@dataclass(slots=True)
class QueryPlan:
    original_question: str
    resolved_question: str
    retrieval_question: str
    intent: str
    entities: list[str] = field(default_factory=list)
    concept_entities: list[str] = field(default_factory=list)
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


def _contains_phrase(text: str, phrase: str) -> bool:
    normalized_text = _normalize(text)
    normalized_phrase = _normalize(phrase)
    return bool(normalized_phrase) and f" {normalized_phrase} " in f" {normalized_text} "


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


def _context_reference(question: str, context: dict) -> tuple[str, str] | None:
    subject_key = str(context.get("subject_key") or "").strip()
    if not subject_key:
        return None
    words = _words(question)
    normalized = _normalize(question)
    elliptical = len(words) <= 5 and any(marker in normalized for marker in ("por que", "porque", "e esse", "e ele", "e ela"))
    if words & DEICTIC_WORDS or elliptical:
        return str(context.get("subject_type") or "assunto"), subject_key
    return None


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
        or normalized.startswith("o que e ")
        or normalized.startswith("o que sao ")
        or normalized.startswith("o que sabemos sobre ")
        or normalized.startswith("fale sobre ")
    ):
        return "definition"
    if normalized.startswith("explique "):
        return "explanation"
    return "fact"


def _is_smalltalk(question: str) -> bool:
    normalized = _normalize(question)
    if not normalized:
        return False
    words = normalized.split()
    return len(words) <= 5 and any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in SMALLTALK_PREFIXES)


def _rule_requirements(question: str, context: dict, concepts: list[str], intent: str) -> tuple[list[str], list[str]]:
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

    O plano usa somente a pergunta, o glossário versionado e o contexto persistido.
    A LLM só pode ser usada depois que SQL/Python/RAG produzirem evidências.
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
    context_ref = _context_reference(stripped, context)
    resolved = stripped
    entities = list(concepts)
    if context_ref:
        subject_type, subject_key = context_ref
        if _normalize(subject_key) not in _normalize(resolved):
            resolved = f"{stripped} Contexto anterior: {subject_type} {subject_key}."
        if subject_key not in entities:
            entities.insert(0, subject_key)

    intent = _intent(stripped)
    retrieval_question = resolved

    # Perguntas longas de definição devem recuperar pelo conceito conhecido, não pela
    # palavra lexicalmente mais forte da frase. Isso preserva WIU/OPC/etc. como assunto.
    definition_markers = _normalize(stripped)
    if len(concepts) == 1 and (
        intent == "definition"
        or (intent == "explanation" and ("significado" in definition_markers or "significa" in definition_markers))
    ):
        retrieval_question = f"O que significa {concepts[0]}?"

    allow_python = intent == "code"
    required_queries, required_terms = _rule_requirements(stripped, context, concepts, intent)

    needs_synthesis = intent in {"explanation", "comparison", "code"}
    if intent == "definition" and _normalize(stripped).startswith(("explique ", "fale sobre ")):
        needs_synthesis = True
    if _normalize(stripped).startswith("explique "):
        needs_synthesis = True

    return QueryPlan(
        original_question=stripped,
        resolved_question=resolved,
        retrieval_question=retrieval_question,
        intent=intent,
        entities=entities,
        concept_entities=concepts,
        required_queries=required_queries,
        required_terms=required_terms,
        needs_synthesis=needs_synthesis,
        allow_python=allow_python,
    )


def smalltalk_answer() -> str:
    return (
        "Olá. O Agente ORION está disponível. Você pode consultar materiais, modelos, "
        "regras, cálculos e informações do DPP sincronizado."
    )
