"""Cobertura do primeiro corte da investigação de estoque (etapa 4.1)."""
from copy import deepcopy
from io import BytesIO
from hashlib import sha256

from fastapi.testclient import TestClient
from openpyxl import Workbook
import pytest

from app.main import app
from app.api import routes
from app.services.dpp_stock_divergence_service import investigate_stock_divergence


def stock_bytes(rows: list[list], *, original: bool = True) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "ORIGINAL" if original else "CONSOLIDADO"
    sheet.append([
        "Material", "Texto breve material", "Utilização livre", "Depósito",
        "Trânsito e TE", "Controle qualidade", "Unid.medida básica", "Centro",
    ])
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def scenario() -> dict:
    return {
        "scenario_id": "scenario-1",
        "reference_month": "2026-07",
        "sources": [{"id": "stock", "filename": "STK JULHO.xlsx"}],
        "materials": [
            {"material": "MAT-NEG", "description": "Material crítico", "um": "UN", "balance": -10, "status": "INVESTIGAR"},
            {"material": "MAT-OK", "description": "Material sem restrição", "um": "UN", "balance": 8, "status": "OK"},
        ],
    }


def example_rows() -> list[list]:
    return [
        ["MAT-NEG", "Material crítico", 3, "M221", 0, 0, "UN", "1063"],
        ["MAT-NEG", "Material crítico", 2, "M221", 0, 0, "UN", "1063"],
        ["MAT-NEG", "Material crítico", 4, "P277", 0, 0, "UN", "1063"],
        ["MAT-NEG", "Material crítico", 30, "Q239", 0, 0, "UN", "1063"],
        ["MAT-OK", "Material sem restrição", 12, "M221", 0, 0, "UN", "1063"],
        ["MAT-NEG", "Material crítico", 8, "M221", 0, 0, "KG", "1063"],
    ]


def test_only_critical_materials_and_investigation_depots_are_considered():
    current = scenario()
    original = deepcopy(current)
    result = investigate_stock_divergence(
        stock_content=stock_bytes(example_rows()),
        stock_filename="STK JULHO.xlsx",
        scenario=current,
    )

    assert current == original
    assert result["changes_dpp"] is False
    assert result["requires_human_validation"] is True
    assert result["summary"]["critical_materials"] == 1
    assert result["summary"]["materials_with_candidates"] == 1
    assert result["summary"]["records_by_depot"] == {"M221": 4, "P277": 1, "G702": 0}
    assert result["summary"]["depots_without_records"] == ["G702"]
    assert result["summary"]["ignored_records"] == {"unidade_divergente": 1}
    item = result["materials"][0]
    assert item["material"] == "MAT-NEG"
    assert item["balance"] == -10
    assert item["candidate_quantity"] == 9
    assert [candidate["quantity"] for candidate in item["candidates"]] == [5, 4]
    assert item["candidates"][0]["source_rows"] == [2, 3]
    assert item["candidates"][0]["validation_status"] == "AGUARDANDO_PCM_ALMOXARIFADO"


def test_no_candidate_is_not_mistaken_for_recovered_stock():
    result = investigate_stock_divergence(
        stock_content=stock_bytes([["MAT-NEG", "Material", 12, "Q239", 0, 0, "UN", "1063"]]),
        stock_filename="STK JULHO.xlsx",
        scenario=scenario(),
    )
    assert result["materials"] == []
    assert result["summary"]["materials_without_candidates"] == 1


@pytest.mark.parametrize("filename", ["OUTRO STK.xlsx", "STK JULHO.csv"])
def test_rejects_unrelated_or_invalid_stock_files(filename):
    with pytest.raises(ValueError):
        investigate_stock_divergence(
            stock_content=stock_bytes(example_rows()),
            stock_filename=filename,
            scenario=scenario(),
        )


def test_identical_filename_but_different_snapshot_is_rejected():
    current = scenario()
    original_bytes = stock_bytes(example_rows())
    current["sources"][0]["fingerprint_sha256"] = sha256(original_bytes).hexdigest()

    valid = investigate_stock_divergence(
        stock_content=original_bytes,
        stock_filename="STK JULHO.xlsx",
        scenario=current,
    )
    assert valid["summary"]["materials_with_candidates"] == 1

    changed_bytes = stock_bytes(example_rows() + [["MAT-NEG", "Material crítico", 9, "G702", 0, 0, "UN", "1063"]])
    with pytest.raises(ValueError, match="conteúdo do STK difere"):
        investigate_stock_divergence(
            stock_content=changed_bytes,
            stock_filename="STK JULHO.xlsx",
            scenario=current,
        )


def test_missing_original_is_explicit_error_without_changing_scenario():
    with pytest.raises(ValueError, match="ORIGINAL"):
        investigate_stock_divergence(
            stock_content=stock_bytes([], original=False),
            stock_filename="STK JULHO.xlsx",
            scenario=scenario(),
        )


def test_endpoint_uses_registered_scenario_and_returns_source_rows(monkeypatch):
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: scenario() if key == "scenario-1" else None)
    with TestClient(app) as client:
        reply = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": "scenario-1"},
            files={"stock": ("STK JULHO.xlsx", stock_bytes(example_rows()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert reply.status_code == 200
        assert reply.json()["materials"][0]["candidates"][0]["source_rows"] == [2, 3]

        missing = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": "scenario-missing"},
            files={"stock": ("STK JULHO.xlsx", stock_bytes([]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert missing.status_code == 404
