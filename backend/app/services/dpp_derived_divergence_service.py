from __future__ import annotations

from app.services.dpp_nec_divergence_service import explain_nec_divergence
from app.services.dpp_service import VALIDATION_ABS_TOL, _cell, _number


def _field_column(projection: dict, field: str) -> int | None:
    for column, spec in projection.get("specs", {}).items():
        if spec.get("supported") and spec.get("field") == field:
            return int(column)
    return None


def _delta(final_value: object, orion_value: object) -> float:
    return (_number(final_value, 0.0) or 0.0) - (_number(orion_value, 0.0) or 0.0)


def _close(left: float, right: float) -> bool:
    tolerance = max(VALIDATION_ABS_TOL, abs(left) * 1e-9, abs(right) * 1e-9)
    return abs(left - right) <= tolerance


def _stock_total_reason(*, rows: list[tuple], final_row: int, projected_row: dict, projection: dict) -> str | None:
    changed: list[str] = []
    labels = {
        "stock_sap_effective": "STK",
        "explosion": "EXPLOSÃO",
        "stock_op": "STK OP",
    }
    for field, label in labels.items():
        column = _field_column(projection, field)
        if column is None:
            continue
        final_component = _cell(rows, final_row, column)
        orion_component = projected_row["values"].get(column)
        if abs(_delta(final_component, orion_component)) > VALIDATION_ABS_TOL:
            changed.append(label)

    if not changed:
        return None
    if len(changed) == 1:
        return f"STK TTL divergente porque o componente {changed[0]} é diferente entre o cenário ORION e o DPP Final."
    return f"STK TTL divergente porque {len(changed)} componentes mudaram entre o cenário ORION e o DPP Final: {', '.join(changed)}."


def _balance_reason(
    *,
    rows: list[tuple],
    headers: dict[int, str],
    real_row: int | None,
    final_row: int,
    projected_row: dict,
    projection: dict,
    scenario_models: list[dict],
) -> str | None:
    stock_column = _field_column(projection, "stock_total")
    nec_column = _field_column(projection, "nec")
    balance_column = _field_column(projection, "balance")
    if stock_column is None or nec_column is None or balance_column is None:
        return None

    final_stock = _cell(rows, final_row, stock_column)
    orion_stock = projected_row["values"].get(stock_column)
    final_nec = _cell(rows, final_row, nec_column)
    orion_nec = projected_row["values"].get(nec_column)
    final_balance = _cell(rows, final_row, balance_column)
    orion_balance = projected_row["values"].get(balance_column)

    stock_delta = _delta(final_stock, orion_stock)
    nec_delta = _delta(final_nec, orion_nec)
    balance_delta = _delta(final_balance, orion_balance)
    if not _close(balance_delta, stock_delta - nec_delta):
        return None

    stock_changed = abs(stock_delta) > VALIDATION_ABS_TOL
    nec_changed = abs(nec_delta) > VALIDATION_ABS_TOL
    nec_reason = None
    if nec_changed:
        nec_reason = explain_nec_divergence(
            rows=rows,
            headers=headers,
            real_row=real_row,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
            scenario_models=scenario_models,
            final_value=final_nec,
            orion_value=orion_nec,
        )

    if nec_changed and not stock_changed:
        if nec_reason:
            return f"SALDO divergente porque o STK TTL permaneceu igual e o NEC mudou. {nec_reason}"
        return "SALDO divergente porque o STK TTL permaneceu igual e o NEC é diferente entre o cenário ORION e o DPP Final."

    if stock_changed and not nec_changed:
        stock_reason = _stock_total_reason(
            rows=rows,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
        )
        return f"SALDO divergente porque o NEC permaneceu igual e o STK TTL mudou. {stock_reason or ''}".strip()

    if stock_changed and nec_changed:
        stock_reason = _stock_total_reason(
            rows=rows,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
        )
        details = " ".join(reason for reason in (stock_reason, nec_reason) if reason)
        return f"SALDO divergente por alterações simultâneas em STK TTL e NEC. {details}".strip()

    return None


def _amount_reason(
    *,
    rows: list[tuple],
    headers: dict[int, str],
    real_row: int | None,
    final_row: int,
    projected_row: dict,
    projection: dict,
    scenario_models: list[dict],
) -> str | None:
    price_column = _field_column(projection, "price")
    balance_column = _field_column(projection, "balance")
    amount_column = _field_column(projection, "amount")
    if price_column is None or balance_column is None or amount_column is None:
        return None

    final_price = _number(_cell(rows, final_row, price_column), 0.0) or 0.0
    orion_price = _number(projected_row["values"].get(price_column), 0.0) or 0.0
    final_balance = _number(_cell(rows, final_row, balance_column), 0.0) or 0.0
    orion_balance = _number(projected_row["values"].get(balance_column), 0.0) or 0.0
    final_amount = _number(_cell(rows, final_row, amount_column), 0.0) or 0.0
    orion_amount = _number(projected_row["values"].get(amount_column), 0.0) or 0.0

    amount_delta = final_amount - orion_amount
    expected_delta = (final_balance - orion_balance) * orion_price + final_balance * (final_price - orion_price)
    if not _close(amount_delta, expected_delta):
        return None

    price_changed = abs(final_price - orion_price) > VALIDATION_ABS_TOL
    balance_changed = abs(final_balance - orion_balance) > VALIDATION_ABS_TOL

    if balance_changed and not price_changed:
        balance_reason = _balance_reason(
            rows=rows,
            headers=headers,
            real_row=real_row,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
            scenario_models=scenario_models,
        )
        return f"Amount divergente porque o Preço permaneceu igual e o SALDO mudou. {balance_reason or ''}".strip()

    if price_changed and not balance_changed:
        return "Amount divergente porque o SALDO permaneceu igual e o Preço mudou entre o cenário ORION e o DPP Final."

    if price_changed and balance_changed:
        balance_reason = _balance_reason(
            rows=rows,
            headers=headers,
            real_row=real_row,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
            scenario_models=scenario_models,
        )
        return f"Amount divergente por alterações simultâneas em Preço e SALDO. {balance_reason or ''}".strip()

    return None


def explain_derived_divergence(
    *,
    field: str,
    rows: list[tuple],
    headers: dict[int, str],
    real_row: int | None,
    final_row: int,
    projected_row: dict,
    projection: dict,
    scenario_models: list[dict],
) -> str | None:
    if field == "stock_total":
        return _stock_total_reason(
            rows=rows,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
        )
    if field == "balance":
        return _balance_reason(
            rows=rows,
            headers=headers,
            real_row=real_row,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
            scenario_models=scenario_models,
        )
    if field == "amount":
        return _amount_reason(
            rows=rows,
            headers=headers,
            real_row=real_row,
            final_row=final_row,
            projected_row=projected_row,
            projection=projection,
            scenario_models=scenario_models,
        )
    return None
