from __future__ import annotations

from collections import OrderedDict
from io import BytesIO
import math
from pathlib import Path
import re
import unicodedata

from fastapi import UploadFile
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

SUPPORTED_EXTENSIONS = {".xlsx", ".xlsm"}
WIU_SOURCE_SHEET = "POWER"
WIU_MATRIX_SHEET = "WIU JULHO"
EXPLOSION_SOURCE_SHEET = "CONSOLIDADO"
STOCK_SOURCE_SHEET = "CONSOLIDADO"


def _normalize(value: object) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value).strip().lower())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text)


def _text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value: object, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else default

    text = str(value).strip().replace(" ", "")
    if not text:
        return default
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        number = float(text)
    except ValueError:
        return default
    return number if math.isfinite(number) else default


def _validate_upload(file: UploadFile, label: str) -> None:
    filename = file.filename or ""
    extension = Path(filename).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"{label}: envie um arquivo .xlsx ou .xlsm.")


def _headers(row: tuple) -> dict[int, str]:
    return {
        index: str(value).strip()
        for index, value in enumerate(row, start=1)
        if value not in (None, "")
    }


def _find_column(headers: dict[int, str], name: str) -> int:
    target = _normalize(name)
    for column, value in headers.items():
        if _normalize(value) == target:
            return column
    raise ValueError(f"Coluna obrigatória '{name}' não encontrada.")


def _find_column_startswith(headers: dict[int, str], prefix: str) -> int:
    target = _normalize(prefix)
    for column, value in headers.items():
        if _normalize(value).startswith(target):
            return column
    raise ValueError(f"Coluna iniciada por '{prefix}' não encontrada.")


def _value(row: tuple, column: int) -> object:
    if column < 1 or column > len(row):
        return None
    return row[column - 1]


def _read_sheet(content: bytes, sheet_name: str) -> list[tuple]:
    workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    if sheet_name not in workbook.sheetnames:
        workbook.close()
        raise ValueError(f"A aba '{sheet_name}' não foi encontrada.")
    sheet = workbook[sheet_name]
    rows = list(sheet.iter_rows(values_only=True))
    workbook.close()
    if not rows:
        raise ValueError(f"A aba '{sheet_name}' está vazia.")
    return rows


def _read_model_order(content: bytes) -> list[dict]:
    workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
    if WIU_MATRIX_SHEET not in workbook.sheetnames:
        workbook.close()
        return []

    sheet = workbook[WIU_MATRIX_SHEET]
    first_two = []
    for row in sheet.iter_rows(min_row=1, max_row=2, values_only=True):
        first_two.append(tuple(row))
    workbook.close()
    if len(first_two) < 2:
        return []

    code_row, name_row = first_two
    models = []
    for column in range(5, max(len(code_row), len(name_row)) + 1):
        name = _text(_value(name_row, column))
        code = _text(_value(code_row, column))
        if not name or not code:
            continue
        models.append(
            {
                "name": name,
                "code": code,
                "column": get_column_letter(column),
            }
        )
    return models


def _parse_wiu(content: bytes) -> tuple[list[dict], list[dict], dict]:
    rows = _read_sheet(content, WIU_SOURCE_SHEET)
    headers = _headers(rows[0])

    code_col = _find_column(headers, "Código")
    model_col = _find_column(headers, "Modelo")
    material_col = _find_column(headers, "Componente")
    description_col = _find_column(headers, "Descrição")
    usage_col = _find_column(headers, "Uso BOM")
    um_col = _find_column(headers, "Unidade de Medida")
    origin_col = _find_column(headers, "Grupo Origem")

    model_order = _read_model_order(content)
    model_meta: OrderedDict[str, dict] = OrderedDict(
        (item["name"], dict(item)) for item in model_order
    )
    materials: OrderedDict[str, dict] = OrderedDict()
    imported_source_rows = 0
    national_source_rows = 0

    for excel_row, row in enumerate(rows[1:], start=2):
        material = _text(_value(row, material_col))
        model = _text(_value(row, model_col))
        origin = _text(_value(row, origin_col))
        if not material or not model:
            continue

        if _normalize(origin) != "importado":
            national_source_rows += 1
            continue
        imported_source_rows += 1

        model_code = _text(_value(row, code_col))
        if model not in model_meta:
            model_meta[model] = {
                "name": model,
                "code": model_code,
                "column": None,
            }
        elif not model_meta[model].get("code") and model_code:
            model_meta[model]["code"] = model_code

        current = materials.setdefault(
            material,
            {
                "material": material,
                "description": _text(_value(row, description_col)),
                "um": _text(_value(row, um_col)),
                "group_origin": origin or "Importado",
                "consumption_by_model": {},
                "wiu_first_row": excel_row,
                "wiu_occurrences": 0,
            },
        )
        current["wiu_occurrences"] += 1
        if not current.get("description"):
            current["description"] = _text(_value(row, description_col))
        if not current.get("um"):
            current["um"] = _text(_value(row, um_col))

        usage = _number(_value(row, usage_col), 0.0)
        if usage:
            current["consumption_by_model"][model] = (
                current["consumption_by_model"].get(model, 0.0) + usage
            )

    model_names = list(model_meta.keys())
    for material in materials.values():
        used_models = [
            model for model in model_names
            if abs(material["consumption_by_model"].get(model, 0.0)) > 1e-12
        ]
        material["used_models"] = used_models
        material["check"] = "// ".join(used_models)
        material["source"] = {
            "sheet": WIU_SOURCE_SHEET,
            "first_row": material.pop("wiu_first_row"),
            "occurrences": material.pop("wiu_occurrences"),
            "material_column": get_column_letter(material_col),
        }

    material_count_by_model = {name: 0 for name in model_names}
    for material in materials.values():
        for model in material["used_models"]:
            material_count_by_model[model] += 1

    models = []
    for item in model_meta.values():
        models.append(
            {
                **item,
                "material_count": material_count_by_model.get(item["name"], 0),
            }
        )

    diagnostics = {
        "sheet": WIU_SOURCE_SHEET,
        "source_rows": max(len(rows) - 1, 0),
        "imported_source_rows": imported_source_rows,
        "excluded_non_imported_rows": national_source_rows,
        "imported_materials": len(materials),
        "models": len(models),
    }
    return list(materials.values()), models, diagnostics


def _parse_explosion(content: bytes) -> tuple[dict[str, dict], dict]:
    rows = _read_sheet(content, EXPLOSION_SOURCE_SHEET)
    headers = _headers(rows[0])
    material_col = _find_column(headers, "Material")
    description_col = _find_column(headers, "Descrição")
    um_col = _find_column(headers, "UM")
    explosion_col = _find_column_startswith(headers, "EXPLOSÃO")

    result: dict[str, dict] = {}
    for excel_row, row in enumerate(rows[1:], start=2):
        material = _text(_value(row, material_col))
        if not material:
            continue
        result[material] = {
            "value": _number(_value(row, explosion_col), 0.0),
            "description": _text(_value(row, description_col)),
            "um": _text(_value(row, um_col)),
            "source": {
                "sheet": EXPLOSION_SOURCE_SHEET,
                "row": excel_row,
                "cell": f"{get_column_letter(explosion_col)}{excel_row}",
            },
        }

    return result, {
        "sheet": EXPLOSION_SOURCE_SHEET,
        "rows": len(result),
        "value_header": headers[explosion_col],
    }


def _parse_stock(content: bytes) -> tuple[dict[str, dict], dict]:
    rows = _read_sheet(content, STOCK_SOURCE_SHEET)
    headers = _headers(rows[0])
    material_col = _find_column(headers, "Material")
    stock_col = _find_column_startswith(headers, "STK TTL")

    result: dict[str, dict] = {}
    for excel_row, row in enumerate(rows[1:], start=2):
        material = _text(_value(row, material_col))
        if not material:
            continue
        result[material] = {
            "value": _number(_value(row, stock_col), 0.0),
            "source": {
                "sheet": STOCK_SOURCE_SHEET,
                "row": excel_row,
                "cell": f"{get_column_letter(stock_col)}{excel_row}",
            },
        }

    return result, {
        "sheet": STOCK_SOURCE_SHEET,
        "rows": len(result),
        "value_header": headers[stock_col],
    }


async def consolidate_dpp_sources(
    wiu: UploadFile,
    explosion: UploadFile,
    stock: UploadFile | None = None,
) -> dict:
    _validate_upload(wiu, "WIU")
    _validate_upload(explosion, "Explosão")
    if stock is not None:
        _validate_upload(stock, "STK SAP")

    wiu_content = await wiu.read()
    explosion_content = await explosion.read()
    stock_content = await stock.read() if stock is not None else None
    if not wiu_content:
        raise ValueError("O arquivo WIU está vazio.")
    if not explosion_content:
        raise ValueError("O arquivo de Explosão está vazio.")
    if stock is not None and not stock_content:
        raise ValueError("O arquivo de STK SAP está vazio.")

    materials, models, wiu_diagnostics = _parse_wiu(wiu_content)
    explosion_map, explosion_diagnostics = _parse_explosion(explosion_content)
    stock_map: dict[str, dict] = {}
    stock_diagnostics = None
    if stock_content:
        stock_map, stock_diagnostics = _parse_stock(stock_content)

    explosion_matches = 0
    stock_matches = 0
    explosion_only_materials = set(explosion_map)
    stock_only_materials = set(stock_map)

    for material in materials:
        code = material["material"]
        explosion_entry = explosion_map.get(code)
        if explosion_entry:
            explosion_matches += 1
            explosion_only_materials.discard(code)
        material["explosion"] = explosion_entry["value"] if explosion_entry else 0.0
        material["explosion_source"] = explosion_entry["source"] if explosion_entry else None

        if stock_content is not None:
            stock_entry = stock_map.get(code)
            if stock_entry:
                stock_matches += 1
                stock_only_materials.discard(code)
            material["stock_sap"] = stock_entry["value"] if stock_entry else 0.0
            material["stock_source"] = stock_entry["source"] if stock_entry else None
            material["available_base"] = material["stock_sap"] + material["explosion"]
        else:
            material["stock_sap"] = None
            material["stock_source"] = None
            material["available_base"] = None

        material["nec"] = None
        material["balance"] = None
        material["status"] = "ESTRUTURA_PRONTA" if stock_content is None else "ESTOQUE_BASE_PRONTO"

    materials.sort(key=lambda item: item["material"])

    source_status = [
        {
            "id": "wiu",
            "label": "WIU",
            "required": True,
            "loaded": True,
            "filename": wiu.filename,
            "detail": f"{len(materials)} materiais importados · {len(models)} modelos",
        },
        {
            "id": "explosion",
            "label": "Explosão de Placas",
            "required": True,
            "loaded": True,
            "filename": explosion.filename,
            "detail": f"{explosion_matches} materiais do WIU com registro no consolidado de explosão",
        },
        {
            "id": "stock",
            "label": "STK SAP (1º dia do mês)",
            "required": False,
            "loaded": stock_content is not None,
            "filename": stock.filename if stock is not None else None,
            "detail": (
                f"{stock_matches} materiais do WIU encontrados no STK"
                if stock_content is not None
                else "Aguardando o snapshot mensal do SAP"
            ),
        },
    ]

    pending = []
    if stock_content is None:
        pending.append("STK SAP para compor a disponibilidade inicial de estoque")
    pending.extend(
        [
            "KIT PGD / REAL para calcular NEC e SALDO de produção",
            "OPC/STK OP para fechar integralmente materiais opcionais quando aplicável",
        ]
    )

    return {
        "mode": "source_consolidation",
        "status": "PARCIAL" if pending else "COMPLETO",
        "scope": (
            "Consolidação construída a partir das fontes mensais. Nesta etapa o WIU define a estrutura "
            "Material × Modelo e a Explosão preenche o consumo/explosão consolidado. O STK SAP pode ser "
            "anexado quando disponível. NEC e SALDO permanecem indisponíveis até existir a fonte/regra de REAL/KIT PGD."
        ),
        "sources": source_status,
        "summary": {
            "materials": len(materials),
            "models": len(models),
            "explosion_matches": explosion_matches,
            "explosion_without_wiu": len(explosion_only_materials),
            "stock_loaded": stock_content is not None,
            "stock_matches": stock_matches if stock_content is not None else 0,
            "stock_without_wiu": len(stock_only_materials) if stock_content is not None else 0,
        },
        "capabilities": {
            "material_model_matrix": True,
            "check_from_wiu": True,
            "explosion": True,
            "stock_sap": stock_content is not None,
            "available_base": stock_content is not None,
            "nec": False,
            "balance": False,
        },
        "pending": pending,
        "diagnostics": {
            "wiu": wiu_diagnostics,
            "explosion": explosion_diagnostics,
            "stock": stock_diagnostics,
        },
        "models": models,
        "materials": materials,
    }
