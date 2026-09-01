from __future__ import annotations

from dataclasses import dataclass
import json
import re
import unicodedata

from app.llm.provider import LLMProvider, MockProvider, get_llm_provider
from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_catalog_service import bm25_retrieve
from app.services.knowledge_service import KnowledgeChunk


ANALYTIC_MARKERS = (
    "por que",
    "porque",
    "explique",
    "explica",
    "analise",
    "analisar",
    "causa",
    "motivo",
    "impacto",
    "o que sabemos",
    "como funciona",
    "o que aconteceu",
    "o que mudou",
    "faz nesta regra",
    "faz nessa regra",
)
DEICTIC_WORDS = {"esse", "essa", "este", "esta", "isso", "deste", "desta", "nesse", "nessa", "neste", "nesta", "ele", "ela"}
DIRECT_FIELD_TOPICS = {
    "balance",
    "nec",
    "stock_total",
    "stock_op",
    "stock",
    "explosion",
    "amount",
    "price",
    "um",
    "group_origin",
    "optional_material",
    "check",
    "wiu",
}


@dataclass(slots=True)
class LlmPlan:
    resolved_question: str
    knowledge_query: str = ""
    needs_synthesis: bool = False
    used: bool = False
    fallback: bool = False
    provider: LLMProvider | None = None


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


def _words(text: str) -> set[str]:
    return set(_normalize(text).split())


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


def _has_analytic_marker(question: str) -> bool:
    normalized = _normalize(question)
    return any(_normalize(marker) in normalized for marker in ANALYTIC_MARKERS)


def _should_plan(question: str, context: dict) -> bool:
    subject_key = str(context.get("subject_key") or "").strip()
    if not subject_key:
        return False
    words = _words(question)
    if words & DEICTIC_WORDS:
        return True
    # Follow-ups elípticos como "por quê?" precisam do assunto anterior; uma
    # pergunta curta mas autônoma (ex.: "Quais materiais estão críticos?") não.
    return len(words) <= 5 and _has_analytic_marker(question)


def _heuristic_needs_synthesis(question: str, answer: DatabaseKnowledgeAnswer) -> bool:
    if not answer.sources and not answer.table:
        return False
    if _has_analytic_marker(question):
        return True
    normalized = _normalize(question)
    if "python" in normalized or "codigo" in normalized or "implement" in normalized:
        return True
    if answer.table and int(answer.table.get("total_rows") or 0) > 20:
        return False
    topic = str(answer.context.get("topic") or "")
    if topic in DIRECT_FIELD_TOPICS and not _has_analytic_marker(question):
        return False
    return normalized.startswith(("fale sobre ", "explique ", "como funciona ", "o que sabemos "))


def _extract_json_object(raw: str) -> dict | None:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def plan_database_question(question: str, context: dict) -> LlmPlan:
    """Usa a LLM apenas para transformar follow-ups ambíguos em perguntas autônomas.

    A LLM não recebe o banco e não responde aqui; ela somente resolve referências como
    "esse material" ou "nesta regra" usando o contexto já persistido no SQLite.
    """

    if not _should_plan(question, context):
        return LlmPlan(resolved_question=question)

    provider = _provider()
    if not _provider_ready(provider):
        return LlmPlan(resolved_question=question, fallback=provider is not None, provider=provider)

    context_payload = {
        "subject_type": context.get("subject_type"),
        "subject_key": context.get("subject_key"),
        "topic": context.get("topic"),
    }
    system_prompt = """/no_think
Você é o planejador de consulta do SIGMA-S ORION.
Sua única tarefa é reescrever a pergunta atual como uma pergunta autônoma usando SOMENTE o contexto fornecido.
Não responda à pergunta, não invente fatos e não altere códigos, nomes ou números.
Retorne SOMENTE JSON válido neste formato:
{"resolved_question":"...","knowledge_query":"...","needs_synthesis":true}
- resolved_question: pergunta completa e independente.
- knowledge_query: termos curtos para procurar regra/conceito relacionado; pode ser vazio.
- needs_synthesis: true quando a pergunta pede explicação, causa, análise ou interpretação; false para consulta factual simples.
"""
    user_prompt = (
        f"Contexto persistido no SQLite:\n{json.dumps(context_payload, ensure_ascii=False)}\n\n"
        f"Pergunta atual:\n{question}"
    )

    try:
        raw = provider.complete(system_prompt, user_prompt, max_tokens=180, temperature=0.0)
        payload = _extract_json_object(raw)
    except Exception:
        return LlmPlan(resolved_question=question, fallback=True, provider=provider)

    if not payload:
        return LlmPlan(resolved_question=question, fallback=True, provider=provider)

    resolved = str(payload.get("resolved_question") or "").strip()
    if not resolved or len(resolved) > 2000:
        resolved = question

    subject_key = str(context.get("subject_key") or "").strip()
    if subject_key and (_words(question) & DEICTIC_WORDS) and _normalize(subject_key) not in _normalize(resolved):
        resolved = f"{resolved} Contexto anterior: {context.get('subject_type') or 'assunto'} {subject_key}."

    knowledge_query = str(payload.get("knowledge_query") or "").strip()[:500]
    return LlmPlan(
        resolved_question=resolved,
        knowledge_query=knowledge_query,
        needs_synthesis=bool(payload.get("needs_synthesis")),
        used=True,
        provider=provider,
    )


def _supplemental_chunks(query: str, existing: list[KnowledgeChunk]) -> list[KnowledgeChunk]:
    if not query.strip():
        return []
    seen = {(chunk.source, chunk.heading) for chunk in existing}
    results: list[KnowledgeChunk] = []
    for item in bm25_retrieve(query, limit=20):
        source_lower = item.source.lower()
        if item.source.endswith("README.md") or re.search(r"(?:demo|mock|test|fixture)", source_lower):
            continue
        key = (item.source, item.heading)
        if key in seen:
            continue
        seen.add(key)
        results.append(
            KnowledgeChunk(
                source=item.source,
                content=item.content,
                score=item.score,
                heading=item.heading,
                category=item.category,
            )
        )
        if len(results) >= 4:
            break
    return results


def _table_context(table: dict | None) -> str:
    if not table:
        return "Nenhuma tabela estruturada."
    rows = list(table.get("rows") or [])
    preview = rows[:12]
    return (
        f"Tabela: {table.get('title') or 'Dados'}; total de linhas: {table.get('total_rows') or len(rows)}.\n"
        f"Amostra estruturada (máximo 12 linhas):\n{json.dumps(preview, ensure_ascii=False, default=str)}"
    )


def _strip_thinking(text: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", str(text or ""), flags=re.DOTALL | re.IGNORECASE).strip()
    return cleaned


def _canonical_number(token: str) -> str:
    return re.sub(r"[^0-9-]", "", token)


def _unsupported_numbers(answer: str, evidence: str) -> list[str]:
    answer_tokens = re.findall(r"(?<![A-Za-z])[-+]?\d[\d.,]*", answer)
    evidence_tokens = re.findall(r"(?<![A-Za-z])[-+]?\d[\d.,]*", evidence)
    supported = {_canonical_number(token) for token in evidence_tokens}
    unsupported: list[str] = []
    for token in answer_tokens:
        canonical = _canonical_number(token)
        # Números de um único dígito são frequentemente enumeração textual; os valores
        # materiais relevantes do DPP normalmente possuem mais dígitos ou separador.
        if len(canonical.lstrip("-")) <= 1 and not any(char in token for char in ".,"):
            continue
        if canonical and canonical not in supported:
            unsupported.append(token)
    return unsupported


def enhance_grounded_answer(
    question: str,
    plan: LlmPlan,
    context: dict,
    knowledge: DatabaseKnowledgeAnswer,
) -> LlmEnhancement:
    needs_synthesis = plan.needs_synthesis or _heuristic_needs_synthesis(question, knowledge)
    if not needs_synthesis:
        provider_name = plan.provider.name if plan.used and plan.provider else ""
        model = plan.provider.model if plan.used and plan.provider else ""
        return LlmEnhancement(
            answer=knowledge.answer,
            used=plan.used,
            fallback=plan.fallback,
            provider=provider_name,
            model=model,
        )

    provider = plan.provider or _provider()
    if not _provider_ready(provider):
        return LlmEnhancement(
            answer=knowledge.answer,
            used=plan.used,
            fallback=provider is not None or plan.fallback,
            provider=provider.name if provider else "",
            model=provider.model if provider else "",
        )

    subject_key = str(knowledge.context.get("subject_key") or context.get("subject_key") or "")
    topic = str(knowledge.context.get("topic") or context.get("topic") or "")
    retrieval_query = plan.knowledge_query or " ".join(
        part for part in (subject_key, topic, question, "regra ORION") if part
    )
    supplemental = _supplemental_chunks(retrieval_query, knowledge.chunks)
    evidence_chunks = [*knowledge.chunks, *supplemental]

    evidence_parts = []
    for chunk in evidence_chunks[:6]:
        evidence_parts.append(
            f"FONTE: {chunk.source}\nSEÇÃO: {chunk.heading}\n{chunk.content[:1600]}"
        )
    evidence_text = "\n\n---\n\n".join(evidence_parts) or "Nenhum chunk textual adicional."
    factual_context = (
        f"RESPOSTA FACTUAL DO BACKEND:\n{knowledge.answer}\n\n"
        f"{_table_context(knowledge.table)}\n\n"
        f"EVIDÊNCIAS RECUPERADAS:\n{evidence_text}"
    )

    system_prompt = """/no_think
Você é a camada de interpretação do SIGMA-S ORION.
O Python, o SQLite e o RAG fornecidos abaixo são a fonte de verdade. Sua função é SOMENTE explicar e sintetizar.
Regras obrigatórias:
- Responda em português, de forma direta e clara.
- Use somente fatos presentes na resposta factual, tabela e evidências fornecidas.
- Não recalcule valores e não crie números, materiais, modelos, datas, fórmulas ou causas.
- Preserve códigos e valores exatamente quando citá-los.
- Não altere um resultado do Python para fazê-lo coincidir com o DPP Final.
- Se a causa não estiver demonstrada pelas evidências, diga que ela ainda precisa ser investigada.
- Diferencie Cenário ORION de DPP Final quando ambos existirem.
- Para tabelas grandes, não repita todas as linhas; explique o resultado e deixe a tabela como evidência estruturada.
- Não mencione conhecimento externo, treinamento do modelo ou informações fora do contexto.
- Retorne somente a resposta final, sem bloco de raciocínio e sem tags <think>.
"""
    user_prompt = (
        f"Pergunta original:\n{question}\n\n"
        f"Pergunta resolvida:\n{plan.resolved_question}\n\n"
        f"{factual_context}"
    )

    try:
        generated = provider.complete(system_prompt, user_prompt, max_tokens=700, temperature=0.1)
        generated = _strip_thinking(generated)
    except Exception:
        return LlmEnhancement(
            answer=knowledge.answer,
            used=plan.used,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if not generated:
        return LlmEnhancement(
            answer=knowledge.answer,
            used=plan.used,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    if _unsupported_numbers(generated, factual_context):
        return LlmEnhancement(
            answer=knowledge.answer,
            used=plan.used,
            fallback=True,
            provider=provider.name,
            model=provider.model,
        )

    # Se a LLM usou chunks suplementares, eles passam a fazer parte explícita da
    # rastreabilidade da resposta e são auditados junto com as fontes originais.
    for chunk in supplemental:
        if not any(existing.source == chunk.source and existing.heading == chunk.heading for existing in knowledge.chunks):
            knowledge.chunks.append(chunk)
        if chunk.source not in knowledge.sources:
            knowledge.sources.append(chunk.source)

    return LlmEnhancement(
        answer=generated[:4000],
        used=True,
        fallback=False,
        provider=provider.name,
        model=provider.model,
    )
