from __future__ import annotations

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.database_query_planner_service import QueryPlan, plan_database_question
from app.services.knowledge_service import KnowledgeChunk
from app.services.llm_grounding_service import enhance_grounded_answer, prepare_grounded_evidence


class FakeLocalProvider:
    name = "llama.cpp"
    model = "orion-qwen"
    configured = True

    def __init__(self, response: str = "", fail: bool = False) -> None:
        self.response = response
        self.fail = fail
        self.calls = 0

    def is_available(self) -> bool:
        return True

    def complete(self, system_prompt, user_prompt, *, max_tokens=None, temperature=None) -> str:
        del system_prompt, user_prompt, max_tokens, temperature
        self.calls += 1
        if self.fail:
            raise RuntimeError("llama-server offline")
        return self.response


def test_planner_resolves_material_followup_without_llm(monkeypatch) -> None:
    def forbidden_provider():
        raise AssertionError("planejamento não pode consultar a LLM")

    monkeypatch.setattr("app.services.llm_grounding_service._provider", forbidden_provider)
    plan = plan_database_question(
        "Por que esse material não está crítico mesmo estando com saldo negativo?",
        {"subject_type": "material", "subject_key": "010203-0010-01", "topic": "balance"},
    )

    assert "010203-0010-01" in plan.resolved_question
    assert "010203-0010-01" in plan.entities
    assert plan.intent == "explanation"
    assert plan.needs_synthesis is True
    assert any("REGRA-004" in query for query in plan.required_queries)
    assert "REGRA-004" in plan.required_terms


def test_long_wiu_question_keeps_wiu_as_subject() -> None:
    plan = plan_database_question(
        "Explique claramente o significado operacional de WIU no processo do DPP",
        {},
    )

    assert "WIU" in plan.concept_entities
    assert plan.retrieval_question == "O que significa WIU?"
    assert "operacional" not in plan.entities
    assert plan.needs_synthesis is True


def test_opc_and_stk_ttl_require_both_concepts() -> None:
    plan = plan_database_question(
        "Explique como OPC interfere no cálculo de STK TTL segundo as regras do ORION",
        {},
    )

    assert "OPC" in plan.concept_entities
    assert "STK TTL" in plan.concept_entities
    assert "OPC" in plan.required_terms
    assert "STK TTL" in plan.required_terms
    assert any("REGRA-005" in query for query in plan.required_queries)
    assert any("REGRA-002" in query for query in plan.required_queries)


def test_non_code_grounding_excludes_python_sources() -> None:
    plan = QueryPlan(
        original_question="Explique OPC",
        resolved_question="Explique OPC",
        retrieval_question="Explique OPC",
        intent="explanation",
        entities=["OPC"],
        concept_entities=["OPC"],
        required_queries=[],
        required_terms=["OPC"],
        needs_synthesis=True,
        allow_python=False,
    )
    knowledge = DatabaseKnowledgeAnswer(
        answer="OPC representa material opcional associado ao item.",
        sources=["regras-globais.md", "python://x.py#CONST"],
        chunks=[
            KnowledgeChunk(
                source="regras-globais.md",
                heading="REGRA-005 — Material opcional (OPC)",
                category="deterministic",
                score=10.0,
                content="OPC representa material opcional associado ao item.",
            ),
            KnowledgeChunk(
                source="python://x.py#CONST",
                heading="CONST",
                category="deterministic",
                score=50.0,
                content="OPC = alguma constante interna",
            ),
        ],
    )

    missing = prepare_grounded_evidence(plan, knowledge)

    assert missing == []
    assert all(not source.startswith("python://") for source in knowledge.sources)
    assert all(not chunk.source.startswith("python://") for chunk in knowledge.chunks)


def test_unsupported_acronym_expansion_is_rejected(monkeypatch) -> None:
    provider = FakeLocalProvider(
        "O OPC (Valor de Oportunidade de Corte) não participa do STK TTL."
    )
    monkeypatch.setattr("app.services.llm_grounding_service._provider", lambda: provider)

    plan = QueryPlan(
        original_question="Explique OPC",
        resolved_question="Explique OPC",
        retrieval_question="Explique OPC",
        intent="explanation",
        entities=["OPC"],
        concept_entities=["OPC"],
        required_queries=[],
        required_terms=["OPC"],
        needs_synthesis=True,
    )
    factual = "OPC representa material opcional associado ao item."
    knowledge = DatabaseKnowledgeAnswer(
        answer=factual,
        sources=["regras-globais.md"],
        chunks=[
            KnowledgeChunk(
                source="regras-globais.md",
                heading="REGRA-005 — Material opcional (OPC)",
                category="deterministic",
                score=10.0,
                content=(
                    "OPC representa material opcional associado ao item. "
                    "O estoque opcional consolidado entra em STK OP e participa do STK TTL."
                ),
            )
        ],
    )

    result = enhance_grounded_answer("Explique OPC", plan, {}, knowledge)

    assert provider.calls == 1
    assert result.used is False
    assert result.fallback is True
    assert result.answer == factual
    assert "Valor de Oportunidade de Corte" not in result.answer


def test_local_llm_failure_keeps_grounded_fallback(monkeypatch) -> None:
    provider = FakeLocalProvider(fail=True)
    monkeypatch.setattr("app.services.llm_grounding_service._provider", lambda: provider)

    factual = "O material MAT-X não está crítico segundo o Python."
    plan = QueryPlan(
        original_question="Por que MAT-X não está crítico?",
        resolved_question="Por que MAT-X não está crítico?",
        retrieval_question="Por que MAT-X não está crítico?",
        intent="explanation",
        entities=["MAT-X"],
        needs_synthesis=True,
    )
    knowledge = DatabaseKnowledgeAnswer(
        answer=factual,
        sources=["sqlite://rag_runtime_entities/material/scenario"],
        context={"subject_type": "material", "subject_key": "MAT-X", "topic": "critical"},
    )

    result = enhance_grounded_answer("Por que MAT-X não está crítico?", plan, {}, knowledge)

    assert result.answer == factual
    assert result.used is False
    assert result.fallback is True
