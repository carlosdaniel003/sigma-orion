from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app

MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _save(workbook: Workbook) -> bytes:
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_wiu() -> bytes:
    workbook = Workbook()
    power = workbook.active
    power.title = "POWER"
    power.append([
        "Código", "Modelo", "Nível", "Componente", "Descrição", "Uso BOM",
        "Unidade de Medida", "Centro", "Grupo Origem", "Total preço médio móvel", "LT alternativa",
    ])
    power.append(["1000-01", "MODEL-A", 1, "MAT-001", "Material importado", 2, "UN", 1063, "Importado", 0, 1])
    power.append(["1000-01", "MODEL-A", 1, "MAT-001", "Material importado", 0.5, "UN", 1063, "Importado", 0, 1])
    power.append(["2000-01", "MODEL-B", 1, "MAT-001", "Material importado", 1, "UN", 1063, "Importado", 0, 1])
    power.append(["1000-01", "MODEL-A", 1, "MAT-NAC", "Material nacional", 5, "UN", 1063, "Nacional", 0, 1])

    matrix = workbook.create_sheet("WIU JULHO")
    matrix["E1"] = "1000-01"
    matrix["F1"] = "2000-01"
    matrix["E2"] = "MODEL-A"
    matrix["F2"] = "MODEL-B"
    return _save(workbook)


def build_explosion() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "CONSOLIDADO"
    sheet.append(["Material", "Descrição", "UM", "EXPLOSÃO (01.07.2026)"])
    sheet.append(["MAT-001", "Material importado", "UN", 20])
    sheet.append(["MAT-NAC", "Material nacional", "UN", 50])
    return _save(workbook)


def build_stock() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "CONSOLIDADO"
    sheet.append(["Material", "Descrição", "UOM", "Controle qualidade", "Utilização livre", "STK TTL (01.07.2026)"])
    sheet.append(["MAT-001", "Material importado", "UN", 0, 100, 100])
    return _save(workbook)


def test_source_consolidation_works_with_wiu_and_explosion_only() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/dpp/consolidate",
            files={
                "wiu": ("WIU.xlsx", build_wiu(), MIME),
                "explosion": ("EXPLOSAO.xlsm", build_explosion(), MIME),
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "source_consolidation"
    assert payload["status"] == "PARCIAL"
    assert payload["summary"]["materials"] == 1
    assert payload["summary"]["models"] == 2
    assert payload["summary"]["explosion_matches"] == 1
    assert payload["summary"]["stock_loaded"] is False

    material = payload["materials"][0]
    assert material["material"] == "MAT-001"
    assert material["consumption_by_model"]["MODEL-A"] == 2.5
    assert material["consumption_by_model"]["MODEL-B"] == 1
    assert material["used_models"] == ["MODEL-A", "MODEL-B"]
    assert material["explosion"] == 20
    assert material["stock_sap"] is None
    assert material["available_base"] is None
    assert material["source"]["sheet"] == "POWER"
    assert material["explosion_source"]["cell"] == "D2"


def test_source_consolidation_is_ready_for_stock_snapshot() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/dpp/consolidate",
            files={
                "wiu": ("WIU.xlsx", build_wiu(), MIME),
                "explosion": ("EXPLOSAO.xlsm", build_explosion(), MIME),
                "stock": ("STK.xlsx", build_stock(), MIME),
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["stock_loaded"] is True
    assert payload["summary"]["stock_matches"] == 1
    material = payload["materials"][0]
    assert material["stock_sap"] == 100
    assert material["available_base"] == 120
    assert material["stock_source"]["cell"] == "F2"
    assert payload["capabilities"]["stock_sap"] is True
    assert payload["capabilities"]["nec"] is False
