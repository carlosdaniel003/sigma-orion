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
    headings = "\n".join(item["heading"] for item in payload["retrieval"])
    assert "REGRA-004" in headings
    assert payload["llm_used"] is False  # CI usa provider mock; retrieval ocorre antes da LLM.


def test_smalltalk_is_handled_by_deterministic_router() -> None:
    payload = ask("Oi teste", "smalltalk")

    assert payload["provider"] == "local-router"
    assert payload["model"] == "deterministic-router"
    assert "Agente ORION está disponível" in payload["answer"]
