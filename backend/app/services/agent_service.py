from app.schemas.agent import AgentAnalysis, ChatResponse


DEMO_NOTICE = (
    "Demonstração com dados fictícios. Nenhuma regra real do DPP foi implementada ainda."
)


def build_demo_analysis() -> AgentAnalysis:
    return AgentAnalysis.model_validate(
        {
            "analysis_id": "demo-2026-08-21-001",
            "provider": "mock",
            "is_demo": True,
            "demo_notice": DEMO_NOTICE,
            "summary": (
                "O cenário fictício contém quatro itens críticos e nove itens em atenção. "
                "O objetivo desta tela é validar a estrutura da interface, evidências, "
                "recomendações e feedback humano antes da chegada dos dados reais."
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
                    "reason": (
                        "A recomendação é fictícia e serve para validar o fluxo de aprovação humana."
                    ),
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
            "As ações exibidas nesta etapa são mocks. O fluxo definitivo será: Python calcula os fatos, "
            "o RAG fornece conhecimento, a LLM sugere ações e o analista aprova, rejeita ou corrige."
        )
    else:
        answer = (
            "O agente ainda está em modo mock. Esta resposta confirma que a interface de chat está pronta. "
            "Quando o provider real for conectado, a mesma interface enviará a pergunta para a LLM com "
            "dados estruturados, regras e contexto recuperado pelo RAG."
        )

    return ChatResponse(provider="mock", is_demo=True, answer=answer)
