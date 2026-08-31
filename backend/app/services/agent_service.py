import json
from uuid import uuid4

from pydantic import ValidationError

from app.llm.provider import MockProvider, get_llm_provider
from app.schemas.agent import AgentAnalysis, AgentAnalysisRequest, ChatResponse
from app.services.history_service import save_analysis_history
from app.services.knowledge_service import answer_from_knowledge, load_guardrails, retrieve_context


DEMO_NOTICE = (
    "Demonstração com dados fictícios. Use /api/agent/chat para consultar o conhecimento real validado do ORION."
)


BASE_AGENT_RULES = """Você é um agente de apoio à análise do DPP.

Regras obrigatórias:
- Os fatos e cálculos recebidos do backend são a fonte numérica da análise.
- Não refaça nem substitua cálculos determinísticos do Python.
- Não invente valores, materiais, datas, regras ou evidências ausentes.
- Diferencie fato, interpretação e recomendação.
- Quando os dados forem insuficientes, declare explicitamente a insuficiência.
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
                "Provider configurado e pronto para chamadas reais."
                if provider.configured and provider.name != "mock"
                else "LLM externa desativada. O chat continua disponível com RAG lexical local e conhecimento validado."
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
            "risks": [
                {
                    "id": "risk-demo-001",
                    "material": "MAT-DEMO-001",
                    "severity": "high",
                    "title": "Déficit projetado no cenário fictício",
                    "explanation": (
                        "A disponibilidade calculada no exemplo é inferior à necessidade. "
                        "Este caso existe somente para validar a apresentação das evidências."
                    ),
                    "evidence": [
                        {"label": "Necessidade", "value": "1.000", "source": "PGD_DEMO.xlsx"},
                        {"label": "Disponibilidade", "value": "780", "source": "ESTOQUE_DEMO.xlsx"},
                        {"label": "Gap", "value": "-220", "source": "Cálculo Python demonstrativo"},
                    ],
                },
                {
                    "id": "risk-demo-002",
                    "material": "MAT-DEMO-002",
                    "severity": "medium",
                    "title": "Atendimento próximo do limite no cenário fictício",
                    "explanation": (
                        "O exemplo foi criado para validar uma situação de atenção sem definir "
                        "qualquer critério real do processo."
                    ),
                    "evidence": [
                        {"label": "Necessidade", "value": "500", "source": "PGD_DEMO.xlsx"},
                        {"label": "Disponibilidade", "value": "520", "source": "ESTOQUE_DEMO.xlsx"},
                        {"label": "Saldo", "value": "+20", "source": "Cálculo Python demonstrativo"},
                    ],
                },
            ],
            "recommendations": [
                {
                    "id": "rec-demo-001",
                    "title": "Revisar o item MAT-DEMO-001 com o analista",
                    "reason": "A recomendação é fictícia e serve para validar o fluxo de aprovação humana.",
                    "requires_human_validation": True,
                },
                {
                    "id": "rec-demo-002",
                    "title": "Verificar fontes complementares do item MAT-DEMO-002",
                    "reason": (
                        "A recomendação demonstra como o agente poderá sugerir uma próxima ação "
                        "sem executar qualquer decisão automaticamente."
                    ),
                    "requires_human_validation": True,
                },
            ],
            "knowledge_sources": ["guardrails.md"],
        }
    )


def answer_demo_question(question: str) -> ChatResponse:
    normalized = question.lower()

    if "mat-demo-001" in normalized or "crítico" in normalized or "critico" in normalized:
        answer = (
            "No cenário fictício, MAT-DEMO-001 aparece como crítico porque o exemplo informa "
            "necessidade de 1.000 unidades, disponibilidade de 780 e gap calculado de -220. "
            "Esses valores são apenas dados de demonstração e não representam uma regra real do DPP."
        )
    elif "ação" in normalized or "acao" in normalized or "recomend" in normalized:
        answer = (
            "As ações exibidas nesta etapa são mocks. O fluxo definitivo é: Python calcula os fatos, "
            "o RAG fornece conhecimento, a LLM sugere ações e o analista aprova, rejeita ou corrige."
        )
    else:
        answer = (
            "Este endpoint é somente de demonstração. Para consultar regras reais do ORION, use o chat principal."
        )

    chunks = retrieve_context(question)
    return ChatResponse(
        provider="mock",
        model="mock-local",
        is_demo=True,
        answer=answer,
        knowledge_sources=_unique_sources(chunks),
    )


def answer_agent_question(question: str) -> ChatResponse:
    provider = get_llm_provider()
    chunks = retrieve_context(question)

    if isinstance(provider, MockProvider):
        local_answer = answer_from_knowledge(question)
        return ChatResponse(
            provider="local-rag",
            model="lexical-local",
            is_demo=False,
            answer=local_answer.answer,
            knowledge_sources=local_answer.sources,
        )

    system_prompt = _build_system_prompt(chunks)
    user_prompt = (
        "Responda à pergunta do analista usando apenas o conhecimento fornecido. "
        "Se a base não possuir informação suficiente, informe isso.\n\n"
        f"Pergunta: {question}"
    )
    answer = provider.complete(system_prompt, user_prompt)

    return ChatResponse(
        provider=provider.name,
        model=provider.model,
        is_demo=False,
        answer=answer.strip(),
        knowledge_sources=_unique_sources(chunks),
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
        f"FONTE: {chunk.source}\n{chunk.content}"
        for chunk in chunks
    ]
    retrieved = "\n\n---\n\n".join(context_parts) or "Nenhum contexto adicional foi recuperado."

    return (
        f"{BASE_AGENT_RULES}\n\n"
        f"GUARDRAILS VERSIONADOS:\n{guardrails or 'Nenhum guardrail encontrado.'}\n\n"
        f"CONHECIMENTO RECUPERADO PELO RAG:\n{retrieved}"
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
