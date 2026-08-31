from fastapi.testclient import TestClient

from app.main import app


def ask(question: str) -> dict:
    with TestClient(app) as client:
        response = client.post("/api/agent/chat", json={"question": question})
    assert response.status_code == 200
    return response.json()


def test_nec_formula_is_concise_and_has_no_broken_formula_label() -> None:
    payload = ask("Qual a fórmula para NEC?")

    assert payload["provider"] == "local-rag"
    assert payload["knowledge_sources"] == ["motor-deterministico.md"]
    assert "NEC = Σ(REAL do modelo × consumo do material naquele modelo)" in payload["answer"]
    assert "calculate_nec" in payload["answer"]
    assert "Fórmula:." not in payload["answer"]
    assert "| Termo |" not in payload["answer"]
    assert len(payload["answer"]) < 700


def test_wiu_definition_comes_from_glossary_instead_of_monthly_source_section() -> None:
    payload = ask("O que significa WIU?")

    assert payload["knowledge_sources"] == ["glossario.md"]
    assert payload["answer"].startswith("WIU:")
    assert "Lista de modelos associada ao material" in payload["answer"]
    assert "Fontes mensais usadas para gerar" not in payload["answer"]


def test_out_of_scope_question_abstains_instead_of_returning_random_chunk() -> None:
    payload = ask("Qual o dia de hoje?")

    assert payload["knowledge_sources"] == []
    assert "Não encontrei informação validada" in payload["answer"]
    assert "guardrails" not in payload["answer"].lower()
