from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app


def build_xlsx() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Estoque"
    sheet.append(["material", "quantidade"])
    sheet.append(["ABC001", 10])
    sheet.append(["ABC002", 20])

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_health() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_agent_status_uses_mock_by_default() -> None:
    with TestClient(app) as client:
        response = client.get("/api/agent/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["model"] == "mock-local"
    assert payload["mode"] == "demo"


def test_knowledge_status_loads_versioned_files() -> None:
    with TestClient(app) as client:
        response = client.get("/api/knowledge/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "lexical-local"
    assert payload["embedding_enabled"] is False
    assert payload["document_count"] >= 3
    assert payload["chunk_count"] >= 3
    assert "guardrails.md" in payload["files"]


def test_agent_demo_is_explicitly_fake() -> None:
    with TestClient(app) as client:
        response = client.get("/api/agent/demo")

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["is_demo"] is True
    assert "fict" in payload["demo_notice"].lower()
    assert payload["risks"]
    assert payload["recommendations"]


def test_agent_demo_chat() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/agent/chat-demo",
            json={"question": "Por que MAT-DEMO-001 está crítico?"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["is_demo"] is True
    assert "-220" in payload["answer"]


def test_agent_chat_uses_same_provider_contract() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/agent/chat",
            json={"question": "Quais limites o agente deve respeitar?"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["model"] == "mock-local"
    assert payload["is_demo"] is True
    assert isinstance(payload["knowledge_sources"], list)


def test_structured_mock_analysis_is_saved_to_history() -> None:
    request_payload = {
        "metrics": {
            "total_materials": 2,
            "critical": 1,
            "attention": 0,
            "ok": 1,
        },
        "facts": {
            "scenario": "teste automatizado",
            "materials": [
                {"material": "TEST-001", "gap": -10},
                {"material": "TEST-002", "gap": 5},
            ],
        },
        "objective": "Validar o contrato estruturado sem usar uma LLM externa.",
    }

    with TestClient(app) as client:
        analysis_response = client.post("/api/agent/analyze", json=request_payload)
        assert analysis_response.status_code == 200
        analysis = analysis_response.json()
        assert analysis["provider"] == "mock"
        assert analysis["metrics"] == request_payload["metrics"]
        assert analysis["risks"] == []
        assert analysis["recommendations"] == []

        history_response = client.get("/api/analyses/history")
        assert history_response.status_code == 200
        history = history_response.json()
        assert any(item["analysis_id"] == analysis["analysis_id"] for item in history)

        detail_response = client.get(f"/api/analyses/{analysis['analysis_id']}")
        assert detail_response.status_code == 200
        assert detail_response.json()["payload"]["analysis_id"] == analysis["analysis_id"]


def test_save_feedback() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/feedback",
            json={
                "analysis_id": "demo-test",
                "recommendation_id": "rec-test",
                "decision": "approved",
                "comment": None,
            },
        )

    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert isinstance(response.json()["id"], int)


def test_inspect_xlsx() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/files/inspect",
            files={
                "files": (
                    "estoque.xlsx",
                    build_xlsx(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["files_received"] == 1
    assert payload["files"][0]["filename"] == "estoque.xlsx"
    assert payload["files"][0]["sheets"][0]["name"] == "Estoque"
    assert payload["files"][0]["sheets"][0]["rows"] == 2
    assert payload["files"][0]["sheets"][0]["columns"] == ["material", "quantidade"]
