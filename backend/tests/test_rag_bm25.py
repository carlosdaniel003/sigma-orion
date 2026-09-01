from app.services.knowledge_catalog_service import bm25_retrieve, sync_knowledge_index
from app.services.rag_test_service import run_rag_battery


def test_sqlite_bm25_index_is_available_and_ranks_nec_rule() -> None:
    status = sync_knowledge_index(force=True)
    assert status["document_count"] >= 5
    assert status["chunk_count"] >= status["document_count"]

    results = bm25_retrieve("fórmula NEC", limit=5)
    assert results
    assert results[0].source == "motor-deterministico.md"
    assert "NEC" in results[0].heading.upper()


def test_rag_regression_battery_passes() -> None:
    report = run_rag_battery()
    assert report["success"] is True, report
    assert report["failed"] == 0
    assert report["passed"] == report["total"]
