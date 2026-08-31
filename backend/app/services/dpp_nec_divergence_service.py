from __future__ import annotations

from app.services.dpp_service import VALIDATION_ABS_TOL, _cell, _normalize, _number


def _pt_number(value: float) -> str:
    number = float(value or 0.0)
    if abs(number - round(number)) <= VALIDATION_ABS_TOL:
        return f"{int(round(number)):,}".replace(",", ".")
    rendered = f"{number:,.6f}".rstrip("0").rstrip(".")
    return rendered.replace(",", "X").replace(".", ",").replace("X", ".")


def _join_models(items: list[dict], limit: int = 4) -> str:
    selected = items[:limit]
    labels = [
        f"{item['name']} ({_pt_number(item['orion'])} → {_pt_number(item['final'])})"
        for item in selected
    ]
    if len(items) > limit:
        labels.append(f"mais {len(items) - limit} modelo(s)")
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + " e " + labels[-1]


def explain_nec_divergence(
    *,
    rows: list[tuple],
    headers: dict[int, str],
    real_row: int | None,
    final_row: int,
    projected_row: dict,
    projection: dict,
    scenario_models: list[dict],
    final_value: object,
    orion_value: object,
) -> str | None:
    """Explica a diferença de NEC decompondo REAL e consumo por modelo.

    Identidade usada por modelo:
    final_real * final_consumo - orion_real * orion_consumo
      = (final_real - orion_real) * orion_consumo
      + final_real * (final_consumo - orion_consumo)

    Assim a explicação não confunde mudança de planejamento (REAL) com mudança
    da matriz Material × Modelo (consumo).
    """
    if real_row is None:
        return None

    orion_real_by_model = {
        _normalize(model.get("name")): _number(model.get("real"), 0.0) or 0.0
        for model in scenario_models
        if model.get("name")
    }

    real_changes: list[dict] = []
    consumption_changes: list[dict] = []
    real_effect = 0.0
    consumption_effect = 0.0

    for column in range(int(projection["model_start"]), int(projection["model_end"]) + 1):
        name = headers.get(column)
        if not name:
            continue

        orion_real = orion_real_by_model.get(_normalize(name), 0.0)
        final_real = _number(_cell(rows, real_row, column), 0.0) or 0.0
        orion_consumption = _number(projected_row["values"].get(column), 0.0) or 0.0
        final_consumption = _number(_cell(rows, final_row, column), 0.0) or 0.0

        real_delta = final_real - orion_real
        consumption_delta = final_consumption - orion_consumption
        model_real_effect = real_delta * orion_consumption
        model_consumption_effect = final_real * consumption_delta
        real_effect += model_real_effect
        consumption_effect += model_consumption_effect

        if abs(real_delta) > VALIDATION_ABS_TOL and (
            abs(orion_consumption) > VALIDATION_ABS_TOL or abs(final_consumption) > VALIDATION_ABS_TOL
        ):
            real_changes.append({
                "name": str(name),
                "orion": orion_real,
                "final": final_real,
                "effect": model_real_effect,
            })

        if abs(consumption_delta) > VALIDATION_ABS_TOL:
            consumption_changes.append({
                "name": str(name),
                "orion": orion_consumption,
                "final": final_consumption,
                "effect": model_consumption_effect,
            })

    delta = (_number(final_value, 0.0) or 0.0) - (_number(orion_value, 0.0) or 0.0)
    explained = real_effect + consumption_effect
    tolerance = max(VALIDATION_ABS_TOL, abs(delta) * 1e-9)
    if abs(delta - explained) > tolerance:
        return None

    real_changes.sort(key=lambda item: abs(item["effect"]), reverse=True)
    consumption_changes.sort(key=lambda item: abs(item["effect"]), reverse=True)

    has_real_effect = abs(real_effect) > tolerance and bool(real_changes)
    has_consumption_effect = abs(consumption_effect) > tolerance and bool(consumption_changes)

    if has_real_effect and not has_consumption_effect:
        return (
            f"NEC divergente devido a alterações no REAL de {len(real_changes)} modelo(s) entre o cenário inicial "
            f"e o DPP Final: {_join_models(real_changes)}. A diferença do NEC é explicada por essas alterações no REAL."
        )

    if has_consumption_effect and not has_real_effect:
        return (
            f"NEC divergente devido a diferenças de consumo em {len(consumption_changes)} modelo(s) entre a matriz "
            f"Material × Modelo do ORION e o DPP Final: {_join_models(consumption_changes)}."
        )

    if has_real_effect and has_consumption_effect:
        return (
            f"NEC divergente por duas causas: alterações no REAL de {len(real_changes)} modelo(s) "
            f"({_join_models(real_changes)}) e diferenças de consumo em {len(consumption_changes)} modelo(s) "
            f"({_join_models(consumption_changes)})."
        )

    return None
