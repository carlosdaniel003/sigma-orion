from fastapi.testclient import TestClient

from app.main import app
from app.services.knowledge_catalog_service import bm25_retrieve, sync_knowledge_index


def ask(question: str) -> dict:
    with TestClient(app) as client:
        response = client.post("/api/knowledge/chat", json={"question": question})
    assert response.status_code == 200
    return response.json()


def test_nec_formula_is_grounded_in_database_rag() -> None:
    payload = ask("Qual a fórmula para NEC?")

    assert payload["provider"] == "local-rag"
    assert payload["model"] == "sqlite-fts5-bm25"
    assert payload["database"] == "orion.db"
    assert payload["knowledge_sources"] == ["motor-deterministico.md"]
    assert "NEC = Σ(REAL do modelo × consumo do material naquele modelo)" in payload["answer"]
    assert "calculate_nec" in payload["answer"]
    assert payload["retrieval"]
    assert payload["audit_id"] is not None


def test_wiu_definition_comes_from_indexed_glossary() -> None:
    payload = ask("O que significa WIU?")

    assert payload["knowledge_sources"] == ["glossario.md"]
    assert payload["answer"].startswith("WIU:")
    assert "Lista de modelos associada ao material" in payload["answer"]
    assert payload["retrieval"][0]["source"] == "glossario.md"


def test_out_of_scope_question_abstains_without_predefined_answer() -> None:
    payload = ask("Qual o dia de hoje?")

    assert payload["knowledge_sources"] == []
    assert "banco de conhecimento SQLite" in payload["answer"]
    assert payload["retrieval"] == []
    assert payload["audit_id"] is not None


def test_model_impact_rules_remain_retrievable_by_bm25() -> None:
    sync_knowledge_index(force=True)
    cases = (
        ("REGRA-001 NEC REAL consumo", "REGRA-001"),
        ("REGRA-002 STK TTL STK SAP EXPLOSÃO STK OP", "REGRA-002"),
        ("REGRA-003 SALDO STK TTL NEC", "REGRA-003"),
        ("REGRA-006 Amount Preço SALDO", "REGRA-006"),
    )

    for query, rule_code in cases:
        chunks = bm25_retrieve(query, limit=40, category="deterministic")
        matched = [
            chunk for chunk in chunks
            if chunk.source == "regras-globais.md"
            and rule_code in f"{chunk.heading}\n{chunk.content}"
        ]
        assert matched, f"{rule_code} deixou de ser recuperável pelo RAG/BM25"
