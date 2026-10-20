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


# As abas do Excel refletem o Dashboard: visão geral, PNs e trabalho por área.
# Código de fluxo e versões de processo nunca aparecem em células.
DECISION_LABELS = {
    "AVAILABLE": "Disponível",
    "UNAVAILABLE": "Indisponível",
    "RELEASED": "Liberado pelo CQ",
    "REJECTED": "Reprovado pelo CQ",
    "SCRAP_CONFIRMED": "Refugo confirmado",
    "NO_EVIDENCE": "Sem confirmação",
    "UNKNOWN": "A confirmar",
    "INCLUDED": "Já contabilizado",
    "NOT_INCLUDED": "Fora do DPP",
}

SECTION_NAMES = {
    "visao": "VISÃO GERAL DO DPP",
    "estoque": "DIVERGÊNCIA DE ESTOQUE",
    "qualidade": "ANÁLISE DE QUALIDADE",
    "totais": "QUANTIDADES POR UNIDADE DE MEDIDA",
    "origens": "FONTES DO CENÁRIO",
    "leitura": "COMO INTERPRETAR",
}


def _fmt_decision(value):
    return DECISION_LABELS.get(value, value or "Aguardando confirmação")


def _sum_by_unit(materials, get_value):
    totals = {}
    for item in materials:
        unit = item.get("unit") or "SEM UM"
        totals[unit] = totals.get(unit, 0.0) + float(get_value(item) or 0.0)
    return totals


def _stock_all(stock):
    if not stock:
        return []
    return [*stock.get("materials", []), *stock.get("unmatched_materials", [])]


def _sum_candidates(material, depot=None):
    return sum(
        float(candidate.get("quantity") or 0)
        for candidate in material.get("candidates", [])
        if not depot or candidate.get("depot") == depot
    )


def _missing(item):
    return float(item.get("negative_balance") or 0)


def _moneyless_total_section(stock, quality):
    """One row per measurement unit; never add KG, CM and UN together."""
    stocks = _stock_all(stock)
    stock_matched = {x["material"]: x for x in stock.get("materials", [])} if stock else {}
    quality_rows = quality.get("materials", []) if quality else []
    units = sorted({*(x.get("unit") or "SEM UM" for x in stocks),
                    *(x.get("unit") or "SEM UM" for x in quality_rows)})
    rows = []
    for unit in units:
        ss = [m for m in stocks if (m.get("unit") or "SEM UM") == unit]
        qq = [m for m in quality_rows if (m.get("unit") or "SEM UM") == unit]
        raw = sum(_sum_candidates(m) for m in ss if m["material"] in stock_matched)
        potential = sum(min(_missing(m), _sum_candidates(m)) for m in ss)
        recovered = sum(float(m.get("recovered_quantity_applied") or 0) for m in ss)
        remaining = sum(float(m.get("projected_gap_remaining") if m["material"] in stock_matched else _missing(m)) for m in ss)
        unexplained = sum(float(m.get("unexplained_quantity") if m["material"] in stock_matched else _missing(m)) for m in ss)
        cq_found = sum(_sum_candidates(m) for m in qq)
        cq_applied = sum(float(m.get("quality_released_applied") or 0) for m in qq)
        cq_unexplained = sum(float(m.get("unexplained_after_quality") or 0) for m in qq)
        rows.extend([
            (unit + " · Falta inicial (PNs críticos)", sum(_missing(m) for m in ss)),
            (unit + " · Quantidade M221/P277 encontrada (bruta)", raw),
            (unit + " · Cobertura potencial em Estoque (não validada)", potential),
            (unit + " · Disponível aplicado ao gap (Estoque)", recovered),
            (unit + " · Gap após recuperação em Estoque", remaining),
            (unit + " · Falta sem justificativa em Estoque", unexplained),
            (unit + " · Quantidade CQ encontrada (bruta)", cq_found),
            (unit + " · Liberado aplicado ao gap (Qualidade)", cq_applied),
            (unit + " · Falta sem explicação após Qualidade", cq_unexplained),
        ])
    return rows


def _summary(workbook, *, report, scenario, kind, stock_report=None, quality_report=None):
    quality = kind == "quality"
    stock = stock_report if stock_report is not None else (report if not quality else None)
    cq = quality_report if quality_report is not None else (report if quality else None)
    st = stock.get("summary", {}) if stock else {}
    qs = cq.get("summary", {}) if cq else {}
    sheet = workbook.create_sheet("Resumo")
    caption = "ANÁLISE DE QUALIDADE · Q239 / Q273" if quality else "DIVERGÊNCIA DE ESTOQUE · M221 / P277"
    rows = [
        (SECTION_NAMES["visao"], ""),
        ("PNs críticos (SALDO negativo)", st.get("critical_materials", "Não consultado")),
        ("PNs com registros em Estoque", st.get("materials_with_candidates", "Não consultado")),
        ("PNs sem registros em Estoque", st.get("materials_without_candidates", "Não consultado")),
        ("PNs encaminhados à Qualidade", st.get("items_to_quality", "Não consultado")),
        ("PNs em análise de Qualidade com registros", (
            qs.get("materials_with_q239", 0) + qs.get("materials_with_q273", 0)
            if cq else "Não consultado"
        )),
        ("PNs sem registros em Qualidade", qs.get("materials_without_quality_records", "Não consultado")),
        (SECTION_NAMES["estoque"], ""),
        ("PNs críticos", st.get("critical_materials", "Não consultado")),
        ("PNs com registros", st.get("materials_with_candidates", "Não consultado")),
        ("Registros validados", st.get("candidates_reviewed", "Não consultado")),
        ("Itens finalizados", st.get("items_finished", "Não consultado")),
        ("Encaminhar à Qualidade", st.get("items_to_quality", "Não consultado")),
        ("Encaminhamentos provisórios", st.get("provisional_handoffs", "Não consultado")),
        ("Aguardando validação", st.get("items_awaiting_validation", "Não consultado")),
        ("Sem registros para esses PNs", st.get("materials_without_candidates", "Não consultado")),
        ("Depósitos sem registros no arquivo", ", ".join(st.get("depots_without_records") or []) or "nenhum" if stock else "Não consultado"),
        (SECTION_NAMES["qualidade"], ""),
        ("PNs recebidos", qs.get("items_received_from_41", "Não consultado")),
        ("PNs em Q239", qs.get("materials_with_q239", "Não consultado")),
        ("PNs em Q273", qs.get("materials_with_q273", "Não consultado")),
        ("Sem registros", qs.get("materials_without_quality_records", "Não consultado")),
        ("Registros validados", qs.get("candidates_reviewed", "Não consultado")),
        ("Finalizados", qs.get("items_finished", "Não consultado")),
        ("Encaminhar a Scrap", qs.get("items_to_scrap", "Não consultado")),
        ("Encaminhamentos provisórios", qs.get("provisional_handoffs", "Não consultado")),
        ("Aguardando CQ", qs.get("items_awaiting_quality", "Não consultado")),
        (SECTION_NAMES["totais"], ""),
        *_moneyless_total_section(stock, cq),
        (SECTION_NAMES["origens"], ""),
        ("Cenário ORION", report.get("scenario_id") or ""),
        ("Mês do cenário", report.get("reference_month") or scenario.get("reference_month") or ""),
        ("Gerado em (UTC)", datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")),
        ("Fonte de estoque", report.get("source", {}).get("filename") or ""),
        ("Aba de origem", report.get("source", {}).get("sheet") or "ORIGINAL"),
        ("DPP anterior (base)", _source(scenario, "base_dpp")),
        ("STK SAP", _source(scenario, "stock")),
        ("Explosão de Placas", _source(scenario, "explosion")),
        ("PGD", _source(scenario, "pgd")),
        ("WIU", _source(scenario, "wiu")),
        ("OPEN (opcional)", _source(scenario, "open")),
        ("DPP final do mês", "Somente comparação e validação; não é fonte da geração"),
        (SECTION_NAMES["leitura"], ""),
        ("Abas por investigação", "Divergência de Estoque e Análise de Qualidade apresentam cada PN e suas evidências; PNs e divergências e Confirmar com área detalham a investigação do botão usado."),
        ("M221 e P277", "Depósitos pesquisados na Divergência de Estoque, conforme a aba ORIGINAL do STK SAP."),
        ("Q239", "Material em análise no Controle de Qualidade. A liberação precisa ser confirmada pela área."),
        ("Q273", "Indicação de refugo a confirmar. Quando existe Q239 para o PN, Q273 é apenas informativo e não é somado."),
        ("Sem registro", "Não encontrado nesses depósitos; isso não comprova inexistência em outros depósitos nem refugo."),
        ("Quantidade aplicada ao gap", "Parcela confirmada e limitada à falta ainda atribuível ao PN; o valor bruto pode ser maior."),
        ("Reprovação ou refugo", "Comprovação justificada explica a causa, mas não adiciona estoque nem reduz a falta física."),
        ("Evidência / linhas STK", "Identifica a aba ORIGINAL e as linhas SAP que originaram o achado, não uma decisão de liberação."),
        ("Quantidade encontrada", "Registro bruto na aba ORIGINAL; não significa material liberado."),
        ("Cobertura potencial", "Máximo teórico limitado à falta de cada PN; depende da confirmação da área."),
        ("Gap recalculado", "Projeção após quantidades comprovadas, sem alterar o SALDO do DPP."),
        ("Falta sem explicação", "Quantidade ainda não justificada; NÃO representa refugo confirmado."),
        ("Situação provisória", "Há validações pendentes; a próxima análise poderá mudar."),
        ("Ação do analista", "Use a aba Confirmar com área para conferir o PN, o depósito e solicitar confirmação."),
    ]
    _rows(sheet, ["Indicador (igual ao Dashboard)", "Quantidade / informação"], [52, 105], rows,
          title=caption, subtitle="Visão consolidada do DPP em construção e das investigações de Estoque e Qualidade.",
          note="Indicadores por PN e por unidade de medida. Não somar unidades diferentes nem presumir disponibilidade pelos saldos dos depósitos.")
    for row in range(1, sheet.max_row + 1):
        if sheet.cell(row, 1).value in SECTION_NAMES.values():
            for col in (1, 2):
                cell = sheet.cell(row, col)
                cell.fill = PatternFill("solid", fgColor=MID)
                cell.font = Font(name="Aptos", size=10, color=WHITE, bold=True)


def _stock_pn_rows(stock):
    found = {x["material"]: x for x in stock.get("materials", [])}
    rows = []
    for m in _stock_all(stock):
        matched = m["material"] in found
        deficit = _missing(m)
        qty = _sum_candidates(m)
        status = _status_label(m.get("workflow_status") if matched else "QUALITY_4_2")
        next_step = m.get("next_step") if matched else "Sem registro em M221/P277; seguir para Análise de Qualidade"
        rows.append([
            m["material"], m.get("description"), m.get("unit"), m.get("balance") if matched else -deficit,
            deficit, _sum_candidates(m, "M221"), _sum_candidates(m, "P277"), qty,
            min(deficit, qty),
            m.get("recovered_quantity_applied", 0), m.get("projected_gap_remaining", deficit),
            m.get("justified_unavailable_applied", 0), m.get("unexplained_quantity", deficit),
            status, next_step, "Sim" if m.get("routing_provisional") else "Não",
        ])
    return sorted(rows, key=lambda row: (-float(row[4]), str(row[0])))


def _quality_pn_rows(quality, stock):
    stock_by_pn = {x["material"]: x for x in _stock_all(stock)}
    rows = []
    for m in quality.get("materials", []):
        orig = stock_by_pn.get(m["material"], {})
        rows.append([
            m["material"], m.get("description"), m.get("unit"),
            _missing(orig) if orig else "",
            _sum_candidates(orig) if orig else 0,
            orig.get("projected_gap_remaining", _missing(orig)) if orig else "",
            m.get("gap_from_41"), m.get("active_depot") or "Sem Q239/Q273",
            _sum_candidates(m), m.get("theoretical_coverage_limit"),
            m.get("quality_released_applied"), m.get("quality_rejected_applied"),
            m.get("quality_scrap_applied"), m.get("physical_gap_after_quality"),
            m.get("unexplained_after_quality"), _status_label(m.get("workflow_status")),
            m.get("next_step"), "Sim" if m.get("routing_provisional") else "Não",
        ])
    return rows


def _history(candidate, unit):
    revisions = candidate.get("validation_history") or []
    if not revisions:
        return "Sem validações registradas"
    rendered = []
    for v in revisions:
        explanation = v.get("justification") or v.get("evidence") or ""
        rendered.append(
            "#{} · {} · {} · {} {}{}{}".format(
                v.get("id") or "", v.get("created_at") or "sem data",
                _fmt_decision(v.get("decision")), _safe(v.get("confirmed_quantity") or 0),
                unit, " · " if explanation else "", explanation,
            )
        )
    text = "\n".join(rendered)
    # Excel limita células a 32767 caracteres; sempre deixar explícito se exceder.
    return text if len(text) <= 32000 else text[:31800] + "\n[Histórico extenso: consulte o sistema para revisões completas]"


def _stock_action_rows(stock):
    rows = []
    for m in stock.get("materials", []):
        for candidate in m.get("candidates", []):
            validated = candidate.get("validation") or {}
            pending = not validated
            action = (
                "Confirmar com Almoxarifado: localizar/disponibilizar ou justificar baixa."
                if pending else "Conferir decisão registrada com PCM/Almoxarifado."
            )
            rows.append([
                "Confirmar com Almoxarifado" if pending else "Validação registrada",
                m["material"], m.get("description"), candidate.get("depot"), candidate.get("center"),
                candidate.get("unit"), candidate.get("quantity"),
                "ORIGINAL · linhas " + ", ".join(str(x) for x in candidate.get("source_rows") or []),
                _fmt_decision(validated.get("decision")), _fmt_decision(validated.get("accounting")),
                validated.get("confirmed_quantity"), candidate.get("recovered_applied", 0),
                candidate.get("justified_unavailable_applied", 0), m.get("projected_gap_remaining"),
                m.get("unexplained_quantity"), _status_label(m.get("workflow_status")),
                action, validated.get("evidence") or "", validated.get("created_at") or "",
                _history(candidate, candidate.get("unit")),
            ])
    return sorted(rows, key=lambda row: (row[0] != "Confirmar com Almoxarifado", -float(row[14] or 0), str(row[1])))


def _quality_action_rows(quality):
    rows = []
    for m in quality.get("materials", []):
        if not m.get("candidates"):
            rows.append([
                "Sem registro no CQ", m["material"], m.get("description"),
                "Sem Q239/Q273", "", m.get("unit"), 0,
                "STK ORIGINAL · nenhum registro Q239/Q273",
                "Sem confirmação", "Não se aplica", 0, 0, 0, 0,
                m.get("unexplained_after_quality"),
                _status_label(m.get("workflow_status")),
                ("Nenhum registro no CQ. Confirmar a ausência de informação "
                 "com a Qualidade antes de agir sobre o encaminhamento; "
                 "isso não comprova refugo."),
                "", "", "Sem validações registradas",
            ])
        for candidate in m.get("candidates", []):
            validated = candidate.get("validation") or {}
            pending = not validated
            rows.append([
                "Confirmar com Qualidade/CQ" if pending else "Validação registrada",
                m["material"], m.get("description"), candidate.get("depot"), candidate.get("center"),
                candidate.get("unit"), candidate.get("quantity"),
                "ORIGINAL · linhas " + ", ".join(str(x) for x in candidate.get("source_rows") or []),
                _fmt_decision(validated.get("decision")), _fmt_decision(validated.get("accounting")),
                validated.get("confirmed_quantity"),
                candidate.get("release_applied", 0), candidate.get("rejection_applied", 0),
                candidate.get("scrap_applied", 0), m.get("unexplained_after_quality"),
                _status_label(m.get("workflow_status")),
                ("Confirmar com CQ: liberação/reprovação ou refugo; registrar justificativa."
                 if pending else "Revisar confirmação registrada com CQ."),
                validated.get("justification") or "", validated.get("created_at") or "",
                _history(candidate, candidate.get("unit")),
            ])
        for candidate in m.get("additional_q273_evidence") or []:
            rows.append([
                "Informativo · não somar", m["material"], m.get("description"), candidate.get("depot"),
                candidate.get("center"), candidate.get("unit"), candidate.get("quantity"),
                "ORIGINAL · linhas " + ", ".join(str(x) for x in candidate.get("source_rows") or []),
                "Não avaliado", "Não se aplica", 0, 0, 0, 0,
                m.get("unexplained_after_quality"), "Q239 com prioridade",
                "Não validar automaticamente o Q273 enquanto o Q239 for o caminho ativo.",
                "", "", "Registro apenas informativo",
            ])
    return sorted(rows, key=lambda row: (row[0] != "Confirmar com Qualidade/CQ", str(row[1]), str(row[3])))


def _evidence_locations(candidates, *, informative=False):
    """Show actual SAP source rows without treating every row as approved stock."""
    if not candidates:
        return "Nenhum registro nos depósitos investigados."
    entries = []
    for candidate in candidates:
        depot = candidate.get("depot") or "?"
        center = candidate.get("center") or "sem centro"
        origin = ", ".join(str(value) for value in candidate.get("source_rows") or [])
        location = f"{depot} · centro {center} · ORIGINAL linhas {origin or '?'}"
        entries.append(f"{location} · apenas informativo" if informative else location)
    result = "\n".join(entries)
    return result if len(result) <= 32000 else result[:31800] + "\n[Consulte o STK ORIGINAL para a lista completa]"


def _stock_analysis_rows(stock):
    """One record per critical PN, including those absent in both depots."""
    found = {item["material"]: item for item in stock.get("materials", [])}
    lines = []
    for item in _stock_all(stock):
        matched = item["material"] in found
        deficit = _missing(item)
        found_quantity = _sum_candidates(item)
        lines.append([
            item["material"], item.get("description"), item.get("unit"),
            item.get("balance") if matched else -deficit, deficit,
            _sum_candidates(item, "M221"), _sum_candidates(item, "P277"),
            found_quantity, min(deficit, found_quantity),
            item.get("recovered_quantity_applied", 0),
            item.get("justified_unavailable_applied", 0),
            item.get("projected_gap_remaining", deficit),
            item.get("unexplained_quantity", deficit),
            item.get("pending_reviews", 0) if matched else 0,
            "Sim" if item.get("routing_provisional") else "Não",
            item.get("next_step") if matched else (
                "Sem registro em M221/P277. Encaminhar à Qualidade; "
                "a ausência não comprova inexistência em outros depósitos."
            ),
            _evidence_locations(item.get("candidates") or []) if matched
            else "STK ORIGINAL · nenhum registro M221/P277 para este PN",
            _status_label(item.get("workflow_status") if matched else "QUALITY_4_2"),
        ])
    return sorted(lines, key=lambda row: (-float(row[4] or 0), str(row[0])))


def _quality_analysis_rows(quality):
    """Disclose the active CQ depot separately from informative Q273 evidence."""
    lines = []
    for item in quality.get("materials", []):
        active = item.get("active_depot")
        inspected = item.get("candidates") or []
        informative = item.get("additional_q273_evidence") or []
        source = _evidence_locations(inspected)
        if informative:
            source += "\n" + _evidence_locations(informative, informative=True)
        lines.append([
            item["material"], item.get("description"), item.get("unit"),
            item.get("gap_from_41", 0),
            _sum_candidates(item, "Q239"), _sum_candidates(item, "Q273"),
            sum(float(evidence.get("quantity") or 0) for evidence in informative),
            active or "Sem Q239/Q273",
            item.get("theoretical_coverage_limit", 0),
            item.get("quality_released_applied", 0),
            item.get("quality_rejected_applied", 0),
            item.get("quality_scrap_applied", 0),
            item.get("physical_gap_after_quality", 0),
            item.get("unexplained_after_quality", 0),
            item.get("pending_reviews", 0),
            item.get("pending_stock_reviews", 0),
            "Sim" if item.get("routing_provisional") else "Não",
            _status_label(item.get("workflow_status")),
            item.get("next_step"),
            source if inspected or informative else "STK ORIGINAL · nenhum registro Q239/Q273 para este PN",
        ])
    return sorted(lines, key=lambda row: (-float(row[3] or 0), str(row[0])))


def _add_stage_analysis_sheets(book, *, stock, quality):
    """Both downloads expose the two investigations explicitly and independently."""
    _rows(
        book.create_sheet("Divergência de Estoque"),
        ["PN", "Descrição", "UM", "SALDO original ORION", "Falta inicial",
         "M221 encontrado", "P277 encontrado", "Total bruto encontrado",
         "Cobertura possível (não validada)", "Disponível adicional aplicado",
         "Indisponível justificada", "Falta física após Estoque",
         "Falta sem justificativa", "Registros pendentes Estoque",
         "Encaminhamento provisório?", "Próxima ação", "Evidência / linhas STK", "Situação"],
        [23, 36, 9, 23, 17, 18, 18, 23, 29, 26, 23, 24, 24, 23, 22, 63, 70, 29],
        _stock_analysis_rows(stock),
        title="DIVERGÊNCIA DE ESTOQUE · M221 E P277",
        subtitle=(
            "Um registro por PN crítico do Cenário ORION, incluindo os que não aparecem "
            "nesses depósitos. A coluna de evidência indica depósito, centro e linha do STK ORIGINAL."
        ),
        note=(
            "Encontrado no SAP não significa disponível. Só a quantidade adicional confirmada pelo "
            "PCM/Almoxarifado reduz a falta física; baixa justificada apenas explica parte do déficit."
        ),
        status_column=18,
    )
    _rows(
        book.create_sheet("Análise de Qualidade"),
        ["PN", "Descrição", "UM", "Falta recebida do Estoque",
         "Q239 ativo encontrado", "Q273 ativo encontrado",
         "Q273 apenas informativo", "Depósito CQ priorizado",
         "Cobertura possível (não validada)", "Liberado adicional aplicado",
         "Reprovado justificado", "Refugo justificado",
         "Falta física após CQ", "Falta sem explicação",
         "Registros pendentes CQ", "Pendências de Estoque",
         "Encaminhamento provisório?", "Situação", "Próxima ação",
         "Evidência / linhas STK"],
        [23, 36, 9, 25, 21, 21, 22, 24, 30, 26, 23, 23, 23, 23, 21, 21, 22, 29, 63, 70],
        _quality_analysis_rows(quality),
        title="ANÁLISE DE QUALIDADE · Q239 E Q273",
        subtitle=(
            "Somente PNs encaminhados pelo Estoque. Q239 tem prioridade; Q273 é ativo apenas "
            "quando não há Q239. Registros Q273 paralelos ficam informativos e não são somados."
        ),
        note=(
            "Apenas liberação CQ confirmada e fora do DPP reduz a falta física. "
            "Reprovação ou refugo com justificativa explica parte da falta, sem virar estoque. "
            "Pendências tornam o encaminhamento provisório."
        ),
        status_column=18,
    )


def export_investigation_excel(
    kind: str, *, report: dict, scenario: dict,
    stock_report: dict | None = None, quality_report: dict | None = None,
) -> tuple[bytes, str, str]:
    if kind not in {"stock", "quality"}:
        raise ValueError("Tipo de investigação inválido.")
    stock = stock_report if stock_report is not None else (report if kind == "stock" else {})
    quality = quality_report if quality_report is not None else (report if kind == "quality" else {})
    book = Workbook()
    book.remove(book.active)
    _summary(book, report=report, scenario=scenario, kind=kind,
             stock_report=stock, quality_report=quality)
    _add_stage_analysis_sheets(book, stock=stock, quality=quality)
    label = "Qualidade" if kind == "quality" else "Estoque"
    stamp = (report.get("reference_month") or scenario.get("reference_month") or "SEM_MES").replace("-", "_")
    if kind == "stock":
        _rows(book.create_sheet("PNs e divergências"),
            ["PN", "Descrição", "UM", "SALDO Cenário ORION", "Falta inicial",
             "M221 encontrado", "P277 encontrado", "Qtd. encontrada em Estoque",
             "Cobertura potencial (não validada)", "Disponível aplicado",
             "Gap após recuperação", "Indisponível justificada", "Falta sem justificativa",
             "Situação da análise", "Próxima ação", "Provisório?"],
            [24, 37, 9, 23, 17, 17, 17, 23, 29, 20, 20, 25, 25, 27, 62, 15],
            _stock_pn_rows(stock), title="DIVERGÊNCIA DE ESTOQUE · POR PN",
            subtitle="Todos os PNs críticos, inclusive os que não têm registro em M221 ou P277.",
            note="ENCONTRADO ≠ DISPONÍVEL. O gap só diminui quando a quantidade é validada como adicional ao Cenário ORION.",
            status_column=14)
        _rows(book.create_sheet("Confirmar com área"),
            ["Ação / área", "PN", "Descrição", "Depósito encontrado", "Centro", "UM",
             "Qtd. encontrada no depósito", "Fonte STK",
             "Decisão", "Já contabilizado?", "Qtd. confirmada",
             "Disponível aplicado", "Indisponível justificada", "Gap após recuperação",
             "Falta sem justificativa", "Situação da análise", "O que o analista precisa fazer",
             "Justificativa", "Data confirmação", "Histórico de revisões"],
            [31, 24, 36, 20, 13, 10, 26, 35, 24, 19, 20, 20, 25, 21, 22, 27, 65, 58, 25, 70],
            _stock_action_rows(stock), title="ESTOQUE · CONFIRMAR COM ALMOXARIFADO",
            subtitle="PNs efetivamente encontrados em M221/P277. A primeira coluna prioriza registros pendentes.",
            note="Peça ao PCM/Almoxarifado que confirme disponibilidade ou baixa. O STK é evidência; não efetua liberação.",
            status_column=16)
    else:
        _rows(book.create_sheet("PNs e divergências"),
            ["PN", "Descrição", "UM", "Falta inicial do Cenário",
             "Qtd. encontrada em Estoque", "Gap físico após Estoque",
             "Falta recebida de Estoque", "Depósito CQ", "Qtd. encontrada no CQ",
             "Cobertura potencial (não validada)", "Liberado aplicado", "Reprovado justificado",
             "Refugo justificado", "Gap físico após Qualidade", "Falta sem explicação",
             "Situação da análise", "Próxima ação", "Provisório?"],
            [24, 37, 9, 22, 23, 22, 25, 23, 23, 30, 21, 23, 22, 24, 23, 28, 62, 15],
            _quality_pn_rows(quality, stock),
            title="ANÁLISE DE QUALIDADE · POR PN",
            subtitle="PNs encaminhados pelo Estoque, com falta recebida, achados em CQ e gap recalculado.",
            note="REPROVAÇÃO OU REFUGO JUSTIFICADO explica a falta, mas não acrescenta estoque disponível.",
            status_column=16)
        _rows(book.create_sheet("Confirmar com área"),
            ["Ação / área", "PN", "Descrição", "Depósito encontrado", "Centro", "UM",
             "Qtd. encontrada no depósito", "Fonte STK", "Decisão",
             "Já contabilizado?", "Qtd. confirmada", "Liberado aplicado",
             "Reprovado justificado", "Refugo justificado", "Falta sem explicação",
             "Situação da análise", "O que o analista precisa fazer",
             "Justificativa", "Data confirmação", "Histórico de revisões"],
            [31, 24, 36, 20, 13, 10, 26, 35, 25, 19, 20, 21, 24, 20, 22, 27, 65, 58, 25, 70],
            _quality_action_rows(quality), title="QUALIDADE · CONFIRMAR COM O CQ",
            subtitle="PNs encontrados no CQ, sem registros e Q273 informativos, com ações diferenciadas.",
            note="Peça confirmação da Qualidade/CQ por PN e depósito. Ausência de registro NÃO comprova refugo.",
            status_column=16)
    output = BytesIO()
    book.save(output)
    return output.getvalue(), f"ORION_{label}_Investigacao_{stamp}.xlsx", XLSX_MIME
