from app.services import dpp_scenario_service as scenario_service


def test_latest_monthly_scenario_returns_most_recent_registered_scenario() -> None:
    scenario_service._SCENARIOS.clear()
    try:
        first = scenario_service.register_monthly_scenario(
            materials=[],
            models=[],
            reference_month="2026-06",
            base_summary={},
            scope="Teste junho",
            capabilities={},
            sources=[],
            pending=[],
            diagnostics={},
            pgd_mapping={},
        )
        second = scenario_service.register_monthly_scenario(
            materials=[],
            models=[],
            reference_month="2026-07",
            base_summary={},
            scope="Teste julho",
            capabilities={},
            sources=[],
            pending=[],
            diagnostics={},
            pgd_mapping={},
        )

        latest = scenario_service.get_latest_monthly_scenario()
        assert latest is not None
        assert latest["scenario_id"] == second["scenario_id"]
        assert latest["scenario_id"] != first["scenario_id"]
        assert latest["reference_month"] == "2026-07"
    finally:
        scenario_service._SCENARIOS.clear()


def test_latest_monthly_scenario_returns_none_without_scenarios() -> None:
    scenario_service._SCENARIOS.clear()
    assert scenario_service.get_latest_monthly_scenario() is None
