from __future__ import annotations

from dataclasses import dataclass

from app.services.knowledge_service import answer_from_knowledge


@dataclass(frozen=True, slots=True)
class RagTestCase:
    id: str
    question: str
    expected_source: str | None = None
    expected_terms: tuple[str, ...] = ()
    expect_abstain: bool = False


RAG_TEST_CASES: tuple[RagTestCase, ...] = (
    RagTestCase(
        id="formula-nec",
        question="Qual a fórmula para calcular NEC?",
        expected_source="motor-deterministico.md",
        expected_terms=("NEC", "REAL", "consumo"),
    ),
    RagTestCase(
        id="formula-saldo",
        question="Qual a fórmula do SALDO?",
        expected_source="motor-deterministico.md",
        expected_terms=("SALDO", "STK TTL", "NEC"),
    ),
    RagTestCase(
        id="formula-stk-ttl",
        question="Como calcula STK TTL?",
        expected_source="motor-deterministico.md",
        expected_terms=("STK TTL", "STK SAP", "EXPLOSÃO", "STK OP"),
    ),
    RagTestCase(
        id="definition-wiu",
        question="O que significa WIU?",
        expected_source="glossario.md",
        expected_terms=("WIU",),
    ),
    RagTestCase(
        id="definition-check",
        question="O que significa CHECK?",
        expected_source="glossario.md",
        expected_terms=("Check",),
    ),
    RagTestCase(
        id="critical-rule",
        question="Qual a regra de material crítico?",
        expected_source="motor-deterministico.md",
        expected_terms=("UN", "SALDO"),
    ),
    RagTestCase(
        id="scenario-final",
        question="Qual a diferença entre Cenário ORION e DPP Final?",
        expected_source="motor-deterministico.md",
        expected_terms=("Cenário ORION", "DPP Final"),
    ),
    RagTestCase(
        id="scope-abstention",
        question="Qual o dia de hoje?",
        expect_abstain=True,
    ),
)


def _normalized(text: str) -> str:
    return str(text or "").casefold()


def run_rag_battery() -> dict:
    results: list[dict] = []
    passed = 0

    for case in RAG_TEST_CASES:
        answer = answer_from_knowledge(case.question)
        failures: list[str] = []

        if case.expect_abstain:
            if answer.sources:
                failures.append("A consulta deveria se abster, mas recuperou fonte.")
        else:
            if case.expected_source and case.expected_source not in answer.sources:
                failures.append(f"Fonte esperada ausente: {case.expected_source}")
            answer_text = _normalized(answer.answer)
            for term in case.expected_terms:
                if _normalized(term) not in answer_text:
                    failures.append(f"Termo esperado ausente: {term}")

        success = not failures
        if success:
            passed += 1

        results.append(
            {
                "id": case.id,
                "question": case.question,
                "success": success,
                "expected_source": case.expected_source,
                "expected_terms": list(case.expected_terms),
                "expect_abstain": case.expect_abstain,
                "answer": answer.answer,
                "sources": answer.sources,
                "failures": failures,
            }
        )

    total = len(results)
    return {
        "total": total,
        "passed": passed,
        "failed": total - passed,
        "success": passed == total,
        "results": results,
    }
