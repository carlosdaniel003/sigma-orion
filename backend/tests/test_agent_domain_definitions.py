from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import database_clock_service as clock
from app.services import knowledge_catalog_service as catalog
from app.services.database_domain_definition_service import answer_domain_definition
from app.services.database_multi_question_service import split_independent_questions
from app.services.rag_runtime_service import sync_runtime_workspace


@pytest.fixture(autouse=True)
def independent_index(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'knowledge.db'}")
    monkeypatch.setattr(catalog, "_LAST_FINGERPRINT", None)


def ask(question: str) -> dict:
    with TestClient(app) as client:
        response = client.post("/api/knowledge/chat", json={"question": question, "session_id": "domain-extended"})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("question,expected", [
    ("O que é PN?", "Part Number"),
    ("O que é PGD?", "KIT Disponível PGD"),
    ("O que é PCP?", "Planejamento e Controle da Produção"),
    ("O que é PCPM?", "ainda sem definição confirmada"),
    ("O que é OPEN PO?", "pedido de compra em aberto"),
    ("O que é SALDO?", "STK TTL menos NEC"),
    ("O que é WIU?", "Lista de modelos associada ao material"),
])
def test_short_domain_questions_come_from_verified_glossary(question, expected):
    result = ask(question)
    assert expected in result["answer"]
    assert result["knowledge_sources"] == ["glossario.md"]
    assert result["model"] == "deterministic-glossary-definition"
    assert not result["llm_used"]


def test_pgd_and_open_po_do_not_invent_process_specific_definitions():
    pgd = ask("O que é PGD?")
    po = ask("O que é Open PO?")
    pcpm = ask("O que é PCPM?")
    assert "expansão literal da sigla PGD não foi confirmada" in pgd["answer"]
    assert "ainda não foram validadas" in po["answer"]
    assert "devem ser validados" in pcpm["answer"]


def test_clock_answers_actual_local_day_without_llm(monkeypatch):
    fake = datetime(2026, 10, 29, 6, 45, tzinfo=ZoneInfo("America/Manaus"))
    monkeypatch.setattr(clock, "_clock_now", lambda timezone: fake)
    monkeypatch.setenv("ORION_TIMEZONE", "America/Manaus")
    for question in ("Que dia é hoje?", "Qual o dia de hoje?", "Qual é a data atual?"):
        result = ask(question)
        assert "quinta-feira, 29/10/2026" in result["answer"]
        assert "America/Manaus" in result["answer"]
        assert result["model"] == "deterministic-runtime-clock"
        assert not result["llm_used"]
        assert result["audit_id"] is not None

    time = ask("Que horas são?")
    assert "06:45" in time["answer"]
    assert "29/10/2026" in time["answer"]


def test_multi_question_does_not_drop_unknown_term_or_critical_materials():
    sync_runtime_workspace({
        "month": "2026-07",
        "scenario": {
            "scenario_id": "multi-domain-scenario",
            "reference_month": "2026-07",
            "materials": [
                {"material": "PN-100", "description": "Placa", "um": "UN", "status": "INVESTIGAR", "balance": -10},
                {"material": "PN-200", "description": "Parafuso", "um": "UN", "status": "OK", "balance": 10},
            ],
        },
    })
    result = ask("O que é PCPM? o que é materiais críticos?")
    assert "PCPM" in result["answer"]
    assert "sem definição confirmada" in result["answer"]
    assert "materiais críticos" in result["answer"]
    assert "REGRA-004" in result["answer"]
    assert result["table"]["total_rows"] == 1
    assert result["table"]["rows"][0]["material"] == "PN-100"
    assert result["model"] == "deterministic-multi-question"
    assert not result["llm_used"]


def test_multi_question_with_clock_and_glossary(monkeypatch):
    fake = datetime(2026, 10, 29, 9, 0, tzinfo=ZoneInfo("America/Manaus"))
    monkeypatch.setattr(clock, "_clock_now", lambda timezone: fake)
    result = ask("Que dia é hoje? E o que é PN?")
    assert "29/10/2026" in result["answer"]
    assert "Part Number" in result["answer"]
    assert "glossario.md" in result["knowledge_sources"]
    assert any(source.startswith("runtime://clock/") for source in result["knowledge_sources"])


def test_compound_causal_question_preserves_the_existing_planner():
    question = "Como SALDO é calculado? Por que o SALDO do CM 200 N está dando divergência?"
    assert split_independent_questions(question) == []


def test_unrelated_question_still_does_not_hallucinate_a_definition():
    assert answer_domain_definition("O que é um protocolo de teletransporte?") is None
