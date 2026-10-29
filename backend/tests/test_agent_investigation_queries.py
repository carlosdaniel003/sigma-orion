from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import knowledge_catalog_service as catalog
from app.services.database_investigation_query_service import answer_investigation_question
from app.services.rag_runtime_service import load_runtime_entities, sync_runtime_workspace



@pytest.fixture(autouse=True)
def isolated_knowledge_index(monkeypatch) -> None:
    # O índice tem cache global de fingerprint: cada teste usa outro arquivo
    # SQLite e não pode deixar o cache apontando para um banco já descartado.
    monkeypatch.setattr(catalog, "_LAST_FINGERPRINT", None)


def _candidate(pn: str, depot: str, *, reviewed: bool = False) -> dict:
    validation = (
        {"id": 1, "decision": "RELEASED", "confirmed_quantity": 3, "accounting": "NOT_INCLUDED"}
        if reviewed else None
    )
    return {
        "candidate_id": f"{pn}-{depot}",
        "depot": depot,
        "center": "1000",
        "unit": "UN",
        "quantity": 10,
        "source_rows": [20],
        "validation": validation,
    }


def _workspace() -> dict:
    pns = ["MAT-101", "MAT-102", "MAT-103", "MAT-104", "MAT-105"]
    quality_materials = []
    for index, pn in enumerate(pns):
        depot = "Q239" if index < 3 else "Q273"
        quality_materials.append({
            "material": pn,
            "description": f"Componente {index + 1}",
            "unit": "UN",
            "active_depot": depot,
            "candidates": [_candidate(pn, depot, reviewed=index == 0)],
            "additional_q273_evidence": [_candidate(pn, "Q273")] if index == 0 else [],
            "q273_records_skipped_due_q239": 1 if index == 0 else 0,
            "gap_from_41": 20,
            "unexplained_after_quality": 17 if index == 0 else 20,
            "quality_released_applied": 3 if index == 0 else 0,
            "workflow_status": "AWAITING_QUALITY" if index else "SCRAP_4_3",
        })
    quality_materials.append({
        "material": "MAT-106",
        "description": "Sem registros de CQ",
        "unit": "UN",
        "active_depot": None,
        "candidates": [],
        "unexplained_after_quality": 20,
        "workflow_status": "SCRAP_4_3",
    })
    stock_materials = [{
        "material": pn,
        "description": f"Componente {index + 1}",
        "unit": "UN",
        "negative_balance": 20,
        "candidates": [_candidate(pn, "M221")],
        "unexplained_quantity": 20,
        "workflow_status": "QUALITY_4_2",
    } for index, pn in enumerate(pns)]
    return {
        "month": "2026-07",
        "state": {"package": "ready", "scenario": "current", "final_dpp": "pending"},
        "scenario": {
            "scenario_id": "july-mvp",
            "reference_month": "2026-07",
            "sources": [{"id": "stock", "filename": "STK JULHO.xlsx"}],
            "summary": {"materials_to_investigate": 6},
            "models": [],
            "materials": [],
        },
        "investigations": {
            "stock": {
                "scenario_id": "july-mvp",
                "reference_month": "2026-07",
                "source": {"filename": "STK JULHO.xlsx", "sheet": "ORIGINAL"},
                "summary": {"critical_materials": 6, "materials_with_candidates": 5, "items_to_quality": 6},
                "materials": stock_materials,
                "unmatched_materials": [{
                    "material": "MAT-106", "description": "Sem registros estoque",
                    "unit": "UN", "negative_balance": 20,
                }],
                "workflow": {"forward_to_quality": [{"material": pn} for pn in [*pns, "MAT-106"]]},
            },
            "quality": {
                "scenario_id": "july-mvp",
                "reference_month": "2026-07",
                "source": {"filename": "STK JULHO.xlsx", "sheet": "ORIGINAL"},
                "summary": {"items_received_from_41": 6, "materials_with_q239": 3, "materials_with_q273": 2},
                "materials": quality_materials,
            },
        },
    }


def test_chat_lists_the_five_active_q239_q273_materials(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    workspace = _workspace()
    sync_runtime_workspace(workspace)

    with TestClient(app) as client:
        response = client.post("/api/knowledge/chat", json={
            "question": "Me fala sobre os 5 itens encontrados no Q239 e no Q273 ativos: Encontrados em CQ 5 Q239 / Q273 ativos",
            "session_id": "quality-five-regression",
        })
    assert response.status_code == 200
    result = response.json()
    assert result["model"] == "deterministic-dashboard-investigation"
    assert "5 PN(s)" in result["answer"]
    assert result["table"]["total_rows"] == 5
    assert {row["material"] for row in result["table"]["rows"]} == {
        "MAT-101", "MAT-102", "MAT-103", "MAT-104", "MAT-105",
    }
    assert result["table"]["rows"][0]["depot"] == "Q239"
    assert all("MAT-106" != row["material"] for row in result["table"]["rows"])
    assert "Q273 paralelo" in result["answer"]
    assert result["knowledge_sources"]


def test_cq_active_depot_filter_and_material_evidence(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    sync_runtime_workspace(_workspace())

    q239 = answer_investigation_question("Quais PNs encontrados no Q239?")
    q273 = answer_investigation_question("Quais PNs encontrados no Q273?")
    detail = answer_investigation_question("Me fale sobre o PN MAT-101 no CQ")

    assert q239 is not None and q239.table["total_rows"] == 3
    assert q273 is not None and q273.table["total_rows"] == 2
    assert detail is not None
    assert "Q273 paralelo" in detail.answer
    assert "linhas ORIGINAL [20]" in detail.answer
    assert detail.table["rows"][0]["pending"] == 0


def test_stock_dashboard_and_revision_are_synchronized(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    workspace = _workspace()
    first = sync_runtime_workspace(workspace)
    found = answer_investigation_question("Quais PNs foram encontrados em Estoque M221/P277?")
    pending = answer_investigation_question("Quantos aguardando Almoxarifado?")
    overview = answer_investigation_question("Resumo operacional do Dashboard")
    assert found.table["total_rows"] == 5
    assert pending.table["total_rows"] == 5
    assert overview.table["rows"][4]["value"] == 5

    updated = deepcopy(workspace)
    updated["investigations"]["quality"]["materials"][1]["candidates"][0]["validation"] = {
        "id": 10, "decision": "REJECTED", "confirmed_quantity": 5, "justification": "Laudo CQ",
    }
    second = sync_runtime_workspace(updated)
    assert second["workspace_fingerprint"] != first["workspace_fingerprint"]
    records = load_runtime_entities(entity_type="investigation_material", entity_key="MAT-102", scope="quality")
    assert records[0]["payload"]["candidates"][0]["validation"]["id"] == 10


def test_stale_scenario_investigations_are_not_indexed(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    workspace = _workspace()
    workspace["investigations"]["quality"]["scenario_id"] = "another-scenario"
    sync_runtime_workspace(workspace)
    assert load_runtime_entities(entity_type="investigation_material", scope="quality") == []
    answer = answer_investigation_question("Quais os itens encontrados em CQ?")
    assert "não está sincronizado" in answer.answer
    assert answer.table is None


def test_forwarded_to_quality_uses_stock_investigation_and_material_quantities(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(catalog, "DATABASE_URL", f"sqlite:///{tmp_path / 'orion.db'}")
    sync_runtime_workspace(_workspace())

    forwarded = answer_investigation_question("Quais PNs encaminhados à Qualidade?")
    assert forwarded is not None
    assert forwarded.table["total_rows"] == 6
    assert "Encaminhados à Qualidade" in forwarded.answer

    detail = answer_investigation_question("Detalhe o PN MAT-101 na análise de qualidade")
    assert detail is not None
    assert "Liberação CQ adicional, aplicada ao déficit: 3 UN" in detail.answer
    assert "quantidade confirmada 3" in detail.answer
    assert detail.context["subject_key"] == "MAT-101"
