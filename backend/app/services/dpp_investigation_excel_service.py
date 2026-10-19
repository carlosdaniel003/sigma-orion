"""Readable, auditable Excel exports for ORION stock and quality investigations.

Reports are snapshots of the generated ORION scenario and human investigation
history, not the finished DPP validation workbook and not an SAP movement.
All records are recalculated by the server before export.
"""
from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from math import isfinite

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DARK = "172A40"
MID = "264664"
ACCENT = "147B90"
PALE = "EDF4F8"
WHITE = "FFFFFF"
TEXT = "263849"
MUTED = "5D6E80"
GREEN = "E3F2E8"
YELLOW = "FFF3D5"
RED = "FCE9E7"
BLUE = "E4EFF8"
BORDER = "D8E2EA"
NUMFMT = '#,##0.###;[Red](#,##0.###);–'
# Identificadores técnicos não são rótulos do relatório.
STATUS_LABELS = {
    "FINISHED": "Finalizado",
    "QUALITY_4_2": "Encaminhar à Qualidade",
    "SCRAP_4_3": "Encaminhar a Scrap",
    "AWAITING_VALIDATION": "Aguardando validação de Estoque",
    "AWAITING_QUALITY": "Aguardando validação do CQ",
}
MARKER_COLORS = {
    "Finalizado": GREEN,
    "Encaminhar à Qualidade": YELLOW,
    "Encaminhar a Scrap": YELLOW,
    "Aguardando validação de Estoque": BLUE,
    "Aguardando validação do CQ": BLUE,
}


def _status_label(value):
    return STATUS_LABELS.get(value, value or "")


def _safe(value):
    """Prevent spreadsheet formula injection from uploaded cells/user comments."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if isinstance(value, (float, int)):
        return value if isfinite(value) else ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    if text and text.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + text
    if text.startswith(("\t", "\r", "\n")):
        return "'" + text
    return text


def _num(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None


def _source(scenario, source_id):
    source = next((item for item in scenario.get("sources") or [] if item.get("id") == source_id), None)
    return (source or {}).get("filename") or "Não identificado no cenário"


def _header(sheet, title, subtitle, columns, widths, *, note=None):
    count = len(columns)
    last = get_column_letter(count)
    sheet.sheet_view.showGridLines = False
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=count)
    title_cell = sheet.cell(1, 1, _safe(title))
    title_cell.fill = PatternFill("solid", fgColor=DARK)
    title_cell.font = Font(name="Aptos Display", bold=True, size=17, color=WHITE)
    title_cell.alignment = Alignment(vertical="center", indent=1)
    for cells in sheet.iter_rows(min_row=1, max_row=1, min_col=1, max_col=count):
        for cell in cells:
            cell.fill = PatternFill("solid", fgColor=DARK)
    sheet.row_dimensions[1].height = 38
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=count)
    sub = sheet.cell(2, 1, _safe(subtitle))
    sub.font = Font(name="Aptos", size=10, color=MUTED)
    sub.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
    sheet.row_dimensions[2].height = 38 if len(subtitle) > 115 else 28
    if note:
        sheet.merge_cells(start_row=3, start_column=1, end_row=3, end_column=count)
        warning = sheet.cell(3, 1, _safe(note))
        warning.font = Font(name="Aptos", size=10, color=MID, italic=True)
        warning.fill = PatternFill("solid", fgColor=BLUE)
        warning.alignment = Alignment(vertical="center", wrap_text=True, indent=1)
        sheet.row_dimensions[3].height = 40
    header_row = 5 if note else 4
    sheet.row_dimensions[header_row].height = 32
    for index, (label, width) in enumerate(zip(columns, widths), start=1):
        cell = sheet.cell(header_row, index, label)
        cell.font = Font(name="Aptos", bold=True, size=10, color=WHITE)
        cell.fill = PatternFill("solid", fgColor=MID)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = Border(bottom=Side(style="thin", color=ACCENT))
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = f"C{header_row + 1}" if count >= 3 else f"A{header_row + 1}"
    sheet.print_title_rows = f"1:{header_row}"
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
    # Não comprimir 14-18 colunas numa única página ilegível.
    sheet.page_setup.fitToWidth = 3 if count >= 14 else 2 if count >= 11 else 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.outlinePr.summaryBelow = True
    sheet.oddFooter.center.text = "ORION · Investigação / NÃO ALTERA O DPP"
    sheet.oddFooter.right.text = "Página &P de &N"
    return header_row


def _rows(sheet, headings, widths, rows, *, title, subtitle, note=None, status_column=None):
    header_row = _header(sheet, title, subtitle, headings, widths, note=note)
    number_cols = set()
    for index, row in enumerate(rows, start=header_row + 1):
        height = 26
        for col, raw in enumerate(row, start=1):
            val = _safe(raw)
            cell = sheet.cell(index, col, val)
            cell.fill = PatternFill("solid", fgColor=WHITE if (index - header_row) % 2 else PALE)
            cell.font = Font(name="Aptos", size=10, color=TEXT)
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            cell.border = Border(bottom=Side(style="hair", color=BORDER))
            if isinstance(val, (float, int)):
                cell.number_format = NUMFMT
                cell.alignment = Alignment(horizontal="right", vertical="center")
                number_cols.add(col)
            if status_column and col == status_column:
                marker = str(raw or "")
                if marker in MARKER_COLORS:
                    cell.fill = PatternFill("solid", fgColor=MARKER_COLORS[marker])
                    cell.font = Font(name="Aptos", size=10, color=TEXT, bold=True)
            if isinstance(val, str) and "\n" in val:
                height = max(height, min(62, 15 * (val.count("\n") + 1)))
        sheet.row_dimensions[index].height = height
    if not rows:
        cell = sheet.cell(header_row + 1, 1, "Nenhum registro para os critérios desta investigação.")
        cell.font = Font(name="Aptos", italic=True, color=MUTED)
        sheet.row_dimensions[header_row + 1].height = 28
    bottom = max(sheet.max_row, header_row + 1)
    sheet.auto_filter.ref = f"A{header_row}:{get_column_letter(len(headings))}{bottom}"
    sheet.print_options.horizontalCentered = True


def _summary(workbook, *, report, scenario, kind):
    summary = report.get("summary") or {}
    quality = kind == "quality"
    caption = "ANÁLISE DE QUALIDADE · Q239 / Q273" if quality else "DIVERGÊNCIA DE ESTOQUE · M221 / P277"
    sheet = workbook.create_sheet("Resumo")
    current = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    information = [
        ("Relatório", caption),
        ("Mês do cenário ORION", report.get("reference_month") or scenario.get("reference_month") or ""),
        ("Cenário", report.get("scenario_id") or scenario.get("scenario_id") or ""),
        ("Gerado em", current),
        ("Fonte dos depósitos", report.get("source", {}).get("filename") or ""),
        ("Aba de origem", report.get("source", {}).get("sheet") or "ORIGINAL"),
        ("DPP anterior (base)", _source(scenario, "base_dpp")),
        ("STK SAP", _source(scenario, "stock")),
        ("Explosão de Placas", _source(scenario, "explosion")),
        ("PGD", _source(scenario, "pgd")),
        ("WIU", _source(scenario, "wiu")),
        ("OPEN (opcional)", _source(scenario, "open")),
        ("DPP final do mês", "Somente comparação/validação, não utilizado na construção da investigação"),
    ]
    metric_labels = ([
        ("PNs recebidos da Divergência de Estoque", "items_received_from_41"),
        ("PNs com Q239", "materials_with_q239"),
        ("PNs com Q273", "materials_with_q273"),
        ("PNs sem registro Q239/Q273", "materials_without_quality_records"),
        ("Registros validados", "candidates_reviewed"),
        ("Itens finalizados", "items_finished"),
        ("Encaminhados para Scrap", "items_to_scrap"),
        ("Encaminhamentos provisórios", "provisional_handoffs"),
        ("Aguardando validação do CQ", "items_awaiting_quality"),
    ] if quality else [
        ("PNs críticos no cenário", "critical_materials"),
        ("PNs com registros M221/P277", "materials_with_candidates"),
        ("PNs sem registros nesses depósitos", "materials_without_candidates"),
        ("Registros validados", "candidates_reviewed"),
        ("Itens finalizados", "items_finished"),
        ("Encaminhados para Qualidade", "items_to_quality"),
        ("Encaminhamentos provisórios", "provisional_handoffs"),
        ("Aguardando validação de Estoque", "items_awaiting_validation"),
    ])
    records = information + [("INDICADORES", "")] + [
        (label, summary.get(field, 0)) for label, field in metric_labels
    ] + [
        ("INTERPRETAÇÃO", ""),
        ("Quantidade encontrada", "Registro no STK ORIGINAL; não implica disponibilidade física ou liberação automática."),
        ("Quantidade bruta", "Quantidade registrada no STK ORIGINAL, nunca automaticamente recuperada."),
        ("Cobertura potencial", "Máximo teórico de cobertura do déficit individual por PN, sem validação de disponibilidade."),
        ("Confirmado vs aplicado", "Confirmado = declaração bruta; aplicado = parte limitada ao déficit ainda sem causa."),
        ("Disponível adicional", "Quantidade validada e declarada fora do DPP; apenas a parte aplicada reduz o gap projetado."),
        ("Indisponível / rejeitado / refugo", "Quantidade validada e justificada; explica a causa, mas não aumenta estoque."),
        ("Falta sem justificativa", "Gap que permanece sem causa validada após a etapa exibida."),
        ("Encaminhamento provisório", "Há revisões pendentes em depósitos ou na investigação de Estoque; o encaminhamento pode mudar."),
        ("Sem registro nos depósitos", "Não equivale a ausência de estoque em todos os depósitos nem comprova scrap."),
        ("Status de encaminhamento", "Indicação da próxima etapa; não significa que a etapa seguinte foi executada."),
        ("DPP oficial", "SALDO, NEC, STK TTL e REAL permanecem inalterados."),
    ]
    # Indicadores por unidade: jamais somar quantidades de UN, KG, M etc.
    per_unit = {}
    all_materials = list(report.get("materials") or [])
    if not quality:
        all_materials.extend(report.get("unmatched_materials") or [])
    for material in all_materials:
        unit = str(material.get("unit") or "SEM UM")
        bucket = per_unit.setdefault(unit, {"deficit": 0.0, "raw": 0.0, "potential": 0.0, "applied": 0.0})
        deficit = float(material.get("negative_balance") if not quality else material.get("gap_from_41") or 0.0)
        raw_value = (
            (material.get("candidate_quantity") or 0.0)
            if not quality else sum(
                float(candidate.get("quantity") or 0.0)
                for candidate in material.get("candidates") or []
            )
        )
        raw = float(raw_value)
        potential = min(deficit, raw)
        applied = float(
            (material.get("recovered_quantity_applied") or 0.0)
            if not quality else (material.get("quality_released_applied") or 0.0)
        )
        bucket["deficit"] += deficit
        bucket["raw"] += raw
        bucket["potential"] += potential
        bucket["applied"] += applied
    records += [("COBERTURA TEÓRICA POR UM (não confirmada)", "")]
    for unit, sums in sorted(per_unit.items()):
        records.extend([
            (f"{unit} · Falta considerada", round(sums["deficit"], 3)),
            (f"{unit} · Depósitos (bruto)", round(sums["raw"], 3)),
            (f"{unit} · Potencial limitado ao déficit", round(sums["potential"], 3)),
            (f"{unit} · Recuperação aplicada validada", round(sums["applied"], 3)),
        ])
    _rows(sheet, ["Campo", "Informação / valor"], [42, 100], records, title=caption,
        subtitle="Relatório de investigação do cenário ORION em construção — não é o DPP Final já validado.",
        note="Valores de depósitos são evidências para investigação. Nenhuma linha deste Excel representa movimentação SAP nem altera o DPP oficial.")
    for row in range(1, sheet.max_row + 1):
        value = sheet.cell(row, 1).value
        if value in {"INDICADORES", "INTERPRETAÇÃO", "COBERTURA TEÓRICA POR UM (não confirmada)"}:
            for col in (1, 2):
                cell = sheet.cell(row, col)
                cell.fill = PatternFill("solid", fgColor=MID)
                cell.font = Font(name="Aptos", size=10, color=WHITE, bold=True)
    return sheet


def _stock_materials(report):
    routing = report.get("workflow") or {}
    routes = {
        entry["material"]: (status, entry)
        for status, key in (
            ("FINISHED", "finished"),
            ("QUALITY_4_2", "forward_to_quality"),
            ("AWAITING_VALIDATION", "awaiting_validation"),
        )
        for entry in routing.get(key) or []
    }
    result = []
    for material in report.get("materials") or []:
        status, state = routes.get(material["material"], ("", {}))
        result.append([
            material["material"], material.get("description"), material.get("unit"),
            material.get("balance"), material.get("negative_balance"),
            material.get("candidate_quantity"), material.get("recovered_quantity_applied"),
            material.get("projected_gap_remaining"), material.get("justified_unavailable_applied"),
            material.get("unexplained_quantity"), _status_label(status),
            state.get("next_step") or material.get("next_step"),
            material.get("theoretical_coverage_limit"),
            material.get("confirmed_increment_outside_dpp"),
            material.get("justified_unavailable_quantity"),
            material.get("confirmed_excess_not_attributed"),
            "Sim" if material.get("routing_provisional") else "Não",
        ])
    for material in report.get("unmatched_materials") or []:
        status, state = routes.get(material["material"], ("QUALITY_4_2", {}))
        result.append([
            material["material"], material.get("description"), material.get("unit"),
            -float(material.get("negative_balance") or 0),
            material.get("negative_balance"), 0, 0,
            material.get("negative_balance"), 0, material.get("negative_balance"),
            _status_label(status), state.get("next_step") or "Sem registros; encaminhar à Qualidade",
            0, 0, 0, 0, "Não",
        ])
    return sorted(result, key=lambda row: (-float(row[4] or 0), str(row[0])))


def _stock_candidates(report):
    detail, history = [], []
    for material in report.get("materials") or []:
        for candidate in material.get("candidates") or []:
            validation = candidate.get("validation") or {}
            detail.append([
                material["material"], material.get("description"), candidate.get("depot"),
                candidate.get("center"), candidate.get("unit"), candidate.get("quantity"),
                "ORIGINAL: " + ", ".join(str(r) for r in candidate.get("source_rows") or []),
                validation.get("decision") or "AGUARDANDO",
                validation.get("accounting") or "UNKNOWN",
                validation.get("confirmed_quantity"),
                candidate.get("recovered_applied", 0), candidate.get("justified_unavailable_applied", 0),
                validation.get("evidence") or "",
                validation.get("created_at") or "",
                _status_label(material.get("workflow_status")), material.get("next_step"),
            ])
            for revision in candidate.get("validation_history") or []:
                history.append([
                    material["material"], candidate.get("depot"), candidate.get("center"),
                    candidate.get("unit"), revision.get("id"), revision.get("created_at"),
                    revision.get("decision"), revision.get("accounting"),
                    revision.get("confirmed_quantity"), revision.get("evidence"),
                    "ORIGINAL: " + ", ".join(str(r) for r in candidate.get("source_rows") or []),
                ])
    return detail, history


def _quality_materials(report):
    return [[
        material.get("material"), material.get("description"), material.get("unit"),
        material.get("active_depot") or "SEM REGISTRO",
        material.get("gap_from_41"), material.get("physical_gap_from_41"),
        material.get("quality_released_applied"), material.get("quality_rejected_applied"),
        material.get("quality_scrap_applied"), material.get("physical_gap_after_quality"),
        material.get("unexplained_after_quality"),
        material.get("q273_records_skipped_due_q239"), _status_label(material.get("workflow_status")),
        material.get("next_step"),
        material.get("theoretical_coverage_limit"),
        material.get("quality_released"), material.get("quality_rejected_justified"),
        material.get("quality_scrap_justified"), material.get("confirmed_excess_not_attributed"),
        "Sim" if material.get("routing_provisional") else "Não",
    ] for material in report.get("materials") or []]


def _quality_candidates(report):
    detail, history = [], []
    for material in report.get("materials") or []:
        for candidate in material.get("candidates") or []:
            validation = candidate.get("validation") or {}
            decision = validation.get("decision") or "AGUARDANDO"
            detail.append([
                material.get("material"), material.get("description"), candidate.get("depot"),
                candidate.get("center"), candidate.get("unit"), candidate.get("quantity"),
                "ORIGINAL: " + ", ".join(str(r) for r in candidate.get("source_rows") or []),
                decision, validation.get("accounting") or "UNKNOWN",
                validation.get("confirmed_quantity"), validation.get("justification") or "",
                validation.get("created_at") or "",
                _status_label(material.get("workflow_status")), material.get("next_step"),
                candidate.get("release_applied", 0), candidate.get("rejection_applied", 0),
                candidate.get("scrap_applied", 0),
            ])
            for revision in candidate.get("validation_history") or []:
                history.append([
                    material.get("material"), candidate.get("depot"), candidate.get("center"),
                    candidate.get("unit"), revision.get("id"), revision.get("created_at"),
                    revision.get("decision"), revision.get("accounting"),
                    revision.get("confirmed_quantity"), revision.get("justification"),
                    "ORIGINAL: " + ", ".join(str(r) for r in candidate.get("source_rows") or []),
                ])
    return detail, history


def _quality_nonactive_q273(report):
    """All Q273 rows held for reference while Q239 is the active workflow path."""
    records = []
    for material in report.get("materials") or []:
        for candidate in material.get("additional_q273_evidence") or []:
            records.append([
                material.get("material"), material.get("description"),
                candidate.get("depot"), candidate.get("center"), candidate.get("unit"),
                candidate.get("quantity"),
                "ORIGINAL: " + ", ".join(str(r) for r in candidate.get("source_rows") or []),
                "Não validado neste fluxo; Q239 tem prioridade.",
            ])
    return records


def export_investigation_excel(kind: str, *, report: dict, scenario: dict) -> tuple[bytes, str, str]:
    if kind not in {"stock", "quality"}:
        raise ValueError("Tipo de investigação inválido.")
    book = Workbook()
    book.remove(book.active)
    _summary(book, report=report, scenario=scenario, kind=kind)
    label = "Qualidade" if kind == "quality" else "Estoque"
    stamp = (report.get("reference_month") or scenario.get("reference_month") or "SEM_MES").replace("-", "_")
    if kind == "stock":
        _rows(book.create_sheet("PNs investigados"),
            ["PN", "Descrição", "UM", "SALDO Cenário ORION", "Falta inicial", "Qtd. bruta nos depósitos",
             "Disponível aplicado ao gap", "Gap após recuperação", "Indisponível aplicada",
             "Sem justificativa", "Situação da análise", "Próxima etapa",
             "Cobertura potencial (teto)", "Disponível confirmado (bruto)",
             "Indisponível confirmada (bruto)", "Confirmado não atribuído", "Provisório?"],
            [25, 42, 9, 23, 16, 24, 26, 22, 25, 20, 24, 58, 27, 28, 31, 28, 15],
            _stock_materials(report), title="DIVERGÊNCIA DE ESTOQUE · PNs",
            subtitle="Todos os PNs críticos, inclusive sem registros M221/P277. Valores não alteram o DPP.",
            status_column=11)
        entries, history = _stock_candidates(report)
        _rows(book.create_sheet("Registros depósitos"),
            ["PN", "Descrição", "Depósito", "Centro", "UM", "Qtd. STK ORIGINAL",
             "Linhas na fonte", "Decisão", "Já no Cenário?", "Qtd. confirmada (bruta)",
             "Disponível aplicado", "Indisponível aplicada", "Justificativa",
             "Data registro", "Status PN", "Encaminhamento"],
            [25, 42, 13, 12, 9, 20, 30, 25, 17, 21, 23, 26, 54, 25, 24, 50],
            entries, title="DIVERGÊNCIA DE ESTOQUE · REGISTROS",
            subtitle="Registros por depósito, quantidade bruta e validação humana. Não somar quantidades automaticamente.",
            note="Registros M221/P277 vêm da aba ORIGINAL. Disponível adicional depende de confirmação de não contabilização.",
            status_column=15)
    else:
        _rows(book.create_sheet("PNs investigados"),
            ["PN", "Descrição", "UM", "Depósito investigado", "Falta recebida de Estoque",
             "Gap físico após Estoque", "Liberado CQ aplicado", "Reprovado aplicado",
             "Refugo aplicado", "Gap físico após CQ", "Sem explicação após CQ",
             "Q273 não investigado", "Situação da análise", "Próxima etapa",
             "Cobertura potencial (teto)", "Liberado confirmado (bruto)",
             "Reprovado confirmado (bruto)", "Refugo confirmado (bruto)",
             "Confirmado não atribuído", "Provisório?"],
            [25, 42, 10, 23, 23, 20, 22, 22, 20, 22, 23, 24, 23, 55,
             28, 28, 28, 27, 26, 15],
            _quality_materials(report), title="QUALIDADE · PNs INVESTIGADOS",
            subtitle="Todos os PNs recebidos da Divergência de Estoque, incluindo casos sem Q239/Q273.",
            note="Quando há registros em Q239, os registros de Q273 são apresentados separadamente e não entram na quantidade atribuída ao déficit.",
            status_column=13)
        entries, history = _quality_candidates(report)
        _rows(book.create_sheet("Registros depósitos"),
            ["PN", "Descrição", "Depósito", "Centro", "UM", "Qtd. STK ORIGINAL",
             "Linhas na fonte", "Decisão CQ", "Já no Cenário?", "Qtd. confirmada (bruta)",
             "Justificativa", "Data registro", "Status PN", "Encaminhamento",
             "Liberado aplicado", "Reprovado aplicado", "Refugo aplicado"],
            [25, 42, 14, 12, 10, 22, 30, 26, 18, 23, 55, 26, 24, 55,
             25, 25, 22],
            entries, title="QUALIDADE · REGISTROS Q239 / Q273",
            subtitle="Depósito Q239 tem prioridade; Q273 é consultado quando Q239 não apresenta quantidade.",
            note="Q239/Q273 são registros de investigação. Refugo ou reprovação não viram estoque disponível.",
            status_column=13)
        _rows(book.create_sheet("Q273 não investigado"),
            ["PN", "Descrição", "Depósito", "Centro", "UM", "Qtd. STK ORIGINAL",
             "Linhas na fonte", "Motivo de não utilizar"],
            [25, 42, 16, 13, 10, 25, 32, 58],
            _quality_nonactive_q273(report),
            title="Q273 · REGISTROS FORA DO CAMINHO ATIVO",
            subtitle="Referência de Q273 para PNs com registros em Q239. Não utilizada na soma de quantidade nem na decisão desta análise.",
            note="Estes registros são exibidos para rastreabilidade. Quando há saldo em Q239, a avaliação do CQ tem prioridade; nenhuma decisão é presumida.")
    _rows(book.create_sheet("Histórico validações"),
        ["PN", "Depósito", "Centro", "UM", "ID", "Data UTC", "Decisão",
         "Já no DPP?", "Qtd. confirmada", "Justificativa", "Linhas de origem"],
        [25, 14, 12, 9, 11, 26, 25, 18, 22, 62, 32], history,
        title=label.upper() + " · HISTÓRICO DE VALIDAÇÕES",
        subtitle="Revisões cronológicas registradas no SQLite. O último registro de cada candidato determina a situação atual.")
    output = BytesIO()
    book.save(output)
    return output.getvalue(), f"ORION_{label}_Investigacao_{stamp}.xlsx", XLSX_MIME
