"""End-to-end quality (4.2) guards: routing, CQ decisions and no stock double count."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api import routes
from app.main import app
from test_dpp_stock_divergence import stock_bytes, MIME


def make_scenario(materials):
    return {
        "scenario_id": uuid4().hex,
        "reference_month": "2026-07",
        "sources": [{"id": "stock", "filename": "STK JULHO.xlsx"}],
        "materials": [
            {
                "material": pn,
                "description": "Material " + pn,
                "um": "UN",
                "balance": balance,
                "status": "INVESTIGAR",
            }
            for pn, balance in materials
        ],
    }


def dep_row(pn, quantity, depot, center="1063"):
    return [pn, "Material " + pn, quantity, depot, 0, 0, "UN", center]


def quality(client, current, stock):
    return client.post(
        "/api/dpp/investigations/quality",
        data={"scenario_id": current["scenario_id"]},
        files={"stock": ("STK JULHO.xlsx", stock, MIME)},
    )


def review(client, current, stock, identifier, decision, quantity, accounting="UNKNOWN", justification=""):
    return client.post(
        "/api/dpp/investigations/quality/review",
        data={
            "scenario_id": current["scenario_id"],
            "candidate_id": identifier,
            "decision": decision,
            "confirmed_quantity": str(quantity),
            "accounting": accounting,
            "justification": justification,
        },
        files={"stock": ("STK JULHO.xlsx", stock, MIME)},
    )


def test_quality_reads_q239_first_then_q273_and_routes_absence_to_scrap(monkeypatch):
    current = make_scenario([("MAT-CQ", -10), ("MAT-REFUGO", -5), ("MAT-EMPTY", -3)])
    stock = stock_bytes([
        dep_row("MAT-CQ", 7, "Q239"),
        dep_row("MAT-CQ", 6, "Q273"),
        dep_row("MAT-REFUGO", 5, "Q273"),
        dep_row("MAT-EMPTY", 3, "P000"),
    ])
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        response = quality(client, current, stock)
        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["items_received_from_41"] == 3
        assert data["summary"]["materials_with_q239"] == 1
        assert data["summary"]["materials_with_q273"] == 1
        assert data["summary"]["materials_without_quality_records"] == 1
        assert data["summary"]["items_awaiting_quality"] == 2
        assert data["summary"]["items_to_scrap"] == 1
        assert data["workflow"]["scrap_analysis_implemented"] is False
        assert data["changes_dpp"] is False
        items = {m["material"]: m for m in data["materials"]}
        cq = items["MAT-CQ"]
        assert cq["active_depot"] == "Q239"
        assert cq["q273_records_skipped_due_q239"] == 1
        assert [candidate["depot"] for candidate in cq["candidates"]] == ["Q239"]
        assert cq["candidates"][0]["source_rows"] == [2]
        assert items["MAT-REFUGO"]["active_depot"] == "Q273"
        assert items["MAT-EMPTY"]["workflow_status"] == "SCRAP_4_3"
        assert items["MAT-EMPTY"]["unexplained_after_quality"] == 3
        assert all(m["quality_released"] == 0 for m in items.values())


def test_cq_release_and_rejection_explain_without_inventing_stock(monkeypatch):
    current = make_scenario([("MAT-CQ", -10)])
    baseline = deepcopy(current)
    stock = stock_bytes([
        dep_row("MAT-CQ", 7, "Q239", "1063"),
        dep_row("MAT-CQ", 4, "Q239", "1064"),
    ])
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        initial = quality(client, current, stock)
        assert initial.status_code == 200
        first, second = [candidate["candidate_id"] for candidate in initial.json()["materials"][0]["candidates"]]

        unknown = review(client, current, stock, first, "RELEASED", 7)
        assert unknown.status_code == 200
        item = unknown.json()["materials"][0]
        assert item["quality_released"] == 0
        assert item["unexplained_after_quality"] == 10

        released = review(client, current, stock, first, "RELEASED", 7, "NOT_INCLUDED")
        assert released.status_code == 200
        item = released.json()["materials"][0]
        assert item["quality_released"] == 7
        assert item["physical_gap_after_quality"] == 3
        assert item["unexplained_after_quality"] == 3
        assert released.json()["summary"]["items_to_scrap"] == 1

        missing_justification = review(client, current, stock, second, "REJECTED", 3)
        assert missing_justification.status_code == 400
        rejected = review(client, current, stock, second, "REJECTED", 3,
                          justification="CQ confirmou a reprovação de três unidades.")
        assert rejected.status_code == 200
        item = rejected.json()["materials"][0]
        assert item["quality_rejected_justified"] == 3
        assert item["physical_gap_after_quality"] == 3
        assert item["unexplained_after_quality"] == 0
        assert item["workflow_status"] == "FINISHED"
        assert rejected.json()["summary"]["items_finished"] == 1
        assert rejected.json()["changes_dpp"] is False
        assert current == baseline

        repeat = review(client, current, stock, second, "REJECTED", 3,
                        justification="CQ confirmou a reprovação de três unidades.")
        assert repeat.status_code == 200
        assert len(repeat.json()["materials"][0]["candidates"][1]["validation_history"]) == 1

        corrected = review(client, current, stock, first, "RELEASED", 7, "INCLUDED")
        assert corrected.status_code == 200
        item = corrected.json()["materials"][0]
        assert item["quality_released"] == 0
        assert item["unexplained_after_quality"] == 7
        assert item["workflow_status"] == "SCRAP_4_3"
        assert len(item["candidates"][0]["validation_history"]) == 3

        persisted = quality(client, current, stock)
        assert persisted.status_code == 200
        assert persisted.json()["materials"][0]["unexplained_after_quality"] == 7
        assert current == baseline


def test_q273_scrap_justifies_cause_without_releasing_stock(monkeypatch):
    current = make_scenario([("MAT-REF", -5)])
    stock = stock_bytes([dep_row("MAT-REF", 8, "Q273")])
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        initial = quality(client, current, stock).json()
        identifier = initial["materials"][0]["candidates"][0]["candidate_id"]
        assert review(client, current, stock, identifier, "RELEASED", 5, "NOT_INCLUDED").status_code == 400
        assert review(client, current, stock, identifier, "SCRAP_CONFIRMED", 5).status_code == 400
        saved = review(client, current, stock, identifier, "SCRAP_CONFIRMED", 5,
                       justification="CQ confirmou refugo de cinco unidades.")
        assert saved.status_code == 200
        material = saved.json()["materials"][0]
        assert material["quality_scrap_justified"] == 5
        assert material["quality_released"] == 0
        assert material["physical_gap_after_quality"] == 5
        assert material["unexplained_after_quality"] == 0
        assert material["workflow_status"] == "FINISHED"


def test_quality_is_restricted_to_current_41_referrals_and_current_snapshot(monkeypatch):
    current = make_scenario([("MAT-EST", -6)])
    stock = stock_bytes([
        dep_row("MAT-EST", 6, "M221"),
        dep_row("MAT-EST", 8, "Q239"),
    ])
    current["sources"][0]["fingerprint_sha256"] = sha256(stock).hexdigest()
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        before = quality(client, current, stock)
        assert before.status_code == 200
        assert before.json()["summary"]["items_received_from_41"] == 0
        assert before.json()["materials"] == []

        stock_stage = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        identifier = stock_stage.json()["materials"][0]["candidates"][0]["candidate_id"]
        # A human confirms partial unavailability in 4.1, generating a 4.2 referral.
        v41 = client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"],
                "candidate_id": identifier,
                "decision": "UNAVAILABLE",
                "accounting": "UNKNOWN",
                "confirmed_quantity": "2",
                "evidence": "Almoxarifado confirmou duas unidades indisponíveis.",
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert v41.status_code == 200
        assert v41.json()["summary"]["items_to_quality"] == 1
        after = quality(client, current, stock)
        assert after.status_code == 200
        item = after.json()["materials"][0]
        assert item["gap_from_41"] == 4
        assert item["physical_gap_from_41"] == 6
        assert item["active_depot"] == "Q239"

        qid = item["candidates"][0]["candidate_id"]
        covered = review(client, current, stock, qid, "RELEASED", 4, "NOT_INCLUDED")
        assert covered.status_code == 200
        item = covered.json()["materials"][0]
        assert item["unexplained_after_quality"] == 0
        assert item["physical_gap_after_quality"] == 2
        assert item["workflow_status"] == "FINISHED"

        wrong_snapshot = stock_bytes([dep_row("MAT-EST", 8, "Q239")])
        blocked = client.post(
            "/api/dpp/investigations/quality",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", wrong_snapshot, MIME)},
        )
        assert blocked.status_code == 400
        assert "STK" in blocked.json()["detail"]


def test_quality_review_cannot_forge_candidate_or_quantity(monkeypatch):
    current = make_scenario([("MAT-CQ", -10)])
    stock = stock_bytes([dep_row("MAT-CQ", 4, "Q239")])
    monkeypatch.setattr(routes, "get_monthly_scenario", lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        initial = quality(client, current, stock).json()
        candidate_id = initial["materials"][0]["candidates"][0]["candidate_id"]
        assert review(client, current, stock, "invalid", "RELEASED", 1, "NOT_INCLUDED").status_code == 400
        assert review(client, current, stock, candidate_id, "RELEASED", 4.01, "NOT_INCLUDED").status_code == 400
        assert review(client, current, stock, candidate_id, "RELEASED", "nan", "NOT_INCLUDED").status_code in (400, 422)
        assert review(client, current, stock, candidate_id, "REJECTED", 2, "INCLUDED",
                      "Duas unidades reprovadas.").status_code == 400
        assert review(client, current, stock, candidate_id, "SCRAP_CONFIRMED", 2,
                      justification="Decisão indevida em Q239.").status_code == 400
        assert quality(client, current, stock).json()["summary"]["candidates_reviewed"] == 0
