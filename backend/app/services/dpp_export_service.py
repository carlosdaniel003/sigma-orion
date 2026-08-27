from __future__ import annotations

from collections.abc import Callable
from copy import copy
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook

from app.services.dpp_consolidation_service import _material_key
from app.services.dpp_monthly_base import (
    SOURCE_SHEET,
    _find_column,
    _find_header_row,
    _find_label_row,
    _headers,
    _normalize,
)
from app.services.dpp_scenario_service import get_monthly_scenario

SUPPORTED_EXTENSIONS = {".xlsx", ".xlsm"}
ProgressCallback = Callable[[int, str], None]


def _notify(progress: ProgressCallback | None, value: int, activity: str) -> None:
    if progress is not None:
        progress(value, activity)


def _number(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _find_any_column(headers: dict[int, str], *names: str) -> int | None:
    normalized = {_normalize(name) for name in names}
    for column, value in headers.items():
        if _normalize(value) in normalized:
            return column
    return None


def _output_name(reference_month: str, extension: str) -> str:
    year, month = (reference_month.split("-") + ["", ""])[:2]
    if year and month:
        return f"DPP_ORION_{year}_{month}{extension}"
    return f"DPP_ORION{extension}"


def _set_recalculation(workbook) -> None:
    calculation = getattr(workbook, "calculation", None)
    if calculation is None:
        return
    if hasattr(calculation, "calcMode"):
        calculation.calcMode = "auto"
    if hasattr(calculation, "fullCalcOnLoad"):
        calculation.fullCalcOnLoad = True
    if hasattr(calculation, "forceFullCalc"):
        calculation.forceFullCalc = True


def _copy_row_layout(sheet, source_row: int, target_row: int) -> None:
    source_dimension = sheet.row_dimensions[source_row]
    target_dimension = sheet.row_dimensions[target_row]
    target_dimension.height = source_dimension.height
    target_dimension.hidden = source_dimension.hidden
    target_dimension.outlineLevel = source_dimension.outlineLevel

    for column in range(1, sheet.max_column + 1):
        source = sheet.cell(source_row, column)
        target = sheet.cell(target_row, column)
        if source.has_style:
            target._style = copy(source._style)
        if source.number_format:
            target.number_format = source.number_format
        if source.alignment:
            target.alignment = copy(source.alignment)
        if source.protection:
            target.protection = copy(source.protection)


def _allocate_missing_material_rows(
    sheet,
    *,
    header_row: int,
    material_col: int,
    scenario_material_keys: list[str],
) -> dict[str, int]:
    template_rows: dict[str, int] = {}
    for row in range(header_row + 1, sheet.max_row + 1):
        key = _material_key(sheet.cell(row, material_col).value)
        if key:
            template_rows[key] = row

    missing = [key for key in scenario_material_keys if key not in template_rows]
    if not missing:
        return template_rows

    last_material_row = max(template_rows.values(), default=header_row + 1)
    style_source_row = last_material_row if last_material_row > header_row else header_row + 1

    for key in missing:
        target_row = last_material_row + 1
        sheet.insert_rows(target_row, 1)
        _copy_row_layout(sheet, style_source_row, target_row)
        template_rows[key] = target_row
        last_material_row = target_row

    return template_rows


def _write_orion_scenario_to_dpp(
    workbook,
    scenario: dict,
    progress: ProgressCallback | None = None,
) -> None:
    _notify(progress, 18, "Lendo estrutura da aba DPP")
    if SOURCE_SHEET not in workbook.sheetnames:
        raise ValueError("O DPP do mês anterior usado como modelo não possui a aba 'DPP'.")

    sheet = workbook[SOURCE_SHEET]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise ValueError("A aba 'DPP' do arquivo-base está vazia.")

    header_row = _find_header_row(rows)
    headers = _headers(rows, header_row)

    material_col = _find_column(headers, "Material")
    description_col = _find_column(headers, "Descrição")
    um_col = _find_column(headers, "UM")
    origin_col = _find_column(headers, "Grupo Origem")
    check_col = _find_column(headers, "Check", required=False)
    optional_col = _find_column(headers, "OPC", required=False)

    stock_sap_col = _find_any_column(headers, "STK SAP", "STK SAP TOTAL")
    explosion_col = _find_any_column(headers, "Explosão", "EXPLOSAO", "Explosão de Placas")
    stock_op_col = _find_any_column(headers, "STK OP", "STK OPC", "STK OPCS")
    stock_total_col = _find_any_column(headers, "STK TTL", "STK TOTAL")
    nec_col = _find_any_column(headers, "NEC", "NECESSIDADE")
    balance_col = _find_any_column(headers, "SALDO", "BALANCE")

    kit_row = _find_label_row(rows, header_row, "KIT Disponivel PGD", contains=True)
    real_row = _find_label_row(rows, header_row, "REAL")
    if kit_row is None or real_row is None:
        raise ValueError("O layout do DPP do mês anterior não contém as linhas KIT Disponível PGD e REAL esperadas.")

    model_end = (check_col - 1) if check_col else origin_col
    if model_end < origin_col + 1:
        raise ValueError("Não foi possível localizar as colunas de modelos no layout do DPP do mês anterior.")

    _notify(progress, 24, "Mapeando modelos no layout do Excel")
    scenario_models = {
        _normalize(model.get("name")): model
        for model in scenario.get("models", [])
        if model.get("name")
    }
    template_model_columns = [
        column
        for column in range(origin_col + 1, model_end + 1)
        if sheet.cell(header_row, column).value not in (None, "")
    ]
    model_columns: dict[int, dict | None] = {}
    total_model_columns = max(len(template_model_columns), 1)
    last_model_progress = -1
    for index, column in enumerate(template_model_columns, start=1):
        template_name = sheet.cell(header_row, column).value
        model = scenario_models.get(_normalize(template_name))
        model_columns[column] = model
        sheet.cell(kit_row, column).value = _number(model.get("kit_pgd")) if model else 0.0
        sheet.cell(real_row, column).value = _number(model.get("real")) if model else 0.0

        current_progress = 24 + int((index / total_model_columns) * 10)
        if current_progress != last_model_progress:
            _notify(progress, current_progress, f"Preenchendo KIT e REAL · {index}/{len(template_model_columns)} modelos")
            last_model_progress = current_progress

    _notify(progress, 36, "Preparando linhas de materiais")
    scenario_materials = {
        _material_key(material.get("material")): material
        for material in scenario.get("materials", [])
        if _material_key(material.get("material"))
    }
    template_material_rows = _allocate_missing_material_rows(
        sheet,
        header_row=header_row,
        material_col=material_col,
        scenario_material_keys=list(scenario_materials),
    )

    _notify(progress, 38, "Preenchendo dados calculados pelo ORION")
    total_material_rows = max(len(template_material_rows), 1)
    last_material_progress = -1
    for index, (key, row) in enumerate(template_material_rows.items(), start=1):
        material = scenario_materials.get(key)
        if material is None:
            # O arquivo anterior é apenas molde. Linhas históricas que não pertencem ao cenário atual
            # não podem manter valores operacionais do mês passado.
            for column in model_columns:
                sheet.cell(row, column).value = 0.0
            for column in (
                check_col,
                optional_col,
                stock_sap_col,
                explosion_col,
                stock_op_col,
                stock_total_col,
                nec_col,
                balance_col,
            ):
                if column:
                    sheet.cell(row, column).value = None
        else:
            sheet.cell(row, material_col).value = material.get("material")
            sheet.cell(row, description_col).value = material.get("description")
            sheet.cell(row, um_col).value = material.get("um")
            sheet.cell(row, origin_col).value = material.get("group_origin")

            consumption = material.get("consumption_by_model") or {}
            normalized_consumption = {_normalize(name): _number(value) for name, value in consumption.items()}
            for column, model in model_columns.items():
                model_name = _normalize(model.get("name")) if model else _normalize(sheet.cell(header_row, column).value)
                sheet.cell(row, column).value = normalized_consumption.get(model_name, 0.0)

            if check_col:
                sheet.cell(row, check_col).value = material.get("check") or material.get("status")
            if optional_col:
                sheet.cell(row, optional_col).value = material.get("optional_material")
            if stock_sap_col:
                sheet.cell(row, stock_sap_col).value = _number(material.get("stock_sap_effective", material.get("stock_sap")))
            if explosion_col:
                sheet.cell(row, explosion_col).value = _number(material.get("explosion"))
            if stock_op_col:
                sheet.cell(row, stock_op_col).value = _number(material.get("stock_op"))
            if stock_total_col:
                sheet.cell(row, stock_total_col).value = _number(material.get("stock_total"))
            if nec_col:
                sheet.cell(row, nec_col).value = _number(material.get("nec"))
            if balance_col:
                sheet.cell(row, balance_col).value = _number(material.get("balance"))

        current_progress = 38 + int((index / total_material_rows) * 50)
        if current_progress != last_material_progress:
            _notify(progress, current_progress, f"Preenchendo materiais · {index}/{len(template_material_rows)}")
            last_material_progress = current_progress

    _notify(progress, 90, "Configurando recálculo das fórmulas")
    _set_recalculation(workbook)


def export_monthly_scenario_excel(
    *,
    scenario_id: str,
    template_content: bytes,
    template_filename: str,
    progress: ProgressCallback | None = None,
) -> tuple[bytes, str, str]:
    _notify(progress, 4, "Validando cenário ORION")
    scenario = get_monthly_scenario(scenario_id)
    if scenario is None:
        raise ValueError("Cenário ORION não encontrado ou expirado. Gere o cenário mensal novamente.")

    _notify(progress, 8, "Validando DPP do mês anterior")
    extension = Path(template_filename or "dpp.xlsx").suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError("Use como modelo o DPP do mês anterior em formato .xlsx ou .xlsm.")
    if not template_content:
        raise ValueError("O DPP do mês anterior usado como modelo está vazio.")

    keep_vba = extension == ".xlsm"
    _notify(progress, 12, "Abrindo workbook do mês anterior")
    workbook = load_workbook(BytesIO(template_content), data_only=False, keep_vba=keep_vba)
    _notify(progress, 16, "Workbook carregado")
    try:
        _write_orion_scenario_to_dpp(workbook, scenario, progress=progress)
        _notify(progress, 94, "Serializando workbook para Excel")
        output = BytesIO()
        workbook.save(output)
        _notify(progress, 99, "Finalizando arquivo para download")
    finally:
        workbook.close()

    media_type = (
        "application/vnd.ms-excel.sheet.macroEnabled.12"
        if keep_vba
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return output.getvalue(), _output_name(scenario.get("reference_month") or "", extension), media_type
