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

MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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
    assert result["summary"]["records_by_depot"] == {"M221": 4, "P277": 1}
    assert result["summary"]["depots_without_records"] == []
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

    changed_bytes = stock_bytes(example_rows() + [["MAT-NEG", "Material crítico", 9, "X999", 0, 0, "UN", "1063"]])
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


def test_pcm_review_persists_and_only_excluded_available_stock_projects_gap(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    original = deepcopy(current)
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    def request(client):
        return client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )

    def validate(client, identifier, **values):
        data = {
            "scenario_id": current["scenario_id"],
            "candidate_id": identifier,
            "decision": "AVAILABLE",
            "accounting": "NOT_INCLUDED",
            "confirmed_quantity": "3",
            "pcm": "PCM Teste",
            "warehouse": "Almox Teste",
            "evidence": "Material localizado e conferido pelo Almoxarifado.",
            **values,
        }
        return client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data=data,
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )

    with TestClient(app) as client:
        baseline = request(client)
        assert baseline.status_code == 200
        material = baseline.json()["materials"][0]
        assert material["negative_balance"] == 10
        first, second = material["candidates"]
        assert first["candidate_id"]
        assert not first["validation"]
        assert material["projected_gap_remaining"] == 10

        confirmed = validate(client, first["candidate_id"])
        assert confirmed.status_code == 200
        item = confirmed.json()["materials"][0]
        assert item["confirmed_increment_outside_dpp"] == 3
        assert item["projected_gap_remaining"] == 7
        assert item["candidates"][0]["validation"]["pcm"] == "PCM Teste"
        assert len(item["candidates"][0]["validation_history"]) == 1
        assert confirmed.json()["changes_dpp"] is False
        assert current == original

        repeated = validate(client, first["candidate_id"])
        assert repeated.status_code == 200
        assert len(repeated.json()["materials"][0]["candidates"][0]["validation_history"]) == 1

        already_counted = validate(client, second["candidate_id"], accounting="INCLUDED", confirmed_quantity="4")
        assert already_counted.status_code == 200
        assert already_counted.json()["materials"][0]["projected_gap_remaining"] == 7

        unknown = validate(client, second["candidate_id"], accounting="UNKNOWN", confirmed_quantity="4")
        assert unknown.status_code == 200
        assert unknown.json()["materials"][0]["projected_gap_remaining"] == 7

        corrected = validate(client, first["candidate_id"], decision="UNAVAILABLE",
                             accounting="UNKNOWN", confirmed_quantity="0",
                             evidence="O estoque foi localizado mas a baixa foi confirmada.")
        assert corrected.status_code == 200
        assert corrected.json()["materials"][0]["projected_gap_remaining"] == 10
        assert len(corrected.json()["materials"][0]["candidates"][0]["validation_history"]) == 2

        # Stored decisions remain visible after a fresh query/reload.
        reloaded = request(client)
        assert reloaded.status_code == 200
        assert reloaded.json()["summary"]["candidates_reviewed"] == 2
        assert reloaded.json()["materials"][0]["projected_gap_remaining"] == 10
        assert current == original


def test_pcm_review_rejects_invalid_and_foreign_candidates(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    def validate(client, identifier, **values):
        data = {
            "scenario_id": current["scenario_id"], "candidate_id": identifier,
            "decision": "AVAILABLE", "accounting": "NOT_INCLUDED",
            "confirmed_quantity": "3", "pcm": "PCM Teste", "warehouse": "Almox Teste",
            "evidence": "Conferido presencialmente com o Almoxarifado.",
            **values,
        }
        return client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data=data, files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )

    with TestClient(app) as client:
        initial = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        identifier = initial.json()["materials"][0]["candidates"][0]["candidate_id"]
        assert validate(client, "invalid_candidate").status_code == 400
        assert validate(client, identifier, confirmed_quantity="5.01").status_code == 400
        assert validate(client, identifier, confirmed_quantity="nan").status_code in (400, 422)
        assert validate(client, identifier, evidence="x" * 4001).status_code == 400
        assert validate(client, identifier, accounting="INVALID").status_code == 400
        assert validate(client, identifier, decision="UNAVAILABLE",
                        accounting="NOT_INCLUDED", confirmed_quantity="1").status_code == 400

        report = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        ).json()
        assert report["summary"]["candidates_reviewed"] == 0


def test_review_accepts_only_operational_fields_without_identity_or_evidence(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        result = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert result.status_code == 200
        identifier = result.json()["materials"][0]["candidates"][0]["candidate_id"]

        review = client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"],
                "candidate_id": identifier,
                "decision": "AVAILABLE",
                "accounting": "NOT_INCLUDED",
                "confirmed_quantity": "3",
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert review.status_code == 200
        material = review.json()["materials"][0]
        assert material["projected_gap_remaining"] == 7
        recorded = material["candidates"][0]["validation"]
        assert recorded["pcm"] == ""
        assert recorded["warehouse"] == ""
        assert recorded["evidence"] == ""
        assert review.json()["changes_dpp"] is False


def test_review_can_save_justification_without_pcm_or_warehouse(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        initial = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert initial.status_code == 200
        identifier = initial.json()["materials"][0]["candidates"][0]["candidate_id"]
        saved = client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"],
                "candidate_id": identifier,
                "decision": "AVAILABLE",
                "accounting": "UNKNOWN",
                "confirmed_quantity": "3",
                "evidence": "Divergência sistema/SAP a confirmar no P000.",
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert saved.status_code == 200
        review = saved.json()["materials"][0]["candidates"][0]["validation"]
        assert review["evidence"] == "Divergência sistema/SAP a confirmar no P000."
        assert review["pcm"] == ""
        assert review["warehouse"] == ""
        assert saved.json()["materials"][0]["projected_gap_remaining"] == 10

        reread = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert reread.status_code == 200
        assert reread.json()["materials"][0]["candidates"][0]["validation"]["evidence"] == "Divergência sistema/SAP a confirmar no P000."


def test_41_without_depot_records_is_forwarded_to_quality_without_starting_42(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    stock = stock_bytes([["MAT-NEG", "Sem saldo em depósito", 3, "Q239", 0, 0, "UN", "1063"]])
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        reply = client.post("/api/dpp/investigations/stock-divergence",
                            data={"scenario_id": current["scenario_id"]},
                            files={"stock": ("STK JULHO.xlsx", stock, MIME)})
        assert reply.status_code == 200
        data = reply.json()
        assert data["materials"] == []
        assert data["summary"]["items_to_quality"] == 1
        assert data["summary"]["items_finished"] == 0
        assert data["workflow"]["quality_analysis_implemented"] is False
        referral = data["workflow"]["forward_to_quality"][0]
        assert referral["material"] == "MAT-NEG"
        assert referral["initial_deficit"] == 10
        assert referral["unexplained_quantity"] == 10
        assert "Sem registros" in referral["next_step"]


def test_41_available_and_unavailable_explanations_finish_without_stock_double_count(monkeypatch):
    from uuid import uuid4
    current = scenario()
    current["scenario_id"] = uuid4().hex
    current["materials"][0]["balance"] = -8
    original = deepcopy(current)
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    def investigate(client):
        return client.post("/api/dpp/investigations/stock-divergence",
                           data={"scenario_id": current["scenario_id"]},
                           files={"stock": ("STK JULHO.xlsx", stock, MIME)})

    def save(client, identifier, decision, accounting, quantity, evidence):
        return client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"],
                "candidate_id": identifier,
                "decision": decision, "accounting": accounting,
                "confirmed_quantity": str(quantity), "evidence": evidence,
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )

    with TestClient(app) as client:
        report = investigate(client)
        assert report.status_code == 200
        initial = report.json()
        assert initial["summary"]["items_awaiting_validation"] == 1
        assert initial["summary"]["items_to_quality"] == 0
        material = initial["materials"][0]
        first, second = (c["candidate_id"] for c in material["candidates"])

        # A partial recovery triggers a provisional Quality referral.
        partly = save(client, first, "AVAILABLE", "NOT_INCLUDED", 5, "")
        assert partly.status_code == 200
        partial = partly.json()
        line = partial["materials"][0]
        assert line["confirmed_increment_outside_dpp"] == 5
        assert line["projected_gap_remaining"] == 3
        assert line["unexplained_quantity"] == 3
        assert line["workflow_status"] == "QUALITY_4_2"
        assert partial["summary"]["items_to_quality"] == 1
        assert partial["workflow"]["forward_to_quality"][0]["pending_reviews"] == 1

        # A justified unavailable amount explains, but does not make stock available.
        completed = save(client, second, "UNAVAILABLE", "UNKNOWN", 3,
                         "Três peças confirmadas como indisponíveis para o plano.")
        assert completed.status_code == 200
        result = completed.json()
        line = result["materials"][0]
        assert line["confirmed_increment_outside_dpp"] == 5
        assert line["justified_unavailable_quantity"] == 3
        assert line["projected_gap_remaining"] == 3
        assert line["unexplained_quantity"] == 0
        assert line["workflow_status"] == "FINISHED"
        assert result["summary"]["items_finished"] == 1
        assert result["summary"]["items_to_quality"] == 0
        assert result["workflow"]["finished"][0]["remaining_gap_after_recovery"] == 3
        assert result["changes_dpp"] is False
        assert current == original

        # Repeating an identical review leaves audit history unchanged.
        duplicate = save(client, second, "UNAVAILABLE", "UNKNOWN", 3,
                         "Três peças confirmadas como indisponíveis para o plano.")
        assert duplicate.status_code == 200
        assert len(duplicate.json()["materials"][0]["candidates"][1]["validation_history"]) == 1

        # A correction reopens the incomplete cause; old versions remain auditable.
        correction = save(client, second, "UNAVAILABLE", "UNKNOWN", 0,
                          "O apontamento foi retificado: quantidade sem confirmação.")
        assert correction.status_code == 200
        result = correction.json()
        assert result["materials"][0]["unexplained_quantity"] == 3
        assert result["materials"][0]["workflow_status"] == "QUALITY_4_2"
        assert len(result["materials"][0]["candidates"][1]["validation_history"]) == 2

        persisted = investigate(client)
        assert persisted.status_code == 200
        assert persisted.json()["summary"]["items_to_quality"] == 1
        assert current == original


def test_41_unavailable_amount_requires_explanation_and_cannot_exceed_depot(monkeypatch):
    from uuid import uuid4

    current = scenario()
    current["scenario_id"] = uuid4().hex
    stock = stock_bytes(example_rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        initial = client.post(
            "/api/dpp/investigations/stock-divergence",
            data={"scenario_id": current["scenario_id"]},
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        ).json()
        identifier = initial["materials"][0]["candidates"][0]["candidate_id"]

        def save(quantity, evidence):
            return client.post(
                "/api/dpp/investigations/stock-divergence/review",
                data={
                    "scenario_id": current["scenario_id"],
                    "candidate_id": identifier,
                    "decision": "UNAVAILABLE",
                    "accounting": "UNKNOWN",
                    "confirmed_quantity": str(quantity),
                    "evidence": evidence,
                },
                files={"stock": ("STK JULHO.xlsx", stock, MIME)},
            )

        assert save(2, "").status_code == 400
        assert save(6, "Peças não estão disponíveis na contagem física.").status_code == 400
        assert save(2, "Quantidade não localizada após verificação.").status_code == 200

        latest = client.post("/api/dpp/investigations/stock-divergence",
                             data={"scenario_id": current["scenario_id"]},
                             files={"stock": ("STK JULHO.xlsx", stock, MIME)}).json()
        line = latest["materials"][0]
        assert line["justified_unavailable_quantity"] == 2
        assert line["projected_gap_remaining"] == 10
        assert line["unexplained_quantity"] == 8


def test_unconfigured_depots_do_not_enter_stock_investigation_or_quality_referrals():
    """Depósitos não autorizados não podem modificar a etapa 4.1."""
    source = example_rows()
    extended = source + [
        ["MAT-NEG", "Material crítico", 900, "X999", 0, 0, "UN", "1063"],
        ["MAT-NEG", "Material crítico", 900, "P000", 0, 0, "UN", "1063"],
    ]
    current = scenario()
    base = investigate_stock_divergence(
        stock_content=stock_bytes(source), stock_filename="STK JULHO.xlsx", scenario=current,
    )
    ignored = investigate_stock_divergence(
        stock_content=stock_bytes(extended), stock_filename="STK JULHO.xlsx", scenario=current,
    )
    assert ignored == base
    assert set(ignored["summary"]["records_by_depot"]) == {"M221", "P277"}
    assert {item["depot"] for item in ignored["materials"][0]["candidates"]} == {"M221", "P277"}
    assert ignored["materials"][0]["candidate_quantity"] == 9
