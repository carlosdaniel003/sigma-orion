"""Monthly DPP gap projection from Stock and CQ only: domain and HTTP checks."""
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from app.services.dpp_monthly_gap_service import build_monthly_gap_projection
from test_dpp_stock_divergence import MIME, stock_bytes


def _scenario():
    return {
        "scenario_id": uuid4().hex,
        "reference_month": "2026-07",
        "sources": [{"id": "stock", "filename": "STK JULHO.xlsx"}],
        "materials": [
            {"material": "PN-A", "description": "Encontrado", "um": "UN", "balance": -10, "status": "INVESTIGAR"},
            {"material": "PN-B", "description": "Sem registros", "um": "UN", "balance": -4, "status": "INVESTIGAR"},
            {"material": "PN-C", "description": "Sem falta", "um": "UN", "balance": 100, "status": "OK"},
            {"material": "PN-D", "description": "Outra unidade", "um": "CM", "balance": -6, "status": "FORA_ESCOPO_UM"},
        ],
    }


def _stock_report(scenario):
    return {
        "scenario_id": scenario["scenario_id"],
        "summary": {"materials_with_candidates": 1},
        "materials": [{
            "material": "PN-A",
            "candidate_quantity": 8,
            "recovered_quantity_applied": 5,
            "justified_unavailable_applied": 2,
            "candidates": [{"validation": {"decision": "AVAILABLE"}}, {"validation": None}],
            "workflow_status": "QUALITY_4_2",
        }],
        "unmatched_materials": [{"material": "PN-B"}],
    }


def _quality_report(scenario):
    return {
        "scenario_id": scenario["scenario_id"],
        "summary": {"materials_with_q239": 1, "materials_with_q273": 0},
        "materials": [{
            "material": "PN-A",
            "quality_released_applied": 2,
            "quality_rejected_applied": 1,
            "quality_scrap_applied": 0,
            "candidates": [{"depot": "Q239", "quantity": 5, "validation": {"decision": "RELEASED"}}],
            "workflow_status": "FINISHED",
        }],
    }


def test_entire_month_is_consolidated_without_changing_official_balance():
    scenario = _scenario()
    before = [dict(m) for m in scenario["materials"]]
    projection = build_monthly_gap_projection(
        scenario=scenario, stock_report=_stock_report(scenario),
        cq_report=_quality_report(scenario),
    )
    assert projection["summary"]["materials_total"] == 4
    assert projection["summary"]["critical_materials"] == 2
    assert projection["summary"]["negative_outside_scope"] == 1
    assert projection["summary"]["critical_materials_with_pending_validations"] == 1
    assert projection["changes_official_saldo"] is False
    assert projection["changes_dpp_export"] is False
    assert len(projection["materials"]) == len(scenario["materials"])
    assert scenario["materials"] == before

    a, b, c, d = projection["materials"]
    assert a["original_balance"] == -10
    assert a["projected_balance"] == -3
    assert a["initial_gap"] == 10
    assert a["recovered_stock"] == 5
    assert a["justified_stock"] == 2
    assert a["physical_gap_after_stock"] == 5
    assert a["unexplained_after_stock"] == 3
    assert a["recovered_cq"] == 2
    assert a["justified_cq_rejection"] == 1
    assert a["physical_gap_after_quality"] == 3
    assert a["unexplained_after_quality"] == 0
    assert a["provisional"] is True
    assert (b["initial_gap"], b["unexplained_after_quality"]) == (4, 4)
    assert c["initial_gap"] == 0
    assert c["projected_balance"] == 100
    assert d["initial_gap"] == 6
    assert d["investigation_scope"] == "FORA_ESCOPO"
    assert d["recovered_stock"] == d["recovered_cq"] == 0
    units = {x["unit"]: x for x in projection["summary"]["units"]}
    assert units["UN"]["initial_gap"] == 14
    assert units["UN"]["physical_gap_after_quality"] == 7
    assert units["UN"]["unexplained_after_quality"] == 4
    assert units["CM"]["initial_gap"] == 6
    assert units["CM"]["physical_gap_after_quality"] == 6


def test_confirmation_excess_and_explanations_never_create_inventory_or_double_count():
    scenario = _scenario()
    sr = _stock_report(scenario)
    qr = _quality_report(scenario)
    sr["materials"][0]["recovered_quantity_applied"] = 100
    sr["materials"][0]["justified_unavailable_applied"] = 100
    qr["materials"][0]["quality_released_applied"] = 100
    qr["materials"][0]["quality_rejected_applied"] = 100
    row = build_monthly_gap_projection(scenario=scenario, stock_report=sr, cq_report=qr)["materials"][0]
    assert row["recovered_stock"] == 10
    assert row["justified_stock"] == 0
    assert row["recovered_cq"] == 0
    assert row["physical_gap_after_quality"] == 0
    assert row["unexplained_after_quality"] == 0
    assert row["projected_balance"] == 0


def test_reports_from_another_scenario_are_rejected():
    scenario = _scenario()
    qr = _quality_report(scenario)
    qr["scenario_id"] = "another-scenario"
    with pytest.raises(ValueError, match="contextos diferentes"):
        build_monthly_gap_projection(scenario=scenario, stock_report=_stock_report(scenario), cq_report=qr)


def _stock_file():
    headers = ["Material", "Texto breve material", "Utilização livre", "Depósito",
               "Em transferência", "Em controle qualidade", "Unid.medida básica", "Centro"]
    # stock_bytes fixture generates a suitable ORIGINAL sheet and headers
    return stock_bytes([
        ["PN-A", "Encontrado", 6, "M221", 0, 0, "UN", "1063"],
        ["PN-A", "Encontrado", 5, "Q239", 0, 0, "UN", "1063"],
    ])


def _post(client, url, scenario, content, more=None):
    return client.post(url, data={"scenario_id": scenario["scenario_id"], **(more or {})},
                       files={"stock": ("STK JULHO.xlsx", BytesIO(content), MIME)})


def test_api_recalculates_from_persisted_reviews_not_from_client_numbers(monkeypatch):
    scenario = _scenario()
    stock = _stock_file()
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda value: scenario if value == scenario["scenario_id"] else None)

    with TestClient(app) as client:
        initial = _post(client, "/api/dpp/monthly/gap/recalculate", scenario, stock)
        assert initial.status_code == 200, initial.text
        initial_row = initial.json()["materials"][0]
        assert initial_row["recovered_stock"] == 0
        assert initial_row["physical_gap_after_quality"] == 10

        candidates = _post(client, "/api/dpp/investigations/stock-divergence", scenario, stock).json()
        identifier = candidates["materials"][0]["candidates"][0]["candidate_id"]
        saved = _post(client, "/api/dpp/investigations/stock-divergence/review", scenario, stock, {
            "candidate_id": identifier, "decision": "AVAILABLE", "accounting": "NOT_INCLUDED",
            "confirmed_quantity": "4",
        })
        assert saved.status_code == 200, saved.text

        after_stock = _post(client, "/api/dpp/monthly/gap/recalculate", scenario, stock)
        assert after_stock.status_code == 200, after_stock.text
        row = after_stock.json()["materials"][0]
        assert row["recovered_stock"] == 4
        assert row["physical_gap_after_stock"] == 6
        assert row["physical_gap_after_quality"] == 6

        q = _post(client, "/api/dpp/investigations/quality", scenario, stock)
        assert q.status_code == 200, q.text
        q_id = q.json()["materials"][0]["candidates"][0]["candidate_id"]
        reviewed = _post(client, "/api/dpp/investigations/quality/review", scenario, stock, {
            "candidate_id": q_id, "decision": "RELEASED",
            "accounting": "NOT_INCLUDED", "confirmed_quantity": "2",
        })
        assert reviewed.status_code == 200, reviewed.text
        final = _post(client, "/api/dpp/monthly/gap/recalculate", scenario, stock)
        assert final.status_code == 200, final.text
        data = final.json()
        assert data["materials"][0]["recovered_stock"] == 4
        assert data["materials"][0]["recovered_cq"] == 2
        assert data["materials"][0]["physical_gap_after_quality"] == 4
        assert data["materials"][1]["unexplained_after_quality"] == 4
        assert data["materials"][2]["projected_balance"] == 100
        assert data["materials"][3]["initial_gap"] == 6

        # Request with another name cannot silently switch the source.
        bad = client.post("/api/dpp/monthly/gap/recalculate",
                          data={"scenario_id": scenario["scenario_id"]},
                          files={"stock": ("OUTRO_STK.xlsx", BytesIO(stock), MIME)})
        assert bad.status_code == 400
