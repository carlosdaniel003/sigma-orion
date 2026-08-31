from app.services import dpp_scenario_service as scenario_service


def _register_scenario() -> dict:
    return scenario_service.register_monthly_scenario(
        materials=[
            {
                "material": "MAT-1",
                "description": "Material persistido",
                "um": "UN",
                "group_origin": "LOCAL",
                "consumption_by_model": {"MODELO A": 2.0},
                "stock_sap_effective": 100.0,
                "explosion": 5.0,
                "stock_op": 0.0,
            }
        ],
        models=[{"name": "MODELO A", "kit_pgd": 10.0}],
        reference_month="2026-08",
        base_summary={},
        scope="teste persistência",
        capabilities={},
        sources=[],
        pending=[],
        diagnostics={},
        pgd_mapping={},
    )


def test_monthly_scenario_survives_memory_reset(tmp_path, monkeypatch) -> None:
    state_file = tmp_path / "dpp_scenario_state.json"
    monkeypatch.setattr(scenario_service, "SCENARIO_STATE_PATH", state_file)
    scenario_service._SCENARIOS.clear()

    try:
        created = _register_scenario()
        scenario_id = created["scenario_id"]
        assert state_file.exists()

        scenario_service.recalculate_monthly_scenario(
            scenario_id,
            {"MODELO A": 7.0},
        )

        scenario_service._SCENARIOS.clear()
        assert scenario_service.get_latest_monthly_scenario() is None

        assert scenario_service.restore_persisted_monthly_scenario() is True
        restored = scenario_service.get_latest_monthly_scenario()

        assert restored is not None
        assert restored["scenario_id"] == scenario_id
        assert restored["reference_month"] == "2026-08"
        assert restored["models"][0]["name"] == "MODELO A"
        assert restored["models"][0]["kit_pgd"] == 10.0
        assert restored["models"][0]["real"] == 7.0
        assert restored["materials"][0]["material"] == "MAT-1"
        assert restored["materials"][0]["nec"] == 14.0
    finally:
        scenario_service._SCENARIOS.clear()
