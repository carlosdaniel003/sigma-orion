from fastapi.testclient import TestClient

from app.main import app
from app.services import database_structured_query_service as structured
from app.services.database_query_planner_service import plan_database_question


def ask(question: str, session_id: str = "structured-query-regression") -> dict:
    with TestClient(app) as client:
        response = client.post(
            "/api/knowledge/chat",
            json={"question": question, "session_id": session_id},
        )
    assert response.status_code == 200
    return response.json()


def test_rule_004_is_resolved_by_exact_registry_without_python() -> None:
    payload = ask('E o que diz a "REGRA-004"?', "rule-004-direct")

    assert payload["model"] == "deterministic-rule-registry"
    assert payload["entities"] == ["REGRA-004"]
    assert "REGRA-004 — Material crítico" in payload["answer"]
    assert "UM == UN" in payload["answer"]
    assert "SALDO < -0,0001" in payload["answer"]
    assert "DEFINITION_FOCUS_MARKERS" not in payload["answer"]
    assert all(not source.startswith("python://") for source in payload["knowledge_sources"])
    assert payload["knowledge_sources"] == ["regras-globais.md"]


def test_rule_followup_can_use_last_rule_entity() -> None:
    session_id = "rule-followup"
    first = ask('O que diz a "REGRA-004"?', session_id)
    assert "REGRA-004" in first["entities"]

    second = ask("E essa regra?", session_id)
    assert second["model"] == "deterministic-rule-registry"
    assert "REGRA-004 — Material crítico" in second["answer"]


def test_planner_treats_diferenca_as_comparison() -> None:
    plan = plan_database_question(
        "No Cenário ORION o REAL é 27.267 e no DPP Final é 25.000, por que essa diferença?"
    )
    assert plan.intent == "comparison"
    assert plan.needs_synthesis is True


def test_long_comparison_does_not_inherit_previous_rule_context() -> None:
    context = {
        "subject_type": "rule",
        "subject_key": "REGRA-004",
        "topic": "rule_definition",
        "last_entities": [{"type": "rule", "key": "REGRA-004"}],
    }
    question = (
        'No CENÁRIO ORION por que na coluna "KIT disponivel PGD" diz ter 27.267 e o real também diz 27.267 '
        'enquanto o DPP FINAL diz que o kit pgd tbm era 27.267 e o real ficou 25.000 com diferença de -2.267, '
        'pq essa diferença?'
    )

    plan = plan_database_question(question, context)

    assert plan.intent == "comparison"
    assert plan.rule_entities == []
    assert plan.context_rule_entities == []
    assert "REGRA-004" not in plan.resolved_question


def test_short_typed_rule_reference_still_inherits_rule_context() -> None:
    context = {
        "subject_type": "rule",
        "subject_key": "REGRA-004",
        "last_entities": [{"type": "rule", "key": "REGRA-004"}],
    }

    plan = plan_database_question("E essa regra?", context)

    assert plan.rule_entities == ["REGRA-004"]
    assert plan.context_rule_entities == ["REGRA-004"]


def test_reverse_model_resolver_uses_structured_values_and_ignores_unrelated_models(monkeypatch) -> None:
    records = [
        {
            "entity_type": "model",
            "entity_key": "CM-220-N",
            "scope": "scenario",
            "source": "workspace://scenario/test/model/CM-220-N",
            "payload": {"name": "CM-220-N", "kit_pgd": 27267, "real": 27267, "difference_real_vs_kit": 0},
        },
        {
            "entity_type": "model",
            "entity_key": "CM-220-N",
            "scope": "final",
            "source": "workspace://final/test/model/CM-220-N",
            "payload": {"name": "CM-220-N", "pgd": 27267, "real": 25000, "delta": -2267},
        },
        {
            "entity_type": "model",
            "entity_key": "12F-IDU",
            "scope": "scenario",
            "source": "workspace://scenario/test/model/12F-IDU",
            "payload": {"name": "12F-IDU", "kit_pgd": 0, "real": 0, "difference_real_vs_kit": 0},
        },
        {
            "entity_type": "model",
            "entity_key": "12F-IDU",
            "scope": "final",
            "source": "workspace://final/test/model/12F-IDU",
            "payload": {"name": "12F-IDU", "pgd": 0, "real": 0, "delta": 0},
        },
        {
            "entity_type": "model",
            "entity_key": "T1W",
            "scope": "scenario",
            "source": "workspace://scenario/test/model/T1W",
            "payload": {"name": "T1W", "kit_pgd": 100, "real": 100, "difference_real_vs_kit": 0},
        },
        {
            "entity_type": "model",
            "entity_key": "T1W",
            "scope": "final",
            "source": "workspace://final/test/model/T1W",
            "payload": {"name": "T1W", "pgd": 100, "real": 90, "delta": -10},
        },
    ]

    monkeypatch.setattr(structured, "load_runtime_entities", lambda **kwargs: records)

    question = (
        'No CENÁRIO ORION por que na coluna "KIT disponivel PGD" diz ter 27.267 e o real também diz 27.267 '
        'enquanto o DPP FINAL diz que o kit pgd tbm era 27.267 e mas o real do dpp final ficou 25.000 '
        'com diferença de -2.267, pq essa diferença?'
    )
    plan = plan_database_question(question)
    knowledge, route = structured.structured_knowledge_answer(plan, {})

    assert route == "model-comparison"
    assert knowledge is not None
    assert knowledge.entities == ["CM-220-N"]
    assert "Modelo identificado pelos dados informados: CM-220-N" in knowledge.answer
    assert "A divergência matemática está no REAL" in knowledge.answer
    assert "27.267" in knowledge.answer
    assert "25.000" in knowledge.answer
    assert "-2.267" in knowledge.answer
    assert "causa operacional" in knowledge.answer
    assert "ainda precisa ser investigada" in knowledge.answer
    assert "12F-IDU" not in knowledge.answer
    assert "T1W" not in knowledge.answer
    assert len(knowledge.chunks) == 2
    assert knowledge.context["structured_evidence_complete"] is True
    assert knowledge.context["compact_llm"] is True
    assert knowledge.context["operational_cause_demonstrated"] is False


def test_reverse_model_resolver_blocks_ambiguous_matches_instead_of_using_bm25(monkeypatch) -> None:
    records = []
    for key in ("MODELO-A", "MODELO-B"):
        records.extend([
            {
                "entity_type": "model",
                "entity_key": key,
                "scope": "scenario",
                "source": f"workspace://scenario/test/model/{key}",
                "payload": {"name": key, "kit_pgd": 27267, "real": 27267, "difference_real_vs_kit": 0},
            },
            {
                "entity_type": "model",
                "entity_key": key,
                "scope": "final",
                "source": f"workspace://final/test/model/{key}",
                "payload": {"name": key, "pgd": 27267, "real": 25000, "delta": -2267},
            },
        ])
    monkeypatch.setattr(structured, "load_runtime_entities", lambda **kwargs: records)

    plan = plan_database_question("KIT 27.267, REAL 27.267; Final KIT 27.267, REAL 25.000, diferença -2.267")
    knowledge, route = structured.structured_knowledge_answer(plan, {})

    assert route == "model-comparison"
    assert knowledge is not None
    assert knowledge.context["skip_llm"] is True
    assert knowledge.sources == []
    assert knowledge.chunks == []
    assert "identificar de forma única" in knowledge.answer


def test_model_real_impact_uses_material_matrix_and_rag_rules(monkeypatch) -> None:
    records = [
        {
            "entity_type": "model",
            "entity_key": "CM-220-N",
            "scope": "scenario",
            "source": "workspace://scenario/test/model/CM-220-N",
            "payload": {"name": "CM-220-N", "kit_pgd": 27267, "real": 27267, "difference_real_vs_kit": 0},
        },
        {
            "entity_type": "model",
            "entity_key": "CM-220-N",
            "scope": "final",
            "source": "workspace://final/test/model/CM-220-N",
            "payload": {"name": "CM-220-N", "pgd": 27267, "real": 25000, "delta": -2267},
        },
        {
            "entity_type": "material",
            "entity_key": "MAT-001",
            "scope": "scenario",
            "source": "workspace://scenario/test/material/MAT-001",
            "payload": {
                "material": "MAT-001",
                "description": "Material de teste",
                "um": "UN",
                "consumption_by_model": {"CM-220-N": 2},
                "nec": 54534,
                "stock_total": 60000,
                "balance": 5466,
                "price": 10,
                "amount": 54660,
            },
        },
        {
            "entity_type": "material",
            "entity_key": "MAT-001",
            "scope": "final",
            "source": "workspace://final/test/material/MAT-001",
            "payload": {
                "material": "MAT-001",
                "description": "Material de teste",
                "um": "UN",
                "nec": 50000,
                "stock_total": 60000,
                "balance": 10000,
            },
        },
    ]

    def fake_load_runtime_entities(*, entity_type=None, entity_key=None, scope=None):
        selected = records
        if entity_type:
            selected = [item for item in selected if item["entity_type"] == entity_type]
        if entity_key:
            selected = [item for item in selected if item["entity_key"].lower() == entity_key.lower()]
        if scope:
            selected = [item for item in selected if item["scope"] == scope]
        return selected

    monkeypatch.setattr(structured, "load_runtime_entities", fake_load_runtime_entities)

    question = (
        'Estou falando do modelo "CM-220-N". No CENÁRIO ORION o KIT é 27.267 e o REAL 27.267; '
        'no DPP FINAL o KIT é 27.267 e o REAL 25.000, diferença -2.267. '
        'Isso influenciou NEC, SALDO, STK TTL e AMOUNT?'
    )
    plan = plan_database_question(question)
    knowledge, route = structured.structured_knowledge_answer(plan, {})

    assert route == "model-comparison"
    assert knowledge is not None
    assert knowledge.context["topic"] == "model_real_impact"
    assert "REGRA-001" in knowledge.answer
    assert "REGRA-002" in knowledge.answer
    assert "REGRA-003" in knowledge.answer
    assert "REGRA-006" in knowledge.answer
    assert "REAL não entra diretamente no STK TTL" in knowledge.answer
    assert "regras-globais.md" in knowledge.sources
    assert knowledge.chunks[0].source == "regras-globais.md"
    assert knowledge.table is not None
    assert knowledge.table["title"].startswith("Impacto isolado do ΔREAL de CM-220-N")
    row = knowledge.table["rows"][0]
    assert row["material"] == "MAT-001"
    assert row["consumption"] == "2"
    assert row["nec_effect"] == "-4.534"
    assert row["saldo_effect"] == "4.534"
    assert row["amount_effect"] == "45.340"
    assert row["observed_stk_delta"] == "0"
