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
