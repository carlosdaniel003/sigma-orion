from __future__ import annotations

from app.services.knowledge_catalog_service import bm25_retrieve, sync_knowledge_index
from app.services.knowledge_inventory_service import DETERMINISTIC_DOCUMENTS, build_knowledge_inventory
from app.services.knowledge_service import answer_from_knowledge


ABSTENTION_CASE = {
    "id": "scope-abstention",
    "kind": "guardrail",
    "question": "Qual o dia de hoje?",
}


def _normalized(text: str) -> str:
    return str(text or "").casefold()


def _category_for_item(item: dict) -> str:
    source = str(item.get("expected_source") or "")
    if source.startswith("python://") or source in DETERMINISTIC_DOCUMENTS:
        return "deterministic"
    return "operational"


def _run_answer_test(item: dict) -> dict:
    answer = answer_from_knowledge(item["query"], top_k=12)
    failures: list[str] = []
    expected_source = item["expected_source"]
    if expected_source not in answer.sources:
        failures.append(f"Fonte esperada ausente: {expected_source}")
    answer_text = _normalized(answer.answer)
    for term in item.get("expected_terms") or []:
        if term == "=":
            if "=" not in answer.answer:
                failures.append("Fórmula recuperada sem sinal de igualdade.")
        elif _normalized(term) not in answer_text:
            failures.append(f"Termo esperado ausente: {term}")
    return {
        "answer": answer.answer,
        "sources": answer.sources,
        "failures": failures,
        "matched_source": expected_source if expected_source in answer.sources else None,
    }


def _run_retrieval_test(item: dict) -> dict:
    category = _category_for_item(item)
    chunks = bm25_retrieve(item["query"], limit=100, category=category)
    expected_source = item["expected_source"]
    matched = next((chunk for chunk in chunks if chunk.source == expected_source), None)
    failures: list[str] = []
    if matched is None:
        failures.append(f"Fonte esperada não recuperada entre os 100 primeiros resultados: {expected_source}")
    else:
        searchable = _normalized(f"{matched.heading} {matched.content} {matched.source}")
        for term in item.get("expected_terms") or []:
            if term == "=":
                if "=" not in matched.content:
                    failures.append("Chunk esperado não contém fórmula.")
            elif _normalized(term) not in searchable:
                failures.append(f"Termo esperado ausente no chunk: {term}")
    return {
        "answer": matched.content if matched else "",
        "sources": [chunk.source for chunk in chunks[:5]],
        "failures": failures,
        "matched_source": matched.source if matched else None,
        "rank": (chunks.index(matched) + 1) if matched is not None else None,
    }


def _run_inventory_item(item: dict) -> dict:
    kind = item["kind"]
    # Conceitos e sinônimos validam a resposta final do Agente. Fórmulas, regras,
    # documentos e casos validam a recuperabilidade da fonte específica inventariada;
    # a autoridade canônica da resposta de fórmula é testada separadamente.
    if kind in {"conceito", "sinônimo"}:
        execution = _run_answer_test(item)
    else:
        execution = _run_retrieval_test(item)

    failures = execution["failures"]
    return {
        "id": item["id"],
        "kind": kind,
        "origin": item["origin"],
        "question": item["query"],
        "title": item["title"],
        "success": not failures,
        "expected_source": item["expected_source"],
        "expected_terms": item.get("expected_terms") or [],
        "answer": execution["answer"],
        "sources": execution["sources"],
        "matched_source": execution.get("matched_source"),
        "rank": execution.get("rank"),
        "failures": failures,
    }


def _run_abstention_test() -> dict:
    answer = answer_from_knowledge(ABSTENTION_CASE["question"])
    failures = [] if not answer.sources else ["A consulta deveria se abster, mas recuperou fonte."]
    return {
        "id": ABSTENTION_CASE["id"],
        "kind": ABSTENTION_CASE["kind"],
        "origin": "guardrail",
        "question": ABSTENTION_CASE["question"],
        "title": "Abstinência fora do escopo",
        "success": not failures,
        "expected_source": None,
        "expected_terms": [],
        "answer": answer.answer,
        "sources": answer.sources,
        "matched_source": None,
        "rank": None,
        "failures": failures,
    }


def run_rag_battery() -> dict:
    sync_knowledge_index(force=True)
    inventory = build_knowledge_inventory()
    results = [_run_inventory_item(item) for item in inventory["items"]]
    results.append(_run_abstention_test())

    inventory_results = [result for result in results if result["kind"] != "guardrail"]
    passed = sum(1 for result in results if result["success"])
    inventory_passed = sum(1 for result in inventory_results if result["success"])

    by_kind: dict[str, dict] = {}
    for kind, total in inventory["by_kind"].items():
        kind_results = [result for result in inventory_results if result["kind"] == kind]
        kind_passed = sum(1 for result in kind_results if result["success"])
        by_kind[kind] = {
            "inventory": total,
            "tested": len(kind_results),
            "passed": kind_passed,
            "failed": len(kind_results) - kind_passed,
            "coverage_percent": round((len(kind_results) / total * 100) if total else 100.0, 2),
            "retrieval_success_percent": round((kind_passed / len(kind_results) * 100) if kind_results else 100.0, 2),
        }

    inventory_total = inventory["total"]
    tested_inventory = len(inventory_results)
    coverage_percent = round((tested_inventory / inventory_total * 100) if inventory_total else 100.0, 2)
    retrieval_success_percent = round(
        (inventory_passed / tested_inventory * 100) if tested_inventory else 100.0,
        2,
    )
    total = len(results)
    success = (
        coverage_percent == 100.0
        and retrieval_success_percent == 100.0
        and passed == total
        and inventory["scan_error_count"] == 0
    )

    return {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "success": success,
        "inventory_total": inventory_total,
        "tested_inventory": tested_inventory,
        "coverage_percent": coverage_percent,
        "retrieval_success_percent": retrieval_success_percent,
        "scan_error_count": inventory["scan_error_count"],
        "scan_errors": inventory["scan_errors"],
        "by_kind": by_kind,
        "results": results,
    }
