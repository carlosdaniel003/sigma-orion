from fastapi.testclient import TestClient

from app.main import app


WORKSPACE = {
    "month": "2026-07",
    "state": {"package": "ready", "scenario": "current", "final_dpp": "current"},
    "scenario": {
        "scenario_id": "scenario-chat-test",
        "reference_month": "2026-07",
        "summary": {"materials": 2, "materials_to_investigate": 1, "models": 1},
        "models": [{"name": "MODEL-A", "kit_pgd": 100, "real": 90, "difference_real_vs_kit": -10}],
        "materials": [
            {
                "material": "MAT-CRIT-001",
                "description": "Material crítico",
                "um": "UN",
                "group_origin": "Local",
                "nec": 120,
                "stock_sap_effective": 80,
                "explosion": 10,
                "stock_op": 0,
                "stock_total": 90,
                "balance": -30,
                "status": "INVESTIGAR",
                "check": "MODEL-A",
            },
            {
                "material": "010203-0010-01",
                "description": "RESINA ABS PIGMENTADO PRETO",
                "um": "G",
                "group_origin": "Importado",
                "nec": 27028175.96,
                "stock_sap_effective": 252798.643,
                "explosion": 4551249.207,
                "stock_op": 0,
                "stock_total": 4804047.85,
                "balance": -22224128.11,
                "status": "FORA_ESCOPO_UM",
                "check": "MODEL-A",
                "in_current_wiu": True,
            },
        ],
    },
    "final_dpp": {
        "analysis_id": "final-chat-test",
        "filename": "DPP_FINAL_TEST.xlsx",
        "summary": {"total_materials": 2, "critical_materials": 1, "model_count": 1},
        "critical_rule": {"unit": "UN", "balance_lt": -0.0001},
        "models": [{"name": "MODEL-A", "pgd": 100, "real": 90, "delta": -10}],
        "material_details": [
            {
                "material": "MAT-CRIT-001",
                "description": "Material crítico",
                "um": "UN",
                "group_origin": "Local",
                "nec": 120,
                "stock": 80,
                "explosion": 10,
                "stock_op": 0,
                "stock_total": 90,
                "balance": -30,
                "critical": True,
                "affected_models": ["MODEL-A"],
            },
            {
                "material": "010203-0010-01",
                "description": "RESINA ABS PIGMENTADO PRETO",
                "um": "G",
                "group_origin": "Importado",
                "nec": 56047080.785,
                "stock": 252798.643,
                "explosion": 4551249.207,
                "stock_op": None,
                "stock_total": 4804047.85,
                "balance": -51243032.935,
                "critical": False,
                "affected_models": ["MODEL-A"],
            },
        ],
        "column_comparison": {
            "analysis_id": "final-chat-test",
            "reference_month": "2026-07",
            "columns_total": 2,
            "comparable_columns": 2,
            "divergent_columns": 1,
            "columns": [
                {"name": "SALDO", "column": 15, "supported": True, "difference_count": 1, "delta": -29018904.825},
                {"name": "STK OP", "column": 13, "supported": True, "difference_count": 0, "delta": 0},
            ],
        },
    },
}


def _sync(client: TestClient) -> None:
    response = client.post("/api/knowledge/workspace/sync", json=WORKSPACE)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["runtime_entity_count"] >= 8


def _ask(client: TestClient, question: str, session_id: str = "chat-context-test") -> dict:
    response = client.post("/api/knowledge/chat", json={"question": question, "session_id": session_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_material_lookup_is_concise_and_uses_structured_sqlite_entities() -> None:
    with TestClient(app) as client:
        _sync(client)
        payload = _ask(client, "Qual o saldo do material 010203-0010-01?", "material-flow")

    assert "SALDO do material 010203-0010-01" in payload["answer"]
    assert "SALDO ORION" in payload["answer"]
    assert "SALDO Final" in payload["answer"]
    assert "Dados completos" not in payload["answer"]
    assert "010203-0010-01" in payload["entities"]
    assert payload["model"] == "sqlite-fts5-bm25"


def test_follow_up_resolves_esse_material_from_sqlite_chat_context() -> None:
    with TestClient(app) as client:
        _sync(client)
        _ask(client, "Qual o saldo do material 010203-0010-01?", "follow-material")
        payload = _ask(client, "Esse material está crítico?", "follow-material")

    assert "010203-0010-01" in payload["answer"]
    assert "não está crítico" in payload["answer"]
    assert "FORA_ESCOPO_UM" in payload["answer"]
    assert "010203-0010-01" in payload["resolved_question"]


def test_plural_critical_query_returns_database_table_not_python_demo() -> None:
    with TestClient(app) as client:
        _sync(client)
        payload = _ask(client, "Quais materiais estão críticos?", "critical-list")

    assert payload["table"] is not None
    assert payload["table"]["total_rows"] == 1
    assert payload["table"]["rows"][0]["material"] == "MAT-CRIT-001"
    assert "build_demo_analysis" not in payload["answer"]
    assert "demo" not in " ".join(payload["knowledge_sources"]).lower()


def test_definition_then_python_follow_up_uses_previous_subject() -> None:
    with TestClient(app) as client:
        _sync(client)
        definition = _ask(client, "O que significa WIU?", "wiu-flow")
        follow_up = _ask(client, "O que o código Python faz nesta regra?", "wiu-flow")

    assert definition["knowledge_sources"] == ["glossario.md"]
    assert "WIU" in follow_up["resolved_question"]
    assert any(source.startswith("python://") for source in follow_up["knowledge_sources"])
    assert "_database_path" not in follow_up["answer"]


def test_opc_reranking_does_not_lead_with_readme_noise() -> None:
    with TestClient(app) as client:
        _sync(client)
        payload = _ask(client, "O que sabemos sobre OPC?", "opc-flow")

    assert "OPC" in payload["answer"]
    assert "README.md" not in payload["knowledge_sources"]
    assert "Planilhas representam os fatos atuais" not in payload["answer"]
