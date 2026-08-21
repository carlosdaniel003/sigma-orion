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
