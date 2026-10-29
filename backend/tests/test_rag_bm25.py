from app.services.knowledge_catalog_service import bm25_retrieve, sync_knowledge_index
from app.services.knowledge_inventory_service import build_knowledge_inventory
from app.services.knowledge_service import answer_from_knowledge
from app.services.python_knowledge_inventory_service import scan_python_knowledge
from app.services.rag_test_service import run_rag_battery


def test_sqlite_bm25_index_includes_python_inventory() -> None:
    status = sync_knowledge_index(force=True)
    rules, errors = scan_python_knowledge()

    assert errors == []
    assert rules
    assert status["python_rule_count"] == len(rules)
    assert status["document_count"] >= status["python_rule_count"] + 5
    assert status["chunk_count"] >= status["document_count"]

    target = next(rule for rule in rules if rule.symbol.endswith("calculate_nec"))
    results = bm25_retrieve(target.query, limit=100, category="deterministic")
    assert any(result.source == target.source for result in results)


def test_canonical_formula_answer_remains_document_authoritative() -> None:
    answer = answer_from_knowledge("Qual a fórmula para calcular NEC?")
    assert answer.sources == ["motor-deterministico.md"]
    assert "NEC = Σ(REAL do modelo × consumo do material naquele modelo)" in answer.answer


def test_inventory_generates_one_test_for_every_known_item() -> None:
    inventory = build_knowledge_inventory()
    report = run_rag_battery()

    assert inventory["scan_error_count"] == 0
    assert report["inventory_total"] == inventory["total"]
    assert report["tested_inventory"] == inventory["total"]
    assert report["coverage_percent"] == 100.0
    for kind, total in inventory["by_kind"].items():
        assert report["by_kind"][kind]["inventory"] == total
        assert report["by_kind"][kind]["tested"] == total
        assert report["by_kind"][kind]["coverage_percent"] == 100.0


def test_rag_regression_battery_passes_with_full_retrieval_coverage() -> None:
    report = run_rag_battery()
    assert report["success"] is True, report
    assert report["failed"] == 0
    assert report["passed"] == report["total"]
    assert report["coverage_percent"] == 100.0
    assert report["retrieval_success_percent"] == 100.0
