from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
import math
from uuid import uuid4

MAX_SCENARIOS = 8
_SCENARIOS: OrderedDict[str, dict] = OrderedDict()


def _number(value: object, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _calculate(materials: list[dict], models: list[dict], real_by_model: dict[str, float]) -> tuple[list[dict], list[dict], dict]:
    calculated_models: list[dict] = []
    models_above_kit = 0
    kit_total = 0.0
    real_total = 0.0

    for model in models:
        kit = max(_number(model.get("kit_pgd"), 0.0), 0.0)
        real = max(_number(real_by_model.get(model["name"], model.get("real", kit)), kit), 0.0)
        if real > kit + 1e-9:
            models_above_kit += 1
        kit_total += kit
        real_total += real
        calculated_models.append(
            {
                **model,
                "real": real,
                "difference_real_vs_kit": real - kit,
                "above_kit": real > kit + 1e-9,
            }
        )

    real_lookup = {item["name"]: item["real"] for item in calculated_models}
    calculated_materials: list[dict] = []
    investigate = 0
    outside_scope_um = 0
    negative_all_units = 0
    un_materials = 0

    for source in materials:
        item = deepcopy(source)
        nec = 0.0
        for model_name, consumption in item.get("consumption_by_model", {}).items():
            nec += real_lookup.get(model_name, 0.0) * _number(consumption, 0.0)

        stock_total = _number(item.get("stock_total"), 0.0)
        balance = stock_total - nec
        item["nec"] = nec
        item["balance"] = balance

        if balance < -1e-9:
            negative_all_units += 1

        if (item.get("um") or "").upper() == "UN":
            un_materials += 1
            if balance < -1e-9:
                item["status"] = "INVESTIGAR"
                investigate += 1
            else:
                item["status"] = "OK"
        else:
            item["status"] = "FORA_ESCOPO_UM"
            outside_scope_um += 1

        calculated_materials.append(item)

    calculated_materials.sort(
        key=lambda item: (
            0 if item["status"] == "INVESTIGAR" else 1 if item["status"] == "OK" else 2,
            item.get("balance", 0.0),
            item.get("material") or "",
        )
    )

    return calculated_materials, calculated_models, {
        "materials": len(calculated_materials),
        "un_materials": un_materials,
        "materials_to_investigate": investigate,
        "outside_scope_um": outside_scope_um,
        "negative_balance_all_units": negative_all_units,
        "models": len(calculated_models),
        "kit_pgd_total": kit_total,
        "real_total": real_total,
        "models_above_kit": models_above_kit,
    }


def _payload(scenario_id: str, scenario: dict) -> dict:
    materials, models, scenario_summary = _calculate(
        scenario["materials"],
        scenario["models"],
        scenario["real_by_model"],
    )
    summary = {**scenario["base_summary"], **scenario_summary}
    return {
        "mode": "monthly_dpp",
        "status": "PRONTO_PARA_AJUSTE_REAL",
        "scenario_id": scenario_id,
        "reference_month": scenario["reference_month"],
        "scope": scenario["scope"],
        "summary": summary,
        "capabilities": scenario["capabilities"],
        "sources": scenario["sources"],
        "pending": scenario["pending"],
        "diagnostics": scenario["diagnostics"],
        "pgd_mapping": scenario["pgd_mapping"],
        "models": models,
        "materials": materials,
    }


def register_monthly_scenario(
    *,
    materials: list[dict],
    models: list[dict],
    reference_month: str,
    base_summary: dict,
    scope: str,
    capabilities: dict,
    sources: list[dict],
    pending: list[str],
    diagnostics: dict,
    pgd_mapping: dict,
) -> dict:
    scenario_id = uuid4().hex
    real_by_model = {model["name"]: max(_number(model.get("kit_pgd"), 0.0), 0.0) for model in models}
    _SCENARIOS[scenario_id] = {
        "materials": deepcopy(materials),
        "models": deepcopy(models),
        "real_by_model": real_by_model,
        "reference_month": reference_month,
        "base_summary": deepcopy(base_summary),
        "scope": scope,
        "capabilities": deepcopy(capabilities),
        "sources": deepcopy(sources),
        "pending": deepcopy(pending),
        "diagnostics": deepcopy(diagnostics),
        "pgd_mapping": deepcopy(pgd_mapping),
    }
    _SCENARIOS.move_to_end(scenario_id)
    while len(_SCENARIOS) > MAX_SCENARIOS:
        _SCENARIOS.popitem(last=False)
    return _payload(scenario_id, _SCENARIOS[scenario_id])


def recalculate_monthly_scenario(scenario_id: str, real_by_model: dict[str, float]) -> dict:
    scenario = _SCENARIOS.get(scenario_id)
    if scenario is None:
        raise ValueError("Cenário não encontrado ou expirado. Gere o DPP mensal novamente.")

    known_models = {model["name"] for model in scenario["models"]}
    updated = dict(scenario["real_by_model"])
    for model_name, value in real_by_model.items():
        if model_name not in known_models:
            continue
        updated[model_name] = max(_number(value, 0.0), 0.0)

    scenario["real_by_model"] = updated
    _SCENARIOS.move_to_end(scenario_id)
    return _payload(scenario_id, scenario)
