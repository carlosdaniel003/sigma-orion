from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import knowledge_catalog_service as catalog
from app.services.rag_runtime_service import load_chat_context


def _material(pn: str, balance: float, um: str = "UN") -> dict:
    return {
        "material": pn, "description": f"Peça {pn}", "um": um,
        "nec": 200, "stock_total": 200 + balance,
        "balance": balance,
        "status": "INVESTIGAR" if um == "UN" and balance < -0.0001 else "FORA_ESCOPO_UM" if um != "UN" else "OK",
    }


def _workspace(scenario_id: str = "chain-month-A") -> dict:
    pns = [
        _material("MAT-A", -30),
        _material("MAT-B", -100),
        _material("MAT-C", -60),
        _material("MAT-D", -5),
        _material("MAT-E", -100000, "G"),
        _material("MAT-F", 15),
    ]
    return {
        "month": "2026-07",
        "scenario": {
            "scenario_id": scenario_id,
            "reference_month": "2026-07",
            "summary": {"materials": len(pns), "materials_to_investigate": 4},
            "materials": pns,
        },
        "investigations": {
            "stock": {
                "scenario_id": scenario_id, "reference_month": "2026-07",
                "summary": {"critical_materials": 4},
                "materials": [{
                    "material": "MAT-C", "description": "Peça MAT-C", "unit": "UN",
                    "negative_balance": 60, "unexplained_quantity": 57,
                    "recovered_quantity_applied": 3, "workflow_status": "QUALITY_4_2",
                    "candidates": [{
                        "depot": "M221", "center": "0001", "quantity": 100,
                        "validation": None, "source_rows": [4],
                    }],
                }],
            },
            "quality": {
                "scenario_id": scenario_id, "reference_month": "2026-07",
                "summary": {"items_received_from_41": 4},
                "materials": [{
                    "material": "MAT-C", "description": "Peça MAT-C", "unit": "UN",
                    "active_depot": "Q239", "gap_from_41": 57,
                    "quality_released_applied": 0, "unexplained_after_quality": 57,
                    "q273_records_skipped_due_q239": 1,
                    "workflow_status": "AWAITING_QUALITY",
                    "candidates": [{
                        "depot": "Q239", "center": "0001", "quantity": 200,
                        "validation": None, "source_rows": [10],
                    }],
                }],
            },
        },
    }


@pytest.fixture(autouse=True)
def isolated_catalog(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    monkeypatch.setattr(catalog, "_LAST_FINGERPRINT", None)


def _sync(client: TestClient, scenario_id: str = "chain-month-A") -> None:
    response = client.post("/api/knowledge/workspace/sync", json=_workspace(scenario_id))
    assert response.status_code == 200, response.text


def _ask(client: TestClient, text: str, session: str = "chain-session") -> dict:
    response = client.post("/api/knowledge/chat", json={"question": text, "session_id": session})
    assert response.status_code == 200, response.text
    return response.json()


def test_full_investigation_sequence_preserves_selection_and_provenance():
    with TestClient(app) as client:
        _sync(client)
        critical = _ask(client, "Quais materiais estão críticos?")
        assert critical["table"]["total_rows"] == 4

        count = _ask(client, "Explique essa contagem")
        assert "4 PN(s)" in count["answer"]
        for code in ["REGRA-001", "REGRA-002", "REGRA-003", "REGRA-004"]:
            assert code in count["answer"]
        assert count["model"] == "deterministic-critical-investigation-chain"
        assert count["llm_used"] is False

        ranking = _ask(client, "Mostre os 3 maiores déficits")
        assert ranking["model"] == "deterministic-critical-investigation-chain"
        assert ranking["table"]["total_rows"] == 3
        assert [row["material"] for row in ranking["table"]["rows"]] == ["MAT-B", "MAT-C", "MAT-A"]
        assert [row["deficit"] for row in ranking["table"]["rows"]] == ["100", "60", "30"]
        assert "MAT-E" not in [row["material"] for row in ranking["table"]["rows"]]
        assert "**Fatos:**" in ranking["answer"]
        assert "**Cálculo:**" in ranking["answer"]
        assert "**Interpretação:**" in ranking["answer"]

        detail = _ask(client, "Investigue o segundo item")
        assert "PN MAT-C" in detail["answer"]
        assert "SALDO ORION -60" in detail["answer"]
        assert "M221" in detail["answer"]
        assert "Q239" in detail["answer"]
        assert "Q273 paralelo informativo 1" in detail["answer"]
        assert "validação" in detail["answer"].lower()
        assert detail["table"]["rows"][0]["material"] == "MAT-C"
        assert detail["llm_used"] is False
        assert detail["audit_id"] > ranking["audit_id"]

        follow = _ask(client, "Esse material está crítico?")
        assert "MAT-C" in follow["answer"]
        assert "MAT-B" not in follow["answer"]
        context = load_chat_context("chain-session")
        assert context["investigation_chain"]["selected_pn"] == "MAT-C"
        assert context["investigation_chain"]["ranking"] == ["MAT-B", "MAT-C", "MAT-A"]

        cq = _ask(client, "E na Qualidade, o que aparece para esse PN?")
        assert "PN MAT-C" in cq["answer"]
        assert "Q239" in cq["answer"]
        assert cq["table"]["rows"][0]["material"] == "MAT-C"


def test_explicit_pn_overrides_ranked_selection_and_keeps_factual_scope():
    with TestClient(app) as client:
        _sync(client)
        _ask(client, "Quais os 3 maiores déficits?")
        result = _ask(client, "Investigue o PN MAT-A")
        assert "PN MAT-A" in result["answer"]
        assert "SALDO ORION -30" in result["answer"]
        assert result["table"]["rows"][0]["material"] == "MAT-A"
        assert "STK TTL" in result["answer"]
        assert "NEC" in result["answer"]


def test_no_ordinal_guess_without_ranking_or_with_out_of_range_position():
    with TestClient(app) as client:
        _sync(client)
        absent = _ask(client, "Investigue o segundo item", "fresh-chain")
        assert "Não há seleção ativa" in absent["answer"]
        assert absent["table"] is None
        _ask(client, "Mostre os 2 maiores déficits", "fresh-chain")
        out_of_range = _ask(client, "Investigue o terceiro item", "fresh-chain")
        assert "não está no último ranking" in out_of_range["answer"]
        assert out_of_range["table"] is None


def test_ranking_memory_cannot_cross_scenario_revision():
    with TestClient(app) as client:
        _sync(client, "chain-month-A")
        _ask(client, "Mostre os 3 maiores déficits", "revision-chain")
        old = load_chat_context("revision-chain")
        assert old["investigation_chain"]["ranking"] == ["MAT-B", "MAT-C", "MAT-A"]

        _sync(client, "chain-month-B")
        changed = _ask(client, "Investigue o segundo item", "revision-chain")
        assert "Não há seleção ativa" in changed["answer"]
        context = load_chat_context("revision-chain")
        assert context["workspace_fingerprint"] != old["workspace_fingerprint"]
        assert not context.get("investigation_chain", {}).get("selected_pn")


def test_ranking_uses_current_values_and_never_conflates_raw_stock_with_release():
    with TestClient(app) as client:
        _sync(client)
        ranking = _ask(client, "Quais os maiores déficits?", "source-chain")
        assert ranking["table"]["rows"][0]["material"] == "MAT-B"
        assert "necessidade automática de compra" in ranking["answer"]
        detail = _ask(client, "Me fale sobre MAT-C", "source-chain")
        assert "quantidade aplicada ao déficit 3" in detail["answer"]
        assert "falta sem explicação 57" in detail["answer"]
        assert "valor bruto do depósito não é recuperação confirmada" in detail["answer"].lower()


def test_explicit_unrelated_critical_question_still_uses_original_count_logic():
    with TestClient(app) as client:
        _sync(client)
        _ask(client, "Quais materiais estão críticos?", "legacy-provenance")
        response = _ask(client, "Como você chegou nesse resultado?", "legacy-provenance")
        assert "REGRA-004" in response["answer"]
        assert "4 material(is)" in response["answer"]
        assert response["table"] is None
