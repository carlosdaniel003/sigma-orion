import json
from uuid import uuid4

from pydantic import ValidationError

from app.llm.provider import MockProvider, get_llm_provider
from app.schemas.agent import AgentAnalysis, AgentAnalysisRequest, ChatResponse
from app.services.history_service import save_analysis_history
from app.services.knowledge_service import answer_from_knowledge, load_guardrails, retrieve_context
from app.services.rag_runtime_service import record_chat_audit, sync_runtime_workspace


DEMO_NOTICE = (
    "Demonstração com dados fictícios. Use /api/agent/chat para consultar o banco RAG real do ORION."
)


BASE_AGENT_RULES = """Você é um agente de apoio à análise do DPP.

Regras obrigatórias:
- Responda somente com fatos presentes no contexto recuperado do banco RAG do ORION.
- Os fatos e cálculos recuperados do backend são a fonte numérica da análise.
- Não refaça nem substitua cálculos determinísticos do Python.
- Não invente valores, materiais, datas, regras ou evidências ausentes.
- Diferencie fato, interpretação e recomendação.
- Quando o banco não possuir informação suficiente, declare explicitamente a insuficiência.
- Toda ação sugerida depende de validação humana.
- Nunca afirme que uma ação foi executada ou aprovada sem evidência explícita.
"""


def provider_status() -> dict:
    provider = get_llm_provider()
    status = provider.status()
    status.update(
        {
            "mode": "live" if provider.configured and provider.name != "mock" else "offline-rag",
            "message": (
                "Provider configurado. Toda resposta continua limitada ao contexto recuperado do SQLite/RAG."
                if provider.configured and provider.name != "mock"
                else "LLM externa desativada. O chat responde diretamente do SQLite/FTS5/BM25 sincronizado."
            ),
        }
    )
    return status


def build_demo_analysis() -> AgentAnalysis:
    return AgentAnalysis.model_validate(
        {
            "analysis_id": "demo-2026-08-21-001",
            "provider": "mock",
            "model": "mock-local",
            "is_demo": True,
            "demo_notice": DEMO_NOTICE,
            "summary": (
                "O cenário fictício contém quatro itens críticos e nove itens em atenção. "
                "O objetivo desta tela é validar a estrutura da interface, evidências, "
                "recomendações e feedback humano."
            ),
            "metrics": {
                "total_materials": 120,
                "critical": 4,
                "attention": 9,
                "ok": 107,
            },
            "risks": [],
            "recommendations": [],
            "knowledge_sources": ["guardrails.md"],
        }
    )


def answer_demo_question(question: str) -> ChatResponse:
    return ChatResponse(
        provider="mock",
        model="mock-local",
        is_demo=True,
        answer=(
            "Este endpoint existe apenas para compatibilidade da demonstração. "
            "O chat operacional é /api/agent/chat e consulta exclusivamente o banco RAG sincronizado."
        ),
        knowledge_sources=[],
    )


def _retrieval_payload(chunks: list) -> list[dict]:
    return [
        {
            "source": chunk.source,
            "heading": getattr(chunk, "heading", "") or "",
            "category": getattr(chunk, "category", "") or "",
            "score": float(getattr(chunk, "score", 0.0) or 0.0),
        }
        for chunk in chunks
    ]


def answer_agent_question(question: str, workspace: dict | None = None) -> ChatResponse:
    runtime = sync_runtime_workspace(workspace)
    provider = get_llm_provider()

    if isinstance(provider, MockProvider):
        local_answer = answer_from_knowledge(question)
        sources = local_answer.sources
        audit_id = record_chat_audit(
            question=question,
            answer=local_answer.answer,
            provider="local-rag-db",
            sources=sources,
            workspace_fingerprint=runtime["workspace_fingerprint"],
        )
        return ChatResponse(
            provider="local-rag",
            model="sqlite-fts5-bm25",
            is_demo=False,
            answer=local_answer.answer,
            knowledge_sources=sources,
            retrieval=_retrieval_payload(local_answer.chunks),
            database=runtime.get("database", "orion.db"),
            workspace_fingerprint=runtime["workspace_fingerprint"],
            audit_id=audit_id,
        )

    chunks = retrieve_context(question, top_k=12)
    if not chunks:
        local_answer = answer_from_knowledge(question)
        audit_id = record_chat_audit(
            question=question,
            answer=local_answer.answer,
            provider="rag-abstention",
            sources=[],
            workspace_fingerprint=runtime["workspace_fingerprint"],
        )
        return ChatResponse(
            provider=provider.name,
            model=provider.model,
            is_demo=False,
            answer=local_answer.answer,
            knowledge_sources=[],
            retrieval=[],
            database=runtime.get("database", "orion.db"),
            workspace_fingerprint=runtime["workspace_fingerprint"],
            audit_id=audit_id,
        )

    system_prompt = _build_system_prompt(chunks)
    user_prompt = (
        "Responda somente com o conhecimento recuperado do banco abaixo. "
        "Não utilize conhecimento externo ou memória do modelo. "
        "Se os trechos não sustentarem a resposta, declare que o banco não contém evidência suficiente.\n\n"
        f"Pergunta: {question}"
    )
    answer = provider.complete(system_prompt, user_prompt).strip()
    sources = _unique_sources(chunks)
    audit_id = record_chat_audit(
        question=question,
        answer=answer,
        provider=provider.name,
        sources=sources,
        workspace_fingerprint=runtime["workspace_fingerprint"],
    )
    return ChatResponse(
        provider=provider.name,
        model=provider.model,
        is_demo=False,
        answer=answer,
        knowledge_sources=sources,
        retrieval=_retrieval_payload(chunks),
        database=runtime.get("database", "orion.db"),
        workspace_fingerprint=runtime["workspace_fingerprint"],
        audit_id=audit_id,
    )


def analyze_structured(payload: AgentAnalysisRequest) -> AgentAnalysis:
    provider = get_llm_provider()
    query = f"{payload.objective}\n{json.dumps(payload.facts, ensure_ascii=False, default=str)}"
    chunks = retrieve_context(query)
    sources = _unique_sources(chunks)
    analysis_id = f"analysis-{uuid4().hex[:12]}"

    if isinstance(provider, MockProvider):
        analysis = AgentAnalysis(
            analysis_id=analysis_id,
            provider=provider.name,
            model=provider.model,
            is_demo=True,
            demo_notice=(
                "Execução registrada com provider mock. Os fatos chegaram ao pipeline, mas não foram "
                "interpretados por uma LLM externa."
            ),
            summary=(
                "Pipeline estruturado executado em modo mock. Configure a Groq para testar a etapa "
                "de interpretação mantendo os cálculos no Python."
            ),
            metrics=payload.metrics,
            risks=[],
            recommendations=[],
            knowledge_sources=sources,
        )
        save_analysis_history(analysis)
        return analysis

    system_prompt = _build_system_prompt(chunks) + """

Para esta tarefa, devolva SOMENTE um objeto JSON válido, sem Markdown, com este formato:
{
  "summary": "texto",
  "risks": [
    {
      "id": "risk-001",
      "material": "código ou N/A",
      "severity": "high|medium|low",
      "title": "texto",
      "explanation": "texto",
      "evidence": [
        {"label": "campo", "value": "valor", "source": "fonte recebida"}
      ]
    }
  ],
  "recommendations": [
    {
      "id": "rec-001",
      "title": "texto",
      "reason": "texto",
      "requires_human_validation": true
    }
  ]
}
Não crie métricas: elas já foram calculadas pelo Python e serão anexadas pelo backend.
"""

    user_prompt = (
        f"Objetivo:\n{payload.objective}\n\n"
        f"Métricas calculadas pelo Python (somente contexto):\n{payload.metrics.model_dump_json()}\n\n"
        f"Fatos estruturados calculados/validados pelo backend:\n"
        f"{json.dumps(payload.facts, ensure_ascii=False, indent=2, default=str)}"
    )

    raw = provider.complete(system_prompt, user_prompt)
    parsed = _parse_json_object(raw)

    try:
        analysis = AgentAnalysis.model_validate(
            {
                "analysis_id": analysis_id,
                "provider": provider.name,
                "model": provider.model,
                "is_demo": False,
                "demo_notice": "",
                "summary": parsed.get("summary", ""),
                "metrics": payload.metrics.model_dump(),
                "risks": parsed.get("risks", []),
                "recommendations": parsed.get("recommendations", []),
                "knowledge_sources": sources,
            }
        )
    except ValidationError as exc:
        raise RuntimeError("A LLM retornou JSON, mas fora do contrato estruturado esperado.") from exc

    save_analysis_history(analysis)
    return analysis


def _build_system_prompt(chunks: list) -> str:
    guardrails = load_guardrails()
    context_parts = [
        f"FONTE NO BANCO: {chunk.source}\n{chunk.content}"
        for chunk in chunks
    ]
    retrieved = "\n\n---\n\n".join(context_parts) or "Nenhum contexto foi recuperado do banco."

    return (
        f"{BASE_AGENT_RULES}\n\n"
        f"GUARDRAILS RECUPERADOS DO BANCO:\n{guardrails or 'Nenhum guardrail indexado.'}\n\n"
        f"CONHECIMENTO RECUPERADO DO SQLITE/RAG:\n{retrieved}"
    )


def _parse_json_object(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("A LLM não retornou um JSON válido para a análise estruturada.") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("A resposta estruturada da LLM precisa ser um objeto JSON.")
    return parsed


def _unique_sources(chunks: list) -> list[str]:
    return list(dict.fromkeys(chunk.source for chunk in chunks))
