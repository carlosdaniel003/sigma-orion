from io import BytesIO

from openpyxl import Workbook, load_workbook
from openpyxl.styles import PatternFill

from app.services.dpp_export_service import export_monthly_scenario_excel
from app.services.dpp_scenario_service import register_monthly_scenario


def _template_workbook() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "DPP"

    sheet["A1"] = "KIT Disponivel PGD (JULHO)"
    sheet["E1"] = 999
    sheet["F1"] = 999
    sheet["A2"] = "REAL"
    sheet["E2"] = 999
    sheet["F2"] = 999
    sheet.append([])
    sheet.append([
        "Material",
        "Descrição",
        "UM",
        "Grupo Origem",
        "MODELO A",
        "MODELO B",
        "Check",
        "OPC",
        "STK SAP",
        "Explosão",
        "STK OP",
        "STK TTL",
        "NEC",
        "SALDO",
    ])
    sheet.append([
        "1001",
        "Descrição final que deve ser substituída",
        "UN",
        "FINAL",
        99,
        99,
        "FINAL",
        "FINAL-OPC",
        999,
        999,
        999,
        999,
        999,
        999,
    ])

    sheet["A4"].fill = PatternFill(fill_type="solid", fgColor="123456")
    sheet.column_dimensions["A"].width = 18
    workbook.create_sheet("Resumo de Análise")["A1"] = "Layout preservado"

    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def _scenario_id() -> str:
    scenario = register_monthly_scenario(
        materials=[
            {
                "material": "1001",
                "material_key": "1001",
                "description": "Material ORION",
                "um": "UN",
                "group_origin": "LOCAL",
                "optional_material": "OPC-01",
                "check": "OK",
                "consumption_by_model": {"MODELO A": 2, "MODELO B": 0.5},
                "stock_sap": 40,
                "stock_sap_effective": 40,
                "explosion": 5,
                "stock_op": 5,
                "stock_total": 50,
            }
        ],
        models=[
            {"name": "MODELO A", "code": "A-01", "kit_pgd": 10, "real": 10},
            {"name": "MODELO B", "code": "B-01", "kit_pgd": 20, "real": 20},
        ],
        reference_month="2026-07",
        base_summary={},
        scope="teste",
        capabilities={},
        sources=[],
        pending=[],
        diagnostics={},
        pgd_mapping={},
    )
    return scenario["scenario_id"]


def test_export_preserves_workbook_layout_and_replaces_final_values_with_orion_scenario():
    content, filename, media_type = export_monthly_scenario_excel(
        scenario_id=_scenario_id(),
        template_content=_template_workbook(),
        template_filename="DPP JUL_2026.xlsx",
    )

    assert filename == "DPP_ORION_2026_07.xlsx"
    assert media_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    workbook = load_workbook(BytesIO(content), data_only=False)
    try:
        assert workbook.sheetnames == ["DPP", "Resumo de Análise"]
        sheet = workbook["DPP"]

        assert sheet["E1"].value == 10
        assert sheet["F1"].value == 20
        assert sheet["E2"].value == 10
        assert sheet["F2"].value == 20

        assert sheet["B5"].value == "Material ORION"
        assert sheet["D5"].value == "LOCAL"
        assert sheet["E5"].value == 2
        assert sheet["F5"].value == 0.5
        assert sheet["H5"].value == "OPC-01"
        assert sheet["I5"].value == 40
        assert sheet["J5"].value == 5
        assert sheet["K5"].value == 5
        assert sheet["L5"].value == 50
        assert sheet["M5"].value == 30
        assert sheet["N5"].value == 20

        assert sheet["A4"].fill.fgColor.rgb.endswith("123456")
        assert sheet.column_dimensions["A"].width == 18
        assert workbook["Resumo de Análise"]["A1"].value == "Layout preservado"
    finally:
        workbook.close()
