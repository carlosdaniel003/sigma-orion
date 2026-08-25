from app.services.dpp_test_service import _compare


def _material(
    code: str,
    *,
    optional: str | None,
    stock_op: float,
    stock_total: float,
    balance: float,
) -> dict:
    return {
        "material": code,
        "description": code,
        "um": "UN",
        "group_origin": "Importado",
        "optional_material": optional,
        "consumption_by_model": {},
        "stock_sap": 5.0 if code == "MAT-A" else 2.0,
        "stock_source": {"reference": f"STK!{code}"},
        "explosion": 0.0,
        "stock_op": stock_op,
        "stock_total": stock_total,
        "nec": 10.0 if code == "MAT-A" else 0.0,
        "balance": balance,
        "formula_state": {},
    }


def test_reconstruction_classifies_source_side_of_opc_reallocation_as_human_intervention() -> None:
    generated = {
        "models": [],
        "summary": {},
        "materials": [
            _material("MAT-A", optional="ALT-001", stock_op=10.0, stock_total=15.0, balance=5.0),
            _material("MAT-B", optional=None, stock_op=0.0, stock_total=2.0, balance=2.0),
        ],
    }
    expected = {
        "models": {},
        "materials": {
            "MAT-A": _material("MAT-A", optional="ALT-001", stock_op=0.0, stock_total=5.0, balance=-5.0),
            "MAT-B": _material("MAT-B", optional="ALT-001", stock_op=10.0, stock_total=12.0, balance=12.0),
        },
    }
    previous_materials = {
        "MAT-A": {"material": "MAT-A", "optional_material": "ALT-001"},
        "MAT-B": {"material": "MAT-B", "optional_material": None},
    }

    comparison = _compare(
        generated=generated,
        expected=expected,
        previous_materials=previous_materials,
    )

    assert comparison["pass"] is True
    assert comparison["status"] == "APROVADO_COM_INTERVENCOES_HUMANAS"
    assert comparison["mismatch_total"] == 0
    assert comparison["human_interventions_total"] == 7
    assert comparison["checks"]["optional_material"]["human_interventions"] == 1
    assert comparison["checks"]["stock_op"]["human_interventions"] == 2
    assert comparison["checks"]["stock_total"]["human_interventions"] == 2
    assert comparison["checks"]["balance"]["human_interventions"] == 2

    source_samples = [
        item
        for item in comparison["human_interventions"]
        if item["key"] == "MAT-A" and item["field"] in {"stock_op", "stock_total", "balance"}
    ]
    assert len(source_samples) == 3
    assert all(item.get("subtype") == "OPC_REALLOCATION" for item in source_samples)
    assert all("REALOCAÇÃO DE OPC" in item["reason"].upper() for item in source_samples)
    assert comparison["mismatches"] == []
