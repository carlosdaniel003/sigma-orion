from __future__ import annotations

from app.services.dpp_consolidation_service import _material_key
from app.services.dpp_service import VALIDATION_ABS_TOL, _normalize, _number

COUNT_COLUMNS = {
    "material",
    "descricao",
    "um",
    "grupo origem",
    "check",
    "wiu",
    "opc",
    "coments",
    "comments",
    "comentario",
    "comentarios",
}

UNSUPPORTED_ORION_COLUMNS = {
    "coments",
    "comments",
    "comentario",
    "comentarios",
}

COMMENT_COLUMNS = {"coments", "comments", "comentario", "comentarios"}

DIRECT_FIELDS = {
    "material": ("material", "text"),
    "descricao": ("description", "text"),
    "um": ("um", "text"),
    "grupo origem": ("group_origin", "text"),
    "check": ("check", "text"),
    "wiu": ("in_current_wiu", "presence"),
    "nec": ("nec", "numeric"),
    "opc": ("optional_material", "text"),
    "stk op": ("stock_op", "numeric"),
    "stk ttl": ("stock_total", "numeric"),
    "saldo": ("balance", "numeric"),
    "preco": ("price", "numeric"),
    "amount": ("amount", "numeric"),
}

STOCK_TOTAL_COMPONENT_FIELDS = (
    "stock_sap_effective",
    "explosion",
    "stock_op",
)
BALANCE_POSITIVE_FIELD = "stock_total"
BALANCE_NEGATIVE_FIELD = "nec"
CRITICAL_BALANCE_TOLERANCE = VALIDATION_ABS_TOL


def calculate_nec(material: dict, real_lookup: dict[str, float]) -> float:
    return sum(
        (real_lookup.get(model_name, 0.0) or 0.0) * (_number(consumption, 0.0) or 0.0)
        for model_name, consumption in (material.get("consumption_by_model") or {}).items()
    )


def calculate_stock_total(material: dict) -> float:
    has_components = any(
        field in material and material.get(field) is not None
        for field in STOCK_TOTAL_COMPONENT_FIELDS
    )
    if not has_components:
        return _number(material.get("stock_total"), 0.0) or 0.0

    return sum(
        _number(
            material.get(field, material.get("stock_sap") if field == "stock_sap_effective" else 0.0),
            0.0,
        ) or 0.0
        for field in STOCK_TOTAL_COMPONENT_FIELDS
    )


def calculate_balance(stock_total: float, nec: float) -> float:
    return (_number(stock_total, 0.0) or 0.0) - (_number(nec, 0.0) or 0.0)


def is_critical_material(unit: object, balance: object) -> bool:
    if _normalize(unit).upper() != "UN":
        return False
    numeric_balance = _number(balance, None)
    return numeric_balance is not None and numeric_balance < -CRITICAL_BALANCE_TOLERANCE


def critical_rule_metadata() -> dict:
    return {
        "id": "un_negative_balance",
        "label": "Material crítico",
        "definition": "O ORION considera crítico o material cuja UM é UN e cujo SALDO é negativo além da tolerância operacional.",
        "formula": "SALDO = STK TTL − NEC; STK TTL = STK + EXPLOSÃO + STK OP; NEC = Σ(REAL do modelo × consumo do material).",
        "tolerance": CRITICAL_BALANCE_TOLERANCE,
    }


def is_filled(value: object) -> bool:
    return value not in (None, "") and str(value).strip() != ""


def aggregate(values: list[object], kind: str) -> float | int:
    if kind == "count":
        return sum(1 for value in values if is_filled(value))
    return sum(_number(value, 0.0) or 0.0 for value in values)


def scenario_column_spec(
    *,
    column: int,
    header: str,
    model_start: int,
    model_end: int,
) -> dict:
    normalized = _normalize(header)
    kind = "count" if normalized in COUNT_COLUMNS else "sum"

    if model_start <= column <= model_end:
        return {
            "kind": "sum",
            "supported": True,
            "field": "model",
            "model_name": header,
            "comparison": "numeric",
        }

    if normalized in UNSUPPORTED_ORION_COLUMNS:
        return {
            "kind": kind,
            "supported": False,
            "field": None,
            "comparison": None,
        }

    if normalized in DIRECT_FIELDS:
        field, comparison = DIRECT_FIELDS[normalized]
        return {
            "kind": kind,
            "supported": True,
            "field": field,
            "comparison": comparison,
        }

    if normalized.startswith("stk ") and normalized not in {"stk op", "stk ttl"}:
        return {
            "kind": "sum",
            "supported": True,
            "field": "stock_sap_effective",
            "comparison": "numeric",
        }

    if normalized.startswith("explosao"):
        return {
            "kind": "sum",
            "supported": True,
            "field": "explosion",
            "comparison": "numeric",
        }

    return {
        "kind": kind,
        "supported": False,
        "field": None,
        "comparison": None,
    }


def scenario_material_value(material: dict, spec: dict) -> object:
    field = spec.get("field")

    if field == "model":
        target = _normalize(spec.get("model_name"))
        for model_name, value in (material.get("consumption_by_model") or {}).items():
            if _normalize(model_name) == target:
                return _number(value, 0.0) or 0.0
        return 0.0

    if field == "check":
        return material.get("check")

    if field == "in_current_wiu":
        return "WIU" if material.get("in_current_wiu") else None

    if field == "stock_sap_effective":
        return material.get("stock_sap_effective", material.get("stock_sap"))

    return material.get(field) if field else None


def column_values_equal(left_value: object, right_value: object, comparison: str | None) -> bool:
    if comparison == "numeric":
        left = _number(left_value, 0.0) or 0.0
        right = _number(right_value, 0.0) or 0.0
        return abs(left - right) <= VALIDATION_ABS_TOL

    if comparison == "presence":
        return is_filled(left_value) == is_filled(right_value)

    return _normalize(left_value) == _normalize(right_value)


def build_orion_projection(
    *,
    scenario: dict,
    headers: dict[int, str],
    material_col: int,
    origin_col: int,
    check_col: int,
) -> dict:
    model_start = origin_col + 1
    model_end = check_col - 1

    comment_columns = [
        column
        for column, header in headers.items()
        if _normalize(header) in COMMENT_COLUMNS and column >= material_col
    ]
    last_column = min(comment_columns) if comment_columns else max(headers)
    comparison_columns = [
        column
        for column in sorted(headers)
        if material_col <= column <= last_column
    ]

    specs = {
        column: scenario_column_spec(
            column=column,
            header=headers[column],
            model_start=model_start,
            model_end=model_end,
        )
        for column in comparison_columns
    }

    materials = [
        material
        for material in (scenario.get("materials") or [])
        if _material_key(material.get("material"))
    ]
    by_key: dict[str, dict] = {}
    rows: list[dict] = []

    for material in materials:
        key = _material_key(material.get("material"))
        if key in by_key:
            raise ValueError(
                "O cenário ORION contém materiais duplicados após a normalização. "
                "A projeção foi interrompida para impedir divergência entre Dashboard e Excel."
            )
        projected = {
            "key": key,
            "material": material,
            "values": {
                column: scenario_material_value(material, spec)
                for column, spec in specs.items()
                if spec["supported"]
            },
        }
        rows.append(projected)
        by_key[key] = projected

    totals = {
        column: aggregate(
            [row["values"].get(column) for row in rows],
            spec["kind"],
        )
        for column, spec in specs.items()
        if spec["supported"]
    }

    return {
        "scenario_id": scenario.get("scenario_id"),
        "reference_month": scenario.get("reference_month"),
        "model_start": model_start,
        "model_end": model_end,
        "columns": comparison_columns,
        "specs": specs,
        "rows": rows,
        "by_key": by_key,
        "totals": totals,
    }
