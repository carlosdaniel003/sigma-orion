from __future__ import annotations

from io import BytesIO
from pathlib import Path

from fastapi import UploadFile
from openpyxl import load_workbook

from app.services.dpp_service import (
    SOURCE_SHEET,
    SUPPORTED_DPP_EXTENSIONS,
    _as_text,
    _cell,
    _find_column,
    _find_header_row,
    _find_label_row,
    _headers,
    _normalize,
    _number,
)


def summarize_final_dpp_content(content: bytes, filename: str = "dpp.xlsx") -> dict:
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

    for column in range(model_start, model_end + 1):
        model_name = _as_text(_cell(rows, header_row, column))
        if not model_name:
            continue
        model_count += 1
        pgd_total += max(_number(_cell(rows, kit_row, column), 0.0) or 0.0, 0.0) if kit_row else 0.0
        real = max(_number(_cell(rows, real_row, column), 0.0) or 0.0, 0.0)
        real_total += real
        if real > 1e-9:
            active_models += 1

    total_materials = 0
    critical_materials = 0
    opc_count = 0

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
        if unit == "UN" and balance is not None and balance < -1e-4:
            critical_materials += 1

    return {
        "filename": filename,
        "status": "DPP_FINAL",
        "summary": {
            "pgd_total": pgd_total,
            "real_total": real_total,
            "model_count": model_count,
            "active_models": active_models,
            "total_materials": total_materials,
            "critical_materials": critical_materials,
            "opc_count": opc_count,
        },
    }


async def summarize_final_dpp(file: UploadFile) -> dict:
    filename = file.filename or "dpp.xlsx"
    content = await file.read()
    return summarize_final_dpp_content(content, filename)
