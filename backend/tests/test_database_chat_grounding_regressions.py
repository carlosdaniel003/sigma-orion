from fastapi.testclient import TestClient

from app.main import app


def ask(question: str, session_id: str = "grounding-regression") -> dict:
    with TestClient(app) as client:
        response = client.post(
            "/api/knowledge/chat",
            json={"question": question, "session_id": session_id},
        )
    assert response.status_code == 200
    return response.json()


def test_long_wiu_explanation_retrieves_glossary() -> None:
    payload = ask(
        "Explique claramente o significado operacional de WIU no processo do DPP",
        "wiu-long-question",
    )

    assert "WIU" in payload["entities"]
    assert "glossario.md" in payload["knowledge_sources"]
    assert "Lista de modelos associada ao material" in payload["answer"]
    assert "operacional" not in [str(item).lower() for item in payload["entities"]]


def test_opc_stk_ttl_retrieval_has_both_rules_and_no_incidental_python() -> None:
    payload = ask(
        "Explique como OPC interfere no cálculo de STK TTL segundo as regras do ORION",
        "opc-stk-ttl",
    )

    assert "OPC" in payload["entities"]
    assert "STK TTL" in payload["entities"]
    assert "interfere" not in [str(item).lower() for item in payload["entities"]]
    assert all(not source.startswith("python://") for source in payload["knowledge_sources"])
    assert all(not item["source"].startswith("python://") for item in payload["retrieval"])
    headings = "\n".join(item["heading"] for item in payload["retrieval"])
    contents_sources = "\n".join(payload["knowledge_sources"])
    assert "REGRA-005" in headings or "regras-globais.md" in contents_sources
    assert "REGRA-002" in headings or "motor-deterministico.md" in contents_sources


def test_critical_followup_retrieves_rule_004_without_pre_query_llm() -> None:
    session_id = "critical-followup"
    first = ask("Qual o saldo do material 010203-0010-01?", session_id)
    assert "010203-0010-01" in first["answer"]

    payload = ask(
        "Por que esse material não está crítico mesmo estando com saldo negativo?",
        session_id,
    )

    assert "010203-0010-01" in payload["entities"]
    assert "FORA_ESCOPO_UM" in payload["entities"]
    assert "UM é G" in payload["answer"]
    assert "UM = UN" in payload["answer"]
    assert "REGRA-004" in payload["answer"]
    assert "FORA_ESCOPO_UM" in payload["answer"]
    headings = "\n".join(item["heading"] for item in payload["retrieval"])
    assert "REGRA-004" in headings
    assert payload["llm_used"] is False  # CI usa provider mock; retrieval ocorre antes da LLM.


def test_explicit_status_definition_uses_deterministic_registry() -> None:
    payload = ask(
        'E o que quer dizer esse status "FORA_ESCOPO_UM"?',
        "explicit-status-definition",
    )

    assert payload["model"] == "deterministic-status-registry"
    assert "FORA_ESCOPO_UM" in payload["entities"]
    assert "unidade de medida é diferente de UN" in payload["answer"]
    assert "mesmo que tenha SALDO negativo" in payload["answer"]
    assert "REGRA-004" in payload["answer"]


def test_status_followup_prefers_last_mentioned_status_over_material() -> None:
    session_id = "status-followup-context"
    ask("Qual o saldo do material 010203-0010-01?", session_id)
    critical = ask(
        "Por que esse material não está crítico mesmo estando com saldo negativo?",
        session_id,
    )
    assert "FORA_ESCOPO_UM" in critical["entities"]

    payload = ask("E o que quer dizer esse status?", session_id)

    assert payload["model"] == "deterministic-status-registry"
    assert payload["entities"][0] == "FORA_ESCOPO_UM"
    assert "unidade de medida é diferente de UN" in payload["answer"]
    assert payload["table"] is None


def test_generic_isso_can_resolve_last_status_entity() -> None:
    session_id = "status-isso-context"
    ask("Qual o saldo do material 010203-0010-01?", session_id)
    ask("Por que esse material não está crítico mesmo estando com saldo negativo?", session_id)

    payload = ask("O que é isso?", session_id)

    assert payload["model"] == "deterministic-status-registry"
    assert "FORA_ESCOPO_UM" in payload["answer"]


def test_smalltalk_is_handled_by_deterministic_router() -> None:
    payload = ask("Oi teste", "smalltalk")

    assert payload["provider"] == "local-router"
    assert payload["model"] == "deterministic-router"
    assert "Agente ORION está disponível" in payload["answer"]
