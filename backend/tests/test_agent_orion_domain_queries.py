from __future__ import annotations

from app.services import database_answer_service as answers
from app.services.database_query_planner_service import plan_database_question


RECORDS = [
    {
        "entity_type": "material",
        "entity_key": "MAT-ADESIVO-001",
        "scope": "scenario",
        "source": "workspace://scenario/test/material/MAT-ADESIVO-001",
        "payload": {
            "material": "MAT-ADESIVO-001",
            "description": "ADESIVO DUPLA FACE",
            "um": "UN",
            "group_origin": "LOCAL",
            "balance": -25,
            "status": "INVESTIGAR",
            "critical": True,
        },
    },
    {
        "entity_type": "material",
        "entity_key": "MAT-CAP-002",
        "scope": "scenario",
        "source": "workspace://scenario/test/material/MAT-CAP-002",
        "payload": {
            "material": "MAT-CAP-002",
            "description": "CAPACITOR CERAMICO",
            "um": "UN",
            "group_origin": "LOCAL",
            "balance": 40,
            "status": "OK",
            "critical": False,
        },
    },
    {
        "entity_type": "material",
        "entity_key": "MAT-ADESIVO-001",
        "scope": "final",
        "source": "workspace://final/test/material/MAT-ADESIVO-001",
        "payload": {
            "material": "MAT-ADESIVO-001",
            "description": "ADESIVO DUPLA FACE",
            "um": "UN",
            "balance": -20,
            "critical": True,
        },
    },
]


def _fake_runtime_entities(*, entity_type=None, entity_key=None, scope=None):
    selected = RECORDS
    if entity_type:
        selected = [item for item in selected if item["entity_type"] == entity_type]
    if entity_key:
        selected = [item for item in selected if item["entity_key"].lower() == str(entity_key).lower()]
    if scope:
        selected = [item for item in selected if item["scope"] == scope]
    return selected


def test_itens_criticos_is_a_structured_material_collection(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("Me fale sobre os itens críticos")

    assert "1 materiais críticos" in result.answer
    assert "REGRA-004" in result.answer
    assert result.table is not None
    assert result.table["total_rows"] == 1
    assert result.table["rows"][0]["material"] == "MAT-ADESIVO-001"
    assert "Check" not in result.answer


def test_critical_calculation_explains_full_deterministic_chain(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("Me fala como vc calculou os itens criticos")

    assert "REGRA-001" in result.answer
    assert "REGRA-002" in result.answer
    assert "REGRA-003" in result.answer
    assert "REGRA-004" in result.answer
    assert "NEC = Σ(REAL do modelo × consumo do material no modelo)" in result.answer
    assert "STK TTL = STK SAP efetivo + EXPLOSÃO + STK OP" in result.answer
    assert "SALDO = STK TTL - NEC" in result.answer
    assert "UM = UN" in result.answer
    assert "SALDO < -0,0001" in result.answer
    assert result.context["skip_llm"] is True


def test_material_description_search_returns_matching_items(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("Me fala sobre os itens de adesivo")

    assert "1 material(is)" in result.answer
    assert "adesivo" in result.answer.lower()
    assert result.table is not None
    assert result.table["total_rows"] == 1
    assert result.table["rows"][0]["material"] == "MAT-ADESIVO-001"
    assert result.table["rows"][0]["description"] == "ADESIVO DUPLA FACE"
    assert all(row["material"] != "MAT-CAP-002" for row in result.table["rows"])


def test_natural_topical_question_requests_synthesis() -> None:
    plan = plan_database_question("Me fale sobre OPC")

    assert plan.intent == "definition"
    assert "OPC" in plan.concept_entities
    assert plan.needs_synthesis is True


def test_calculou_is_recognized_as_formula_intent() -> None:
    plan = plan_database_question("Me fala como vc calculou os itens criticos")

    assert plan.intent == "formula"


def test_broad_material_count_uses_runtime_entities(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("Quantos materiais existem?")

    assert "2 material(is) no Cenário ORION" in result.answer
    assert "1 material(is) no DPP Final" in result.answer
    assert result.context["structured_evidence_complete"] is True


def test_glossary_material_definition_keeps_priority(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("O que significa Material?")

    assert result.sources == ["glossario.md"]
    assert result.answer.startswith("Material:")
    assert "Código identificador do material" in result.answer


def test_critical_calculation_question_does_not_fall_into_material_glossary(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("Como é feito o cálculo para definir material crítico?")

    assert "REGRA-001" in result.answer
    assert "REGRA-002" in result.answer
    assert "REGRA-003" in result.answer
    assert "REGRA-004" in result.answer
    assert "Código identificador do material" not in result.answer
    assert result.table is None


def test_what_defines_critical_material_returns_rule_not_full_list(monkeypatch) -> None:
    monkeypatch.setattr(answers, "load_runtime_entities", _fake_runtime_entities)

    result = answers.answer_database_knowledge("O que define material crítico?")

    assert "UM = UN" in result.answer
    assert "SALDO < -0,0001" in result.answer
    assert "REGRA-004" in result.answer
    assert result.table is None


def test_planner_preserves_calculation_facet_in_comparison_question() -> None:
    plan = plan_database_question("Como SALDO é calculado? Por que o SALDO do CM 200 N está dando divergência?")

    assert plan.intent == "comparison"
    assert plan.comparison_requested is True
    assert plan.calculation_requested is True
    assert "SALDO" in plan.concept_entities
