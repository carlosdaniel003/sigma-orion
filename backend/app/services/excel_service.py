from io import BytesIO
from pathlib import Path

import pandas as pd
from fastapi import UploadFile

SUPPORTED_EXTENSIONS = {".xlsx", ".csv"}


async def inspect_uploaded_file(file: UploadFile) -> dict:
    filename = file.filename or "arquivo"
    extension = Path(filename).suffix.lower()

    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Formato '{extension or 'sem extensão'}' não suportado. "
            "Use arquivos .xlsx ou .csv neste MVP."
        )

    content = await file.read()
    buffer = BytesIO(content)

    if extension == ".csv":
        dataframe = pd.read_csv(buffer)
        return {
            "filename": filename,
            "extension": extension,
            "sheets": [
                {
                    "name": "CSV",
                    "rows": int(len(dataframe.index)),
                    "columns": [str(column) for column in dataframe.columns],
                }
            ],
        }

    workbook = pd.ExcelFile(buffer, engine="openpyxl")
    sheets = []

    for sheet_name in workbook.sheet_names:
        dataframe = pd.read_excel(workbook, sheet_name=sheet_name)
        sheets.append(
            {
                "name": sheet_name,
                "rows": int(len(dataframe.index)),
                "columns": [str(column) for column in dataframe.columns],
            }
        )

    return {
        "filename": filename,
        "extension": extension,
        "sheets": sheets,
    }
