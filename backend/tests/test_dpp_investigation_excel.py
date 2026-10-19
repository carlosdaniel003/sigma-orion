"""Readable investigation spreadsheet downloads: contents, traceability and safety."""
from io import BytesIO
from hashlib import sha256
from uuid import uuid4

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.api import routes
from app.main import app
from test_dpp_stock_divergence import MIME, stock_bytes


def scenario():
    return {
        "scenario_id": uuid4().hex,
        "reference_month": "2026-07",
        "sources": [
            {"id": "base_dpp", "filename": "DPP JUN_2026.06.02.xlsx"},
            {"id": "stock", "filename": "STK JULHO.xlsx"},
            {"id": "wiu", "filename": "WIU JULHO.xlsx"},
            {"id": "explosion", "filename": "Explosão JULHO.xlsm"},
            {"id": "pgd", "filename": "PGD BASE.xlsx"},
        ],
        "materials": [
            {"material": "PN-CQ", "description": "Componente em CQ", "um": "UN", "balance": -10, "status": "INVESTIGAR"},
            {"material": "PN-V", "description": "Material sem registro especial", "um": "UN", "balance": -4, "status": "INVESTIGAR"},
            {"material": "PN-OK", "description": "Material normal", "um": "UN", "balance": 100, "status": "OK"},
        ],
    }


def rows():
    return [
        ["PN-CQ", "Componente em CQ", 12, "M221", 0, 0, "UN", "1063"],
        ["PN-CQ", "Componente em CQ", 7, "Q239", 0, 0, "UN", "1063"],
        ["PN-CQ", "Componente em CQ", 3, "Q273", 0, 0, "UN", "1063"],
    ]


def upload(client, path, current, stock):
    return client.post(
        path,
        data={"scenario_id": current["scenario_id"]},
        files={"stock": ("STK JULHO.xlsx", stock, MIME)},
    )


def spreadsheet(response):
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"PK")
    assert "spreadsheetml.sheet" in response.headers["content-type"]
    assert "attachment;" in response.headers["content-disposition"]
    return load_workbook(BytesIO(response.content), data_only=False)


def test_stock_excel_includes_every_critical_pn_and_auditable_depots(monkeypatch):
    current = scenario()
    stock = stock_bytes(rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        book = spreadsheet(upload(
            client, "/api/dpp/investigations/stock-divergence/export", current, stock,
        ))
        assert book.sheetnames == [
            "Resumo", "PNs investigados", "Registros depósitos", "Histórico validações",
        ]
        info = [cell[1] for cell in book["Resumo"].iter_rows(min_row=5, values_only=True)]
        assert "DPP JUN_2026.06.02.xlsx" in info
        assert "STK JULHO.xlsx" in info
        # Final DPP is a validation reference only; no file is required to export.
        assert any("Somente comparação/validação" in str(value) for value in info)

        pn_rows = list(book["PNs investigados"].iter_rows(min_row=5, values_only=True))
        material_codes = {row[0] for row in pn_rows if row[0]}
        assert material_codes == {"PN-CQ", "PN-V"}
        missing = next(row for row in pn_rows if row[0] == "PN-V")
        assert missing[9] == 4
        assert missing[10] == "Encaminhar à Qualidade"

        details = list(book["Registros depósitos"].iter_rows(min_row=6, values_only=True))
        assert any(row[0] == "PN-CQ" and row[2] == "M221" and row[5] == 12
                   and "ORIGINAL: 2" in row[6] for row in details)
        assert all(row[2] not in {"Q239", "Q273"} for row in details if row[0])
        assert book["PNs investigados"].freeze_panes == "C5"
        assert book["Registros depósitos"].auto_filter.ref is not None
        book.close()


def test_quality_excel_contains_referrals_and_source_rows(monkeypatch):
    current = scenario()
    stock = stock_bytes(rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        book = spreadsheet(upload(
            client, "/api/dpp/investigations/quality/export", current, stock,
        ))
        assert book.sheetnames == [
            "Resumo", "PNs investigados", "Registros depósitos",
            "Q273 não investigado", "Histórico validações",
        ]
        items = list(book["PNs investigados"].iter_rows(min_row=6, values_only=True))
        by_pn = {row[0]: row for row in items if row[0]}
        # PN-CQ has pending stock review in 4.1; quality cannot precede it.
        assert "PN-CQ" not in by_pn
        assert "PN-V" in by_pn
        assert by_pn["PN-V"][12] == "Encaminhar a Scrap"
        assert "DPP JUN_2026.06.02.xlsx" in [
            row[1] for row in book["Resumo"].iter_rows(min_row=5, values_only=True)
        ]
        book.close()

        # Explain part of the stock shortage to hand off PN-CQ to quality.
        stock_report = upload(client, "/api/dpp/investigations/stock-divergence", current, stock).json()
        identifier = stock_report["materials"][0]["candidates"][0]["candidate_id"]
        save = client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"], "candidate_id": identifier,
                "decision": "UNAVAILABLE", "accounting": "UNKNOWN",
                "confirmed_quantity": "1", "evidence": "Uma unidade indisponível no M221.",
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert save.status_code == 200
        reply = upload(client, "/api/dpp/investigations/quality/export", current, stock)
        book = spreadsheet(reply)
        items = list(book["PNs investigados"].iter_rows(min_row=6, values_only=True))
        cq = next(row for row in items if row[0] == "PN-CQ")
        assert cq[3] == "Q239"
        assert cq[11] == 1  # A Q273 record is intentionally outside the active branch.
        nonactive = list(book["Q273 não investigado"].iter_rows(min_row=6, values_only=True))
        assert any(row[0] == "PN-CQ" and row[2] == "Q273"
                   and row[5] == 3 and "ORIGINAL: 4" in row[6] for row in nonactive)
        details = list(book["Registros depósitos"].iter_rows(min_row=6, values_only=True))
        assert any(row[0] == "PN-CQ" and row[2] == "Q239"
                   and row[5] == 7 and "ORIGINAL: 3" in row[6] for row in details)
        book.close()


def test_export_preserves_latest_justification_and_history(monkeypatch):
    current = scenario()
    stock = stock_bytes(rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        first = upload(client, "/api/dpp/investigations/stock-divergence", current, stock).json()
        identifier = first["materials"][0]["candidates"][0]["candidate_id"]
        for justification in ("Primeira validação do depósito M221.", "Revisão: lote permanece indisponível."):
            saved = client.post(
                "/api/dpp/investigations/stock-divergence/review",
                data={
                    "scenario_id": current["scenario_id"], "candidate_id": identifier,
                    "decision": "UNAVAILABLE", "accounting": "UNKNOWN",
                    "confirmed_quantity": "3", "evidence": justification,
                },
                files={"stock": ("STK JULHO.xlsx", stock, MIME)},
            )
            assert saved.status_code == 200
        book = spreadsheet(upload(
            client, "/api/dpp/investigations/stock-divergence/export", current, stock,
        ))
        details = list(book["Registros depósitos"].iter_rows(min_row=6, values_only=True))
        current_review = next(row for row in details if row[0] == "PN-CQ")
        assert current_review[12] == "Revisão: lote permanece indisponível."
        history = list(book["Histórico validações"].iter_rows(min_row=5, values_only=True))
        notes = [row[9] for row in history if row[0] == "PN-CQ"]
        assert notes == ["Primeira validação do depósito M221.", "Revisão: lote permanece indisponível."]
        book.close()


def test_export_rejects_wrong_snapshot_and_missing_scenario(monkeypatch):
    current = scenario()
    original = stock_bytes(rows())
    current["sources"][1]["fingerprint_sha256"] = sha256(original).hexdigest()
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        changed = stock_bytes(rows() + [["PN-V", "outro", 5, "M221", 0, 0, "UN", "1063"]])
        for path in (
            "/api/dpp/investigations/stock-divergence/export",
            "/api/dpp/investigations/quality/export",
        ):
            denied = upload(client, path, current, changed)
            assert denied.status_code == 400
            assert "STK" in denied.json()["detail"]

        missing = client.post(
            "/api/dpp/investigations/stock-divergence/export",
            data={"scenario_id": "not-a-scenario"},
            files={"stock": ("STK JULHO.xlsx", original, MIME)},
        )
        assert missing.status_code == 404


def test_export_escapes_untrusted_formula_like_justification(monkeypatch):
    current = scenario()
    stock = stock_bytes(rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    with TestClient(app) as client:
        report = upload(client, "/api/dpp/investigations/stock-divergence", current, stock).json()
        identifier = report["materials"][0]["candidates"][0]["candidate_id"]
        saved = client.post(
            "/api/dpp/investigations/stock-divergence/review",
            data={
                "scenario_id": current["scenario_id"], "candidate_id": identifier,
                "decision": "UNAVAILABLE", "accounting": "UNKNOWN",
                "confirmed_quantity": "2", "evidence": "=HYPERLINK(\"http://example.invalid\", \"unsafe\")",
            },
            files={"stock": ("STK JULHO.xlsx", stock, MIME)},
        )
        assert saved.status_code == 200
        book = spreadsheet(upload(client, "/api/dpp/investigations/stock-divergence/export", current, stock))
        values = list(book["Registros depósitos"].iter_rows(min_row=6))
        row = next(row for row in values if row[0].value == "PN-CQ")
        assert row[12].data_type != "f"
        assert row[12].value.startswith("'=")
        book.close()



def test_generated_excel_and_visible_next_steps_have_no_stage_numbering(monkeypatch):
    """Output labels must be operational, not internal codes or drawing references."""
    import re

    current = scenario()
    stock = stock_bytes(rows())
    monkeypatch.setattr(routes, "get_monthly_scenario",
                        lambda key: current if key == current["scenario_id"] else None)

    forbidden = re.compile(r"fluxograma|\b4\.[123]\b|QUALITY_4_2|SCRAP_4_3", re.IGNORECASE)
    with TestClient(app) as client:
        for route in (
            "/api/dpp/investigations/stock-divergence/export",
            "/api/dpp/investigations/quality/export",
        ):
            book = spreadsheet(upload(client, route, current, stock))
            try:
                for sheet in book.worksheets:
                    for line in sheet.iter_rows(values_only=True):
                        for value in line:
                            if isinstance(value, str):
                                assert not forbidden.search(value), (
                                    f"{sheet.title}: unexpected technical process reference: {value!r}"
                                )
            finally:
                book.close()

        stock_report = upload(
            client, "/api/dpp/investigations/stock-divergence", current, stock,
        ).json()
        quality_report = upload(
            client, "/api/dpp/investigations/quality", current, stock,
        ).json()
        for item in stock_report["workflow"]["forward_to_quality"]:
            assert not forbidden.search(item["next_step"])
        for item in quality_report["materials"]:
            assert not forbidden.search(item["next_step"])
        assert stock_report["summary"]["items_to_quality"] >= 1
        assert quality_report["summary"]["items_to_scrap"] >= 1
