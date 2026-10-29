from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import knowledge_catalog_service as catalog
from app.services.rag_runtime_service import load_chat_context


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, tmp_path):
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'operational.db'}")
    monkeypatch.setattr(catalog, "_LAST_FINGERPRINT", None)


WORKSPACE = {
    "month": "2026-07",
    "scenario": {
        "scenario_id": "operational-test-2026-07",
        "reference_month": "2026-07",
        "summary": {
            "materials": 3, "models": 2, "kit_pgd_total": 120,
            "real_total": 110, "materials_to_investigate": 1,
            "negative_balance_all_units": 2, "outside_scope_um": 1,
            "models_above_kit": 0,
        },
        "models": [
            {"name": "MODEL-A", "kit_pgd": 100, "real": 90},
            {"name": "MODEL-B", "kit_pgd": 20, "real": 20},
        ],
        "materials": [
            {"material": "PN-A1", "description": "Parafuso", "um": "UN",
             "nec": 100, "stock_total": 60, "balance": -40, "status": "INVESTIGAR"},
            {"material": "PN-B1", "description": "Conector", "um": "UN",
             "nec": 10, "stock_total": 20, "balance": 10, "status": "OK"},
            {"material": "PN-G1", "description": "Resina", "um": "G",
             "nec": 150, "stock_total": 10, "balance": -140, "status": "FORA_ESCOPO_UM"},
        ],
    },
    "final_dpp": {
        "analysis_id": "operational-final-2026-07",
        "filename": "DPP_FINAL_2026_07.xlsx",
        "summary": {
            "pgd_total": 120, "real_total": 110, "active_models": 2,
            "risk_models": 1, "safe_models": 1,
            "material_coverage": 50.0, "pgd_exposed": 100,
            "model_count": 2, "total_materials": 3,
            "opc_count": 1,
        },
        "models": [
            {"name": "MODEL-A", "pgd": 100, "real": 90},
            {"name": "MODEL-B", "pgd": 20, "real": 20},
        ],
        "material_details": [],
    },
}


def _ask(client, question, session="explain-dpp"):
    response = client.post("/api/knowledge/chat", json={"question": question, "session_id": session})
    assert response.status_code == 200, response.text
    return response.json()


def _sync(client, workspace=None):
    r = client.post("/api/knowledge/workspace/sync", json=workspace or WORKSPACE)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("question, expected", [
    ("Para que serve o Dashboard do DPP?", "Dashboard do DPP"),
    ("O que mostra o pacote compartilhado?", "Pacote compartilhado do DPP"),
    ("Qual é a finalidade da Divergência de Estoque?", "Divergência de Estoque"),
    ("Como funciona a Análise de Qualidade?", "Análise de Qualidade"),
    ("Por que o PN passa para o CQ Q239 ou Q273?", "Análise de Qualidade"),
    ("De onde vêm os dados do plano consolidado por modelo?", "Plano consolidado por modelo"),
    ("O que é o DPP Final?", "ORION × DPP Final"),
    ("Explique a comparação das colunas do DPP", "Comparativo completo das colunas do DPP"),
    ("Para que servem os Testes do DPP?", "Testes do DPP"),
    ("Qual o objetivo das pendências de validação?", "Pendências de validação"),
])
def test_explain_module_from_authoritative_module_info(question, expected):
    with TestClient(app) as client:
        _sync(client)
        reply = _ask(client, question, session=f"module-{expected}-{question[:12]}")
    assert expected in reply["answer"]
    assert "**O que mostra:**" in reply["answer"]
    assert "**De onde vêm os dados:**" in reply["answer"]
    assert "**Para que serve / por quê:**" in reply["answer"]
    assert reply["knowledge_sources"] == ["modulos-interface.md"]
    assert reply["model"] == "deterministic-operational-explanation"
    assert reply["llm_used"] is False


def test_process_is_explained_from_real_documented_steps():
    with TestClient(app) as client:
        _sync(client)
        reply = _ask(client, "Explique o fluxo do DPP do início ao fim")
    assert "Pacote compartilhado" in reply["answer"]
    assert "Divergência de Estoque" in reply["answer"]
    assert "Análise de Qualidade" in reply["answer"]
    assert "validação" in reply["answer"].lower()
    assert "modulos-interface.md" in reply["knowledge_sources"]
    assert reply["llm_used"] is False


@pytest.mark.parametrize("question, expected, source", [
    ("Qual o total de materiais do Cenário ORION?", "3", "scenario"),
    ("Quantos modelos existem no Cenário ORION?", "2", "scenario"),
    ("Qual o total de KIT PGD?", "120", "scenario"),
    ("Qual o REAL planejado no cenário ORION?", "110", "scenario"),
    ("Quantos materiais com SALDO negativo?", "2", "scenario"),
    ("Qual a cobertura material no DPP Final?", "50%", "final"),
    ("Quantos modelos em risco existem no DPP Final?", "1", "final"),
    ("Quantos modelos ativos no DPP Final?", "2", "final"),
    ("Quantos modelos estão sem risco no DPP Final?", "1", "final"),
    ("Qual o PGD exposto no DPP Final?", "100", "final"),
])
def test_metrics_use_only_scoped_synced_entities(question, expected, source):
    with TestClient(app) as client:
        _sync(client)
        reply = _ask(client, question, f"metric-{question}")
    assert expected in reply["answer"]
    assert "não estimado pela IA" in reply["answer"]
    assert reply["model"] == "deterministic-operational-explanation"
    assert reply["llm_used"] is False
    assert any(f"/{source}/" in src for src in reply["knowledge_sources"])


def test_metric_cannot_borrow_final_value_to_answer_scenario():
    with TestClient(app) as client:
        _sync(client)
        reply = _ask(client, "Quantos modelos em risco no Cenário ORION?", "missing-risk")
    assert "não possui valor disponível" in reply["answer"]
    assert "não é possível afirmar que o valor é zero" in reply["answer"].lower()
    assert "1" not in reply["answer"].split("**Fato:**")[0]
    assert reply["llm_used"] is False


def test_coverage_definition_never_means_percent_of_producible_units():
    with TestClient(app) as client:
        _sync(client)
        reply = _ask(client, "O que significa cobertura material no Dashboard?")
    assert "50%" in reply["answer"]
    assert "modelos ativos" in reply["answer"]
    assert "Não representa percentual da quantidade produzível" in reply["answer"]


def test_module_followup_keeps_context_without_assigning_pn():
    with TestClient(app) as client:
        _sync(client)
        _ask(client, "Como funciona a Análise de Qualidade?", "module-followup")
        reply = _ask(client, "E o que isso mostra?", "module-followup")
        context = load_chat_context("module-followup")
    assert "Análise de Qualidade" in reply["answer"]
    assert context["subject_type"] == "module"
    assert context["subject_key"] == "dashboard.quality_investigation"


def test_critical_rule_and_pn_specific_queries_keep_previous_routers():
    with TestClient(app) as client:
        _sync(client)
        rule = _ask(client, "O que diz a REGRA-004?", "regra-unchanged")
        assert rule["model"] == "deterministic-rule-registry"
        specific = _ask(client, "Por que o material PN-A1 está crítico?", "pn-unchanged")
        assert "PN-A1" in specific["answer"]
        assert "REGRA-004" in specific["answer"]
        assert specific["model"] != "deterministic-operational-explanation"


def test_no_operational_cause_is_invented_when_only_aggregate_module_exists():
    with TestClient(app) as client:
        _sync(client)
        answer = _ask(client, "Por que o Cenário ORION diverge do DPP Final?")
        assert "diferença não significa automaticamente erro" in answer["answer"]
        assert "modulos-interface.md" in answer["knowledge_sources"]
        assert answer["llm_used"] is False


def test_module_uses_same_help_as_module_info_service():
    from app.services.module_info_service import get_module_info
    with TestClient(app) as client:
        _sync(client)
        answer = _ask(client, "Por que existe Divergência de Estoque?")
    module = get_module_info("dashboard.stock_divergence")
    assert module is not None
    assert module.purpose in answer["answer"]
    assert module.source in answer["answer"]
