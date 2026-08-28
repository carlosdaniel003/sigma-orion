from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import UploadFile
from openpyxl import load_workbook

from app.services.dpp_consolidation_service import _material_key
from app.services.dpp_projection_service import (
    aggregate,
    build_orion_projection,
    column_values_equal,
)
from app.services.dpp_scenario_service import get_latest_monthly_scenario
from app.services.dpp_service import (
    SOURCE_SHEET,
    SUPPORTED_DPP_EXTENSIONS,
    VALIDATION_ABS_TOL,
    _as_text,
    _cell,
    _find_column,
    _find_header_row,
    _find_label_row,
    _headers,
    _normalize,
    _number,
)


def _build_column_comparison(
    *,
    rows: list[tuple],
    headers: dict[int, str],
    header_row: int,
    material_col: int,
    origin_col: int,
    check_col: int,
    scenario: dict,
) -> dict:
    projection = build_orion_projection(
        scenario=scenario,
        headers=headers,
        material_col=material_col,
        origin_col=origin_col,
        check_col=check_col,
    )

    final_material_rows: list[tuple[str, int]] = []
    final_row_by_material: dict[str, int] = {}
    for excel_row in range(header_row + 1, len(rows) + 1):
        raw_material = _cell(rows, excel_row, material_col)
        key = _material_key(raw_material)
        if not key:
            continue
        final_material_rows.append((key, excel_row))
        final_row_by_material[key] = excel_row

    columns: list[dict] = []
    divergent_columns = 0
    comparable_columns = 0

    for column in projection["columns"]:
        header = headers[column]
        spec = projection["specs"][column]
        kind = spec["kind"]
        final_values = [_cell(rows, excel_row, column) for _, excel_row in final_material_rows]
        final_total = aggregate(final_values, kind)

        item = {
            "name": header,
            "column": column,
            "kind": kind,
            "aggregation_label": "itens preenchidos" if kind == "count" else "soma",
            "final_total": final_total,
            "orion_total": None,
            "delta": None,
            "difference_count": None,
            "supported": bool(spec["supported"]),
        }

        if not spec["supported"]:
            item["note"] = "Ainda não calculado pelo cenário ORION."
            columns.append(item)
            continue

        comparable_columns += 1
        orion_total = projection["totals"][column]
        delta = final_total - orion_total

        differences = 0
        all_material_keys = set(final_row_by_material) | set(projection["by_key"])
        for material_key in all_material_keys:
            final_row = final_row_by_material.get(material_key)
            projected_row = projection["by_key"].get(material_key)
            if final_row is None or projected_row is None:
                differences += 1
                continue

            final_value = _cell(rows, final_row, column)
            orion_value = projected_row["values"].get(column)
            if not column_values_equal(final_value, orion_value, spec.get("comparison")):
                differences += 1

        item["orion_total"] = orion_total
        item["delta"] = delta
        item["difference_count"] = differences
        if differences > 0 or abs(float(delta)) > VALIDATION_ABS_TOL:
            divergent_columns += 1
        columns.append(item)

    return {
        "scenario_id": projection["scenario_id"],
        "reference_month": projection["reference_month"],
        "basis": "canonical_orion_projection",
        "columns_total": len(columns),
        "comparable_columns": comparable_columns,
        "divergent_columns": divergent_columns,
        "unsupported_columns": len(columns) - comparable_columns,
        "final_materials": len(final_material_rows),
        "orion_materials": len(projection["rows"]),
        "columns": columns,
    }


def summarize_final_dpp_content(
    content: bytes,
    filename: str = "dpp.xlsx",
    scenario: dict | None = None,
) -> dict:
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_DPP_EXTENSIONS:
        raise ValueError("Envie um DPP final em formato .xlsx ou .xlsm.")
    if not content:
        raise ValueError("O arquivo do DPP final está vazio.")

    workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    if SOURCE_SHEET not in workbook.sheetnames:
        workbook.close()
        raise ValueError("A aba 'DPP' não foi encontrada no DPP final.")

    sheet = workbook[SOURCE_SHEET]
    rows = list(sheet.iter_rows(values_only=True))
    workbook.close()
    if not rows:
        raise ValueError("A aba 'DPP' do arquivo final está vazia.")

    max_column = max(len(row) for row in rows)
    header_row = _find_header_row(rows, max_column)
    headers = _headers(rows, max_column, header_row)

    material_col = _find_column(headers, "Material")
    um_col = _find_column(headers, "UM")
    origin_col = _find_column(headers, "Grupo Origem")
    check_col = _find_column(headers, "Check")
    optional_col = _find_column(headers, "OPC")
    balance_col = _find_column(headers, "SALDO")

    model_start = origin_col + 1
    model_end = check_col - 1
    if model_end < model_start:
        raise ValueError("Não foi possível identificar os modelos do DPP final.")

    kit_row = _find_label_row(rows, max_column, header_row, "KIT Disponivel PGD", contains=True)
    real_row = _find_label_row(rows, max_column, header_row, "REAL")
    if real_row is None:
        raise ValueError("A linha REAL não foi encontrada no DPP final.")

    pgd_total = 0.0
    real_total = 0.0
    model_count = 0
    active_models = 0
    model_states: list[dict] = []

    for column in range(model_start, model_end + 1):
        model_name = _as_text(_cell(rows, header_row, column))
        if not model_name:
            continue

        model_count += 1
        pgd = max(_number(_cell(rows, kit_row, column), 0.0) or 0.0, 0.0) if kit_row else 0.0
        real = max(_number(_cell(rows, real_row, column), 0.0) or 0.0, 0.0)
        delta = real - pgd
        pgd_total += pgd
        real_total += real
        if real > 1e-9:
            active_models += 1

        model_states.append(
            {
                "name": model_name,
                "column": column,
                "pgd": pgd,
                "real": real,
                "delta": delta,
                "active": real > 1e-9,
                "changed": abs(delta) > 1e-9,
            }
        )

    total_materials = 0
    critical_materials = 0
    opc_count = 0
    shared_critical = 0
    risk_model_names: set[str] = set()
    critical_material_codes: set[str] = set()
    shared_critical_material_codes: set[str] = set()

    for excel_row in range(header_row + 1, len(rows) + 1):
        material = _as_text(_cell(rows, excel_row, material_col))
        if not material:
            continue
        total_materials += 1

        optional_material = _as_text(_cell(rows, excel_row, optional_col))
        if optional_material:
            opc_count += 1

        unit = _normalize(_cell(rows, excel_row, um_col)).upper()
        balance = _number(_cell(rows, excel_row, balance_col), None)
        if unit != "UN" or balance is None or balance >= -1e-4:
            continue

        critical_materials += 1
        critical_material_codes.add(material)
        affected_models = []
        for model in model_states:
            if not model["active"]:
                continue
            usage = _number(_cell(rows, excel_row, model["column"]), 0.0) or 0.0
            if usage > 1e-9:
                affected_models.append(model["name"])
                risk_model_names.add(model["name"])

        if len(affected_models) > 1:
            shared_critical += 1
            shared_critical_material_codes.add(material)

    for model in model_states:
        model["at_risk"] = model["name"] in risk_model_names
        model.pop("column", None)

    risk_models = len(risk_model_names)
    safe_models = max(active_models - risk_models, 0)
    material_coverage = (safe_models / active_models * 100.0) if active_models else 0.0
    pgd_exposed = sum(
        model["pgd"]
        for model in model_states
        if model["name"] in risk_model_names
    )
    changed_models = sum(1 for model in model_states if model["changed"])
    below_pgd_models = sum(1 for model in model_states if model["delta"] < -1e-9)
    above_pgd_models = sum(1 for model in model_states if model["delta"] > 1e-9)

    column_comparison = None
    if scenario is not None:
        column_comparison = _build_column_comparison(
            rows=rows,
            headers=headers,
            header_row=header_row,
            material_col=material_col,
            origin_col=origin_col,
            check_col=check_col,
            scenario=scenario,
        )

    return {
        "filename": filename,
        "status": "DPP_FINAL",
        "models": model_states,
        "critical_materials": sorted(critical_material_codes),
        "shared_critical_materials": sorted(shared_critical_material_codes),
        "column_comparison": column_comparison,
        "summary": {
            "pgd_total": pgd_total,
            "real_total": real_total,
            "model_count": model_count,
            "active_models": active_models,
            "changed_models": changed_models,
            "below_pgd_models": below_pgd_models,
            "above_pgd_models": above_pgd_models,
            "total_materials": total_materials,
            "critical_materials": critical_materials,
            "opc_count": opc_count,
            "risk_models": risk_models,
            "safe_models": safe_models,
            "material_coverage": material_coverage,
            "pgd_exposed": pgd_exposed,
            "shared_critical": shared_critical,
        },
    }


async def summarize_final_dpp(file: UploadFile) -> dict:
    filename = file.filename or "dpp.xlsx"
    content = await file.read()
    return summarize_final_dpp_content(
        content,
        filename,
        scenario=get_latest_monthly_scenario(),
    )
