from __future__ import annotations

from dataclasses import dataclass
import json
import re
import unicodedata

from app.llm.provider import LLMProvider, MockProvider, get_llm_provider
from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.database_query_planner_service import QueryPlan
from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeChunk


@dataclass(slots=True)
class LlmEnhancement:
    answer: str
    used: bool
    fallback: bool
    provider: str = ""
    model: str = ""


def _normalize(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_.-]+", " ", normalized).strip()


def _provider() -> LLMProvider | None:
    try:
        provider = get_llm_provider()
    except RuntimeError:
        return None
    if isinstance(provider, MockProvider):
        return None
    return provider


def _provider_ready(provider: LLMProvider | None) -> bool:
    if provider is None or not provider.configured:
        return False
    try:
        return provider.is_available()
    except Exception:
        return False


def _as_chunk(item) -> KnowledgeChunk:
    return KnowledgeChunk(
        source=item.source,
        content=item.content,
        score=item.score,
        heading=item.heading,
        category=item.category,
    )


def _source_authority(source: str, allow_python: bool) -> float:
    source_lower = source.lower()
    if source_lower.endswith("readme.md"):
        return 0.05
    if re.search(r"(?:demo|mock|test|fixture)", source_lower):
        return 0.01
    if source.startswith("python://"):
        return 1.20 if allow_python else 0.0
    if source == "regras-globais.md":
        return 1.60
    if source == "motor-deterministico.md":
        return 1.55
    if source == "glossario.md":
        return 1.50
    if source.startswith("workspace://") or source.startswith("sqlite://"):
        return 1.45
    return 1.0


def _term_present(term: str, text: str) -> bool:
    normalized_term = _normalize(term)
    normalized_text = _normalize(text)
    if not normalized_term:
        return True
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])", normalized_text))


def _query_terms(query: str) -> list[str]:
    words = [word for word in _normalize(query).split() if len(word) > 2]
    stop = {
        "regra", "material", "calculo", "estoque", "total", "opcional", "consumo",
        "efetivo", "explosao",
    }
    return [word for word in words if word not in stop]


def _supplemental_chunks(plan: QueryPlan, existing: list[KnowledgeChunk]) -> list[KnowledgeChunk]:
    seen = {(chunk.source, chunk.heading) for chunk in existing}
    selected: list[KnowledgeChunk] = []

    for query in plan.required_queries:
        candidates = bm25_retrieve(query, limit=40)
        ranked = []
        query_terms = _query_terms(query)
        for item in candidates:
            authority = _source_authority(item.source, plan.allow_python)
            if authority <= 0:
                continue
            searchable = f"{item.heading}\n{item.content}"
            overlap = sum(1 for term in query_terms if _term_present(term, searchable))
            if query_terms and overlap == 0:
                continue
            score = float(item.score) * authority + overlap * 15.0
            if item.source in {"regras-globais.md", "motor-deterministico.md", "glossario.md"}:
                score += 20.0
            ranked.append((score, item))
        ranked.sort(key=lambda row: row[0], reverse=True)

        taken = 0
        for _, item in ranked:
            key = (item.source, item.heading)
            if key in seen:
                continue
            seen.add(key)
            selected.append(_as_chunk(item))
            taken += 1
            if taken >= 2 or len(selected) >= 6:
                break
        if len(selected) >= 6:
            break

    return selected


def _sanitize_python_sources(plan: QueryPlan, knowledge: DatabaseKnowledgeAnswer) -> None:
    if plan.allow_python:
        return
    knowledge.chunks = [chunk for chunk in knowledge.chunks if not chunk.source.startswith("python://")]
    knowledge.sources = [source for source in knowledge.sources if not source.startswith("python://")]


def prepare_grounded_evidence(plan: QueryPlan, knowledge: DatabaseKnowledgeAnswer) -> list[str]:
    """Completa e valida o contexto antes de qualquer chamada LLM."""

    _sanitize_python_sources(plan, knowledge)
    if not plan.needs_synthesis:
        return []

    # Ferramentas estruturadas já fizeram resolução e validação diretamente nos
    # campos do SQLite. Não rebaixamos essa evidência para um teste lexical de aliases
    # e não adicionamos BM25 por cima de um resultado estruturado fechado.
    if knowledge.context.get("structured_evidence_complete"):
        return []

    supplemental = _supplemental_chunks(plan, knowledge.chunks)
    for chunk in supplemental:
        if not any(existing.source == chunk.source and existing.heading == chunk.heading for existing in knowledge.chunks):
            knowledge.chunks.append(chunk)
        if chunk.source not in knowledge.sources:
            knowledge.sources.append(chunk.source)

    corpus = "\n".join(
        [
            knowledge.answer,
            json.dumps(knowledge.table or {}, ensure_ascii=False, default=str),
            *[f"{chunk.heading}\n{chunk.content}" for chunk in knowledge.chunks],
        ]
    )
    return [term for term in plan.required_terms if not _term_present(term, corpus)]


def _table_context(table: dict | None) -> str:
    if not table:
        return "Nenhuma tabela estruturada."
    rows = list(table.get("rows") or [])
    preview = rows[:10]
    return (
        f"Tabela: {table.get('title') or 'Dados'}; total de linhas: {table.get('total_rows') or len(rows)}.\n"
        f"Amostra estruturada (máximo 10 linhas):\n{json.dumps(preview, ensure_ascii=False, default=str)}"
    )


def _strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", str(text or ""), flags=re.DOTALL | re.IGNORECASE).strip()


def _canonical_number(token: str) -> str:
    return re.sub(r"[^0-9-]", "", token)


def _unsupported_numbers(answer: str, evidence: str) -> list[str]:
    answer_tokens = re.findall(r"(?<![A-Za-z])[-+]?\d[\d.,]*", answer)
    evidence_tokens = re.findall(r"(?<![A-Za-z])[-+]?\d[\d.,]*", evidence)
    supported = {_canonical_number(token) for token in evidence_tokens}
    unsupported: list[str] = []
    for token in answer_tokens:
        canonical = _canonical_number(token)
        if len(canonical.lstrip("-")) <= 1 and not any(char in token for char in ".,"):
            continue
        if canonical and canonical not in supported:
            unsupported.append(token)
    return unsupported


def _unsupported_acronym_expansions(answer: str, evidence: str, entities: list[str]) -> list[str]:
    unsupported: list[str] = []
    evidence_normalized = _normalize(evidence)
    for entity in entities:
        acronym = str(entity or "").strip()
        if not re.fullmatch(r"[A-ZÁÉÍÓÚÇ0-9]{2,8}", acronym):
            continue
        patterns = (
            rf"\b{re.escape(acronym)}\s*\(([^)]+)\)",
            rf"\b{re.escape(acronym)}\s*=\s*([^.;\n]+)",
            rf"\b{re.escape(acronym)}\s+(?:significa|quer dizer)\s+([^.;\n]+)",
        )
        for pattern in patterns:
            for match in re.finditer(pattern, answer, flags=re.IGNORECASE):
                expansion = match.group(1).strip()
                if _normalize(expansion) and _normalize(expansion) not in evidence_normalized:
                    unsupported.append(f"{acronym}: {expansion}")
    return unsupported


def _acknowledges_unproven_cause(answer: str) -> bool:
    normalized = _normalize(answer)
    return (
        ("causa" in normalized and ("nao" in normalized or "investig" in normalized or "evidencia" in normalized))
        or "ainda precisa ser investig" in normalized
        or "nao foi demonstr" in normalized
        or "nao esta demonstr" in normalized
    )


def _grounded_fallback(knowledge: DatabaseKnowledgeAnswer) -> str:
    base = str(knowledge.answer or "").strip()
    if base:
        return base
    return (
        "Não encontrei evidência suficiente no contexto fundamentado do ORION para responder. "
        "A LLM não foi autorizada a completar a lacuna com conhecimento próprio."
    )


def enhance_grounded_answer(
    question: str,
    plan: QueryPlan,
    context: dict,
    knowledge: DatabaseKnowledgeAnswer,
) -> LlmEnhancement:
    del context

    if knowledge.context.get("skip_llm"):
        return LlmEnhancement(answer=knowledge.answer, used=False, fallback=False)

    missing = prepare_grounded_evidence(plan, knowledge)
    if missing:
        return LlmEnhancement(
            answer=(
                "Não encontrei evidência suficiente no SQLite/RAG do ORION para explicar essa pergunta com segurança. "
                f"Evidência obrigatória ausente: {', '.join(missing)}. A LLM não foi consultada."
            ),
            used=False,
            fallback=True,
        )

    if not plan.needs_synthesis:
        return LlmEnhancement(answer=knowledge.answer, used=False, fallback=False)

    provider = _provider()
    if not _provider_ready(provider):
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=provider is not None,
            provider=provider.name if provider else "",
            model=provider.model if provider else "",
        )

    compact = bool(knowledge.context.get("compact_llm"))
    chunk_limit = 2 if compact else 5
    chunk_chars = 520 if compact else 900
    output_tokens = 180 if compact else 320

    evidence_parts: list[str] = []
    for chunk in knowledge.chunks[:chunk_limit]:
        evidence_parts.append(
            f"FONTE: {chunk.source}\nSEÇÃO: {chunk.heading}\n{chunk.content[:chunk_chars]}"
        )
    evidence_text = "\n\n---\n\n".join(evidence_parts) or "Nenhum chunk textual adicional."
    factual_context = (
        f"RESPOSTA FACTUAL/EXTRATIVA DO BACKEND:\n{knowledge.answer}\n\n"
        f"{_table_context(knowledge.table)}\n\n"
        f"EVIDÊNCIAS RECUPERADAS E VALIDADAS:\n{evidence_text}"
    )

    cause_instruction = ""
    if knowledge.context.get("operational_cause_demonstrated") is False:
        cause_instruction = (
            "\n- Neste caso a causa operacional NÃO foi demonstrada. Explique somente onde a diferença matemática ocorreu "
            "e declare explicitamente que a causa operacional ainda precisa ser investigada."
        )

    system_prompt = f"""/no_think
Você é somente a camada de interpretação do SIGMA-S ORION.
SQL, Python e RAG já executaram antes de você e são a única fonte de verdade.
Regras obrigatórias:
- Responda em português, de forma direta e clara.
- Use SOMENTE fatos presentes no contexto fornecido.
- Não use conhecimento de treinamento para completar lacunas.
- Não recalcule valores e não crie números, materiais, modelos, datas, fórmulas ou causas.
- Não expanda siglas se a expansão formal não estiver escrita nas evidências.
- Preserve códigos e valores exatamente quando citá-los.
- Não altere resultado do Python para fazê-lo coincidir com o DPP Final.
- Se a causa não estiver demonstrada, diga que ainda precisa ser investigada.
- Diferencie Cenário ORION de DPP Final quando ambos existirem.
- Para tabelas grandes, resuma; a tabela estruturada continua sendo a evidência determinística.
- Retorne somente a resposta final, sem raciocínio interno e sem tags <think>.{cause_instruction}
"""
    user_prompt = (
        f"Pergunta original:\n{question}\n\n"
        f"Pergunta resolvida pelo roteador determinístico:\n{plan.resolved_question}\n\n"
        f"Entidades reconhecidas:\n{json.dumps(plan.entities, ensure_ascii=False)}\n\n"
        f"{factual_context}"
    )

    try:
        generated = provider.complete(system_prompt, user_prompt, max_tokens=output_tokens, temperature=0.1)
        generated = _strip_thinking(generated)
    except Exception:
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if not generated:
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if _unsupported_numbers(generated, factual_context):
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if _unsupported_acronym_expansions(generated, factual_context, plan.concept_entities):
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if knowledge.context.get("operational_cause_demonstrated") is False and not _acknowledges_unproven_cause(generated):
        return LlmEnhancement(
            answer=_grounded_fallback(knowledge),
            used=False,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    return LlmEnhancement(
        answer=generated[:4000],
        used=True,
        fallback=False,
        provider=provider.name,
        model=provider.model,
    )
