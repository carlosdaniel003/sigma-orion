from __future__ import annotations

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.knowledge_service import KnowledgeChunk
from app.services.llm_grounding_service import LlmPlan, enhance_grounded_answer, plan_database_question


class FakeLocalProvider:
    name = "llama.cpp"
    model = "orion-qwen"
    configured = True

    def __init__(self, responses: list[str] | None = None, fail: bool = False) -> None:
        self.responses = list(responses or [])
        self.fail = fail

    def is_available(self) -> bool:
        return True

    def complete(self, system_prompt, user_prompt, *, max_tokens=None, temperature=None) -> str:
        del system_prompt, user_prompt, max_tokens, temperature
        if self.fail:
            raise RuntimeError("llama-server offline")
        return self.responses.pop(0)


def test_local_llm_resolves_follow_up_without_answering(monkeypatch) -> None:
    provider = FakeLocalProvider(
        [
            '{"resolved_question":"O que o código Python faz em WIU?",'
            '"knowledge_query":"WIU implementação Python","needs_synthesis":true}'
        ]
    )
    monkeypatch.setattr("app.services.llm_grounding_service._provider", lambda: provider)

    plan = plan_database_question(
        "O que o código Python faz nesta regra?",
        {"subject_type": "concept", "subject_key": "WIU", "topic": "definition"},
    )

    assert plan.used is True
    assert plan.fallback is False
    assert "WIU" in plan.resolved_question
    assert plan.knowledge_query == "WIU implementação Python"
    assert plan.needs_synthesis is True


def test_local_llm_synthesizes_only_grounded_answer(monkeypatch) -> None:
    provider = FakeLocalProvider(["WIU é a lista de modelos associada ao material no DPP."])
    monkeypatch.setattr("app.services.llm_grounding_service._provider", lambda: provider)

    knowledge = DatabaseKnowledgeAnswer(
        answer="WIU: Lista de modelos associada ao material trazida para o DPP.",
        sources=["glossario.md"],
        chunks=[
            KnowledgeChunk(
                source="glossario.md",
                heading="Glossário",
                category="operational",
                score=10.0,
                content="WIU: Lista de modelos associada ao material trazida para o DPP.",
            )
        ],
        context={"subject_type": "concept", "subject_key": "WIU", "topic": "definition"},
    )
    plan = LlmPlan(
        resolved_question="Explique WIU",
        needs_synthesis=True,
        provider=provider,
    )

    result = enhance_grounded_answer("Explique WIU", plan, {}, knowledge)

    assert result.used is True
    assert result.fallback is False
    assert result.provider == "llama.cpp"
    assert result.model == "orion-qwen"
    assert result.answer.startswith("WIU é")


def test_local_llm_failure_keeps_deterministic_answer(monkeypatch) -> None:
    provider = FakeLocalProvider(fail=True)
    monkeypatch.setattr("app.services.llm_grounding_service._provider", lambda: provider)

    factual = "O material MAT-X não está crítico segundo o Python."
    knowledge = DatabaseKnowledgeAnswer(
        answer=factual,
        sources=["sqlite://rag_runtime_entities/material/scenario"],
        context={"subject_type": "material", "subject_key": "MAT-X", "topic": "critical"},
    )
    plan = LlmPlan(
        resolved_question="Por que MAT-X não está crítico?",
        needs_synthesis=True,
        provider=provider,
    )

    result = enhance_grounded_answer("Por que MAT-X não está crítico?", plan, {}, knowledge)

    assert result.answer == factual
    assert result.used is False
    assert result.fallback is True
