"""Workbook audit sheet for confirmed additional stock in an approved DPP.

Raw SAP and optional stock columns stay unchanged. Only approved quantities
are referred to from STK TTL; other canonical formulas remain intact.
"""
from __future__ import annotations

SHEET_NAME = "ORION_CONFIRMACOES"


def append_approved_stock(formula: str, *, material: dict | None, material_ref: str) -> str:
    if not material or float(material.get("approved_gap_added_stock") or 0.0) <= 1e-9:
        return formula
    return (
        formula + f'+IFERROR(VLOOKUP({material_ref},\'{SHEET_NAME}\'!$A:$D,4,FALSE),0)'
    )


def write_approved_gap_sheet(workbook, scenario: dict) -> None:
    approval = scenario.get("gap_approval")
    if not approval:
        return
    if SHEET_NAME in workbook.sheetnames:
        sheet = workbook[SHEET_NAME]
        sheet.delete_rows(1, sheet.max_row)
    else:
        sheet = workbook.create_sheet(SHEET_NAME)
    sheet.sheet_state = "hidden"
    headers = (
        "Material", "Disponível Estoque (validado)", "Liberado CQ (validado)",
        "Total adicional DPP", "SALDO original", "Indisponível justificado",
        "CQ justificado", "Cenário origem", "STK SHA256", "Aplicado em UTC",
    )
    for col, header in enumerate(headers, 1):
        sheet.cell(1, col, header)
    materials = [
        m for m in scenario.get("materials") or []
        if any(float(m.get(k) or 0) > 0 for k in (
            "approved_gap_stock", "approved_gap_cq",
            "approved_gap_justified_stock", "approved_gap_justified_cq"
        ))
    ]
    for i, item in enumerate(materials, start=2):
        material = sheet.cell(i, 1)
        material.value = str(item["material"])
        material.data_type = "s"
        sheet.cell(i, 2, float(item.get("approved_gap_stock") or 0.0))
        sheet.cell(i, 3, float(item.get("approved_gap_cq") or 0.0))
        sheet.cell(i, 4, f"=B{i}+C{i}")
        sheet.cell(i, 5, float(item.get("approved_gap_original_balance") or 0.0))
        sheet.cell(i, 6, float(item.get("approved_gap_justified_stock") or 0.0))
        sheet.cell(i, 7, float(item.get("approved_gap_justified_cq") or 0.0))
        sheet.cell(i, 8, approval["original_scenario_id"])
        sheet.cell(i, 9, approval["stock_sha256"])
        sheet.cell(i, 10, approval["approved_at_utc"])
