from __future__ import annotations

"""Converte relatórios já calculados do Dashboard em fatos consultáveis pelo chat.

Não recalcula saldos, não valida liberações e não mistura Q273 informativo
com os depósitos ativos. Relatórios de um cenário diferente são descartados.
"""


def investigation_records(workspace: dict | None) -> list[dict]:
    payload = workspace if isinstance(workspace, dict) else {}
    scenario = payload.get("scenario") if isinstance(payload.get("scenario"), dict) else {}
    scenario_id = str(scenario.get("scenario_id") or "")
    if not scenario_id:
        return []
    reports = payload.get("investigations") if isinstance(payload.get("investigations"), dict) else {}
    stock_source = next(
        (s for s in (scenario.get("sources") or []) if isinstance(s, dict) and s.get("id") == "stock"),
        {},
    )
    expected_stock = str(stock_source.get("filename") or "").casefold()
    result = []

    for area in ("stock", "quality"):
        report = reports.get(area)
        if not isinstance(report, dict) or report.get("scenario_id") != scenario_id:
            continue
        source = report.get("source") or {}
        if expected_stock and str(source.get("filename") or "").casefold() != expected_stock:
            continue
        root = f"workspace://investigations/{area}/{scenario_id}"
        result.append({
            "area": area,
            "kind": "summary",
            "key": area,
            "source": f"{root}/summary",
            "payload": {
                "scenario_id": scenario_id,
                "reference_month": report.get("reference_month"),
                "source": source,
                "summary": report.get("summary") or {},
                "changes_dpp": report.get("changes_dpp"),
                "note": report.get("note"),
            },
        })
        forwarded = {
            str(item.get("material"))
            for item in (report.get("workflow") or {}).get("forward_to_quality") or []
            if isinstance(item, dict)
        } if area == "stock" else set()

        materials = list(report.get("materials") or [])
        if area == "stock":
            materials.extend(report.get("unmatched_materials") or [])
        for item in materials:
            if not isinstance(item, dict) or not item.get("material"):
                continue
            pn = str(item["material"])
            material = dict(item)
            if area == "stock":
                material["forwarded_to_quality"] = pn in forwarded
                if not material.get("candidates"):
                    material.setdefault("unexplained_quantity", material.get("negative_balance"))
                    material.setdefault("workflow_status", "QUALITY_4_2" if pn in forwarded else "NO_RECORDS")
            result.append({
                "area": area,
                "kind": "material",
                "key": pn,
                "source": f"{root}/material/{pn}",
                "payload": material,
            })
    return result


def investigation_document_content(record: dict) -> str:
    item = record["payload"]
    if record["kind"] == "summary":
        summary = item.get("summary") or {}
        return "\n".join([
            f"Investigação do Dashboard: {record['area']}.",
            f"Cenário: {item.get('scenario_id')}.",
            f"Período: {item.get('reference_month')}.",
            f"Fonte: {item.get('source')}.",
            *(f"{key}: {value}" for key, value in summary.items()),
            str(item.get("note") or ""),
        ])

    candidates = item.get("candidates") or []
    details = [
        f"Depósito {c.get('depot')}; centro {c.get('center')}; quantidade bruta {c.get('quantity')} "
        f"{item.get('unit')}; linhas ORIGINAL {c.get('source_rows')}; "
        f"decisão {(c.get('validation') or {}).get('decision') or 'pendente'}; "
        f"quantidade confirmada {(c.get('validation') or {}).get('confirmed_quantity')}; "
        f"quantidade aplicada {c.get('recovered_applied', c.get('release_applied', c.get('rejection_applied', c.get('scrap_applied', 'não atribuída'))))}"
        for c in candidates
    ]
    fields = [
        "negative_balance", "gap_from_41", "recovered_quantity_applied",
        "justified_unavailable_applied", "unexplained_quantity",
        "quality_released_applied", "quality_rejected_applied", "quality_scrap_applied",
        "physical_gap_after_quality", "unexplained_after_quality",
        "workflow_status", "next_step", "routing_provisional",
        "pending_reviews", "active_depot", "q273_records_skipped_due_q239",
        "forwarded_to_quality",
    ]
    return "\n".join([
        f"Investigação {record['area']} do PN {record['key']}.",
        f"Descrição: {item.get('description')}. Unidade: {item.get('unit')}.",
        *(f"{key}: {item[key]}" for key in fields if key in item),
        *details,
        ("Q273 paralelo ao Q239 é informativo, não ativo."
         if record["area"] == "quality" and item.get("q273_records_skipped_due_q239") else ""),
        "Saldos de depósitos não provam liberação; decisões pendentes exigem confirmação humana.",
    ])
