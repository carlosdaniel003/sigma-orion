from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from copy import deepcopy
import unicodedata

from fastapi import UploadFile

from app.services.dpp_consolidation_service import (
    _material_key,
    _parse_explosion,
    _parse_open,
    _parse_stock,
    _parse_wiu,
    _unit_conversion,
    _validate_upload,
)
from app.services.dpp_monthly_base import parse_previous_dpp
from app.services.dpp_optional_service import canonical_optional_material, split_optional_materials
from app.services.dpp_scenario_service import register_monthly_scenario
from app.services.pgd_mapping_rules import get_kit_override, get_variant_override
from app.services.pgd_service import parse_pgd

ProgressCallback = Callable[[int, str], None]


def _notify(progress: ProgressCallback | None, value: int, activity: str) -> None:
    if progress is not None:
        progress(value, activity)


def _normalize(value: object) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value).strip().lower())
    return "".join(char for char in text if not unicodedata.combining(char))


def _map_pgd_to_models(
    pgd_models: list[dict],
    current_models: list[dict],
    previous_models: list[dict],
    reference_month: str,
) -> dict:
    by_name: dict[str, list[dict]] = defaultdict(list)
    by_code: dict[str, list[dict]] = defaultdict(list)
    for model in current_models:
        by_name[_normalize(model.get("name"))].append(model)
        by_code[_normalize(model.get("code"))].append(model)

    previous_by_name = {_normalize(item.get("name")): item for item in previous_models}
    assignments: dict[str, dict] = {}
    mapped_records: list[dict] = []
    unresolved_positive: list[dict] = []
    out_of_scope_positive: list[dict] = []
    ignored_zero_ambiguous = 0
    variant_overrides_applied = 0
    kit_overrides_applied = 0

    for original in pgd_models:
        pgd = deepcopy(original)
        has_kit_override, kit_override = get_kit_override(reference_month, pgd.get("name"))
        if has_kit_override:
            pgd["kit_pgd_before_rule"] = pgd.get("kit_pgd", 0.0)
            pgd["kit_pgd"] = max(float(kit_override or 0.0), 0.0)
            pgd["kit_rule"] = "MONTHLY_KIT_OVERRIDE"
            kit_overrides_applied += 1

        selected = None
        strategy = "EXACT_NAME"
        variant_target = get_variant_override(reference_month, pgd.get("name"))

        if variant_target:
            override_candidates = by_name.get(_normalize(variant_target), [])
            if len(override_candidates) == 1:
                selected = override_candidates[0]
                strategy = "MONTHLY_VARIANT_RULE"
                variant_overrides_applied += 1
            elif pgd.get("kit_pgd", 0.0) > 0:
                unresolved_positive.append(
                    {
                        **pgd,
                        "candidate_models": [item.get("name") for item in override_candidates],
                        "configured_target": variant_target,
                        "reason": "A regra mensal aponta para uma variante que não foi localizada de forma única no DPP atual.",
                    }
                )
                continue

        if selected is None and not variant_target:
            candidates = by_name.get(_normalize(pgd.get("name")), [])
            strategy = "EXACT_NAME"

            if not candidates:
                candidates = by_code.get(_normalize(pgd.get("code")), [])
                strategy = "PRODUCT_CODE"

            if len(candidates) == 1:
                selected = candidates[0]
            elif len(candidates) > 1:
                ranked = []
                for candidate in candidates:
                    previous = previous_by_name.get(_normalize(candidate.get("name")), {})
                    score = (
                        float(previous.get("previous_kit_pgd") or 0.0),
                        float(previous.get("previous_real") or 0.0),
                    )
                    ranked.append((score, candidate))
                ranked.sort(key=lambda item: item[0], reverse=True)
                if ranked and ranked[0][0] > (0.0, 0.0):
                    if len(ranked) == 1 or ranked[0][0] > ranked[1][0]:
                        selected = ranked[0][1]
                        strategy = "HISTORICAL_VARIANT"

            if selected is None:
                if not candidates:
                    if pgd.get("kit_pgd", 0.0) > 0:
                        out_of_scope_positive.append(pgd)
                elif pgd.get("kit_pgd", 0.0) > 0:
                    unresolved_positive.append(
                        {
                            **pgd,
                            "candidate_models": [item["name"] for item in candidates],
                        }
                    )
                else:
                    ignored_zero_ambiguous += 1
                continue

        if selected is None:
            continue

        existing = assignments.get(selected["name"])
        if existing is None or pgd.get("kit_pgd", 0.0) > existing.get("kit_pgd", 0.0):
            assignments[selected["name"]] = pgd

        mapped_records.append(
            {
                "pgd_model": pgd.get("name"),
                "pgd_code": pgd.get("code"),
                "dpp_model": selected.get("name"),
                "dpp_code": selected.get("code"),
                "kit_pgd": pgd.get("kit_pgd", 0.0),
                "kit_pgd_before_rule": pgd.get("kit_pgd_before_rule"),
                "strategy": strategy,
                "source": pgd.get("source"),
            }
        )

    models: list[dict] = []
    for current in current_models:
        pgd = assignments.get(current["name"])
        models.append(
            {
                **current,
                "kit_pgd": float(pgd.get("kit_pgd", 0.0)) if pgd else 0.0,
                "kit_pgd_raw": float(pgd.get("kit_pgd_raw", 0.0)) if pgd else 0.0,
                "pgd_source": pgd.get("source") if pgd else None,
                "real": float(pgd.get("kit_pgd", 0.0)) if pgd else 0.0,
            }
        )

    return {
        "models": models,
        "mapped": mapped_records,
        "unresolved_positive": unresolved_positive,
        "out_of_scope_positive": out_of_scope_positive,
        "ignored_zero_ambiguous": ignored_zero_ambiguous,
        "variant_overrides_applied": variant_overrides_applied,
        "kit_overrides_applied": kit_overrides_applied,
        "mapped_positive_models": sum(1 for item in models if float(item.get("kit_pgd") or 0.0) > 0),
    }


def _empty_open_investigation() -> dict:
    return {
        "pending_records": 0,
        "pending_quantity": 0.0,
        "entries_total": 0,
        "entries": [],
        "truncated": False,
        "source": None,
    }


async def generate_monthly_dpp(
    *,
    base_dpp: UploadFile,
    wiu: UploadFile,
    explosion: UploadFile,
    stock: UploadFile,
    pgd: UploadFile,
    reference_month: str,
    open_orders: UploadFile | None = None,
    progress: ProgressCallback | None = None,
) -> dict:
    _notify(progress, 4, "Validando arquivos recebidos")
    for file, label in (
        (base_dpp, "DPP base"),
        (wiu, "WIU"),
        (explosion, "Explosão"),
        (stock, "STK SAP"),
        (pgd, "PGD"),
    ):
        _validate_upload(file, label)
    if open_orders is not None:
        _validate_upload(open_orders, "OPEN")

    _notify(progress, 7, "Carregando conteúdo das planilhas")
    base_content = await base_dpp.read()
    wiu_content = await wiu.read()
    explosion_content = await explosion.read()
    stock_content = await stock.read()
    pgd_content = await pgd.read()
    open_content = await open_orders.read() if open_orders is not None else None

    for content, label in (
        (base_content, "DPP base"),
        (wiu_content, "WIU"),
        (explosion_content, "Explosão"),
        (stock_content, "STK SAP"),
        (pgd_content, "PGD"),
    ):
        if not content:
            raise ValueError(f"O arquivo {label} está vazio.")
    if open_orders is not None and not open_content:
        raise ValueError("O arquivo OPEN está vazio.")

    _notify(progress, 10, "Lendo DPP base")
    historical_map, previous_models, base_diag = parse_previous_dpp(base_content)

    _notify(progress, 18, "Lendo WIU e matriz Material × Modelo")
    wiu_materials, current_models, wiu_diag = _parse_wiu(wiu_content)

    _notify(progress, 31, "Processando Explosão de Placas")
    explosion_map, explosion_diag = _parse_explosion(explosion_content)

    _notify(progress, 42, "Processando STK SAP")
    stock_map, stock_diag = _parse_stock(stock_content)

    _notify(progress, 53, "Lendo PGD do mês")
    pgd_models, pgd_diag = parse_pgd(pgd_content, reference_month)

    open_map: dict[str, dict] = {}
    open_diag = None
    if open_content:
        _notify(progress, 60, "Lendo OPEN e evidências pendentes")
        open_map, open_diag = _parse_open(open_content)

    _notify(progress, 66, "Mapeando PGD para os modelos do DPP")
    pgd_mapping = _map_pgd_to_models(pgd_models, current_models, previous_models, reference_month)
    mapped_models = pgd_mapping.pop("models")

    _notify(progress, 72, "Consolidando base histórica com o WIU")
    merged: dict[str, dict] = {}
    for key, item in historical_map.items():
        merged[key] = {
            **deepcopy(item),
            "in_current_wiu": False,
            "wiu_source": None,
            "consumption_by_model": {},
            "used_models": [],
            "check": "",
        }

    new_materials = 0
    for current in wiu_materials:
        key = current["material_key"]
        existing = merged.get(key)
        if existing is None:
            new_materials += 1
            existing = {
                "material": current["material"],
                "material_key": key,
                "description": current.get("description"),
                "um": current.get("um"),
                "group_origin": current.get("group_origin"),
                "optional_material": None,
                "from_history": False,
                "historical_source": None,
            }
            merged[key] = existing

        existing["in_current_wiu"] = True
        # Descrição faz parte da base histórica acumulativa. Para materiais já conhecidos,
        # preservamos o texto do DPP anterior e usamos o WIU apenas se o histórico estiver vazio.
        if not existing.get("from_history") or not existing.get("description"):
            existing["description"] = current.get("description") or existing.get("description")
        existing["um"] = current.get("um") or existing.get("um")
        existing["group_origin"] = current.get("group_origin") or existing.get("group_origin")
        existing["wiu_source"] = current.get("source")
        existing["consumption_by_model"] = deepcopy(current.get("consumption_by_model", {}))
        existing["used_models"] = list(current.get("used_models", []))
        existing["check"] = current.get("check", "")

    _notify(progress, 78, "Cruzando STK, Explosão, OPCs e OPEN")
    explosion_matches = 0
    stock_matches = 0
    opc_with_stock = 0
    optional_stock_links = 0
    open_matches = 0
    unit_mismatches = 0

    for key, material in merged.items():
        explosion_entry = explosion_map.get(key)
        if explosion_entry:
            explosion_matches += 1
        material["explosion"] = float(explosion_entry.get("value", 0.0)) if explosion_entry else 0.0
        material["explosion_source"] = explosion_entry.get("source") if explosion_entry else None

        stock_entry = stock_map.get(key)
        if stock_entry:
            stock_matches += 1
        material["stock_sap"] = float(stock_entry.get("value", 0.0)) if stock_entry else 0.0
        material["stock_um"] = stock_entry.get("um") if stock_entry else None
        material["stock_source"] = stock_entry.get("source") if stock_entry else None

        conversion = _unit_conversion(material.get("stock_um"), material.get("um"))
        material["unit_conversion"] = conversion
        if conversion.get("mismatch"):
            unit_mismatches += 1
        stock_effective = material["stock_sap"]
        if conversion.get("applied") and conversion.get("factor") is not None:
            stock_effective *= float(conversion["factor"])
        material["stock_sap_effective"] = stock_effective

        optional_codes = split_optional_materials(material.get("optional_material"))
        material["optional_materials"] = optional_codes
        material["optional_material_canonical"] = canonical_optional_material(material.get("optional_material"))
        optional_sources: list[dict] = []
        optional_stock_total = 0.0
        for optional_code in optional_codes:
            optional_entry = stock_map.get(_material_key(optional_code))
            if not optional_entry:
                continue
            value = float(optional_entry.get("value", 0.0))
            optional_stock_total += value
            optional_stock_links += 1
            optional_sources.append(
                {
                    "material": optional_code,
                    "value": value,
                    "um": optional_entry.get("um"),
                    "source": optional_entry.get("source"),
                }
            )

        material["stock_op"] = optional_stock_total
        material["stock_op_sources"] = optional_sources
        if len(optional_sources) == 1:
            material["stock_op_source"] = optional_sources[0]["source"]
        elif optional_sources:
            material["stock_op_source"] = {
                "type": "MULTIPLE_OPC",
                "entries": optional_sources,
            }
        else:
            material["stock_op_source"] = None
        if optional_sources:
            opc_with_stock += 1

        material["stock_total"] = material["stock_sap_effective"] + material["explosion"] + material["stock_op"]

        open_entry = open_map.get(key)
        if open_entry:
            open_matches += 1
            material["open_investigation"] = {
                "pending_records": open_entry["pending_records"],
                "pending_quantity": open_entry["pending_quantity"],
                "entries_total": open_entry["entries_total"],
                "entries": open_entry["entries"],
                "truncated": open_entry["truncated"],
                "source": open_entry["source"],
            }
        else:
            material["open_investigation"] = _empty_open_investigation()

    historical_outside_wiu = sum(1 for item in merged.values() if item.get("from_history") and not item.get("in_current_wiu"))
    inherited_optional = sum(1 for item in merged.values() if item.get("optional_material"))

    base_summary = {
        "historical_materials": base_diag["materials"],
        "historical_outside_wiu": historical_outside_wiu,
        "new_materials_from_wiu": new_materials,
        "inherited_optional_materials": inherited_optional,
        "optional_materials_with_stock": opc_with_stock,
        "optional_stock_links": optional_stock_links,
        "explosion_matches": explosion_matches,
        "stock_matches": stock_matches,
        "open_pending_materials": open_matches,
        "open_loaded": open_content is not None,
        "unit_mismatches": unit_mismatches,
        "pgd_positive_models_raw": pgd_diag["positive_models"],
        "pgd_positive_models": pgd_mapping["mapped_positive_models"],
        "pgd_unresolved_positive": len(pgd_mapping["unresolved_positive"]),
        "pgd_out_of_scope_positive": len(pgd_mapping["out_of_scope_positive"]),
        "pgd_variant_overrides_applied": pgd_mapping["variant_overrides_applied"],
        "pgd_kit_overrides_applied": pgd_mapping["kit_overrides_applied"],
    }

    sources = [
        {"id": "base_dpp", "label": "DPP mês anterior", "required": True, "loaded": True, "filename": base_dpp.filename, "detail": f"{base_diag['materials']} materiais históricos · {base_diag['optional_materials']} OPCs"},
        {"id": "wiu", "label": "WIU", "required": True, "loaded": True, "filename": wiu.filename, "detail": f"{wiu_diag['imported_materials']} materiais importados · {wiu_diag['models']} modelos"},
        {"id": "explosion", "label": "Explosão de Placas", "required": True, "loaded": True, "filename": explosion.filename, "detail": f"{explosion_matches} materiais encontrados"},
        {"id": "stock", "label": "STK SAP", "required": True, "loaded": True, "filename": stock.filename, "detail": f"{stock_matches} materiais encontrados no snapshot"},
        {"id": "pgd", "label": "PGD", "required": True, "loaded": True, "filename": pgd.filename, "detail": f"{pgd_mapping['mapped_positive_models']} modelos aplicados ao DPP em {reference_month} · {len(pgd_mapping['out_of_scope_positive'])} positivos fora do escopo"},
        {"id": "open", "label": "OPEN", "required": False, "loaded": open_content is not None, "filename": open_orders.filename if open_orders is not None else None, "detail": f"{open_matches} materiais da base com evidência pendente" if open_content else "Opcional: evidência de investigação, sem alterar o saldo"},
    ]

    pending = [
        "REAL permanece editável pelo analista; o solver automático ainda não está habilitado.",
        "Conversões KG→G, M→CM e L→ML continuam desativadas até validação da regra operacional.",
        "Materiais fora de UM=UN são calculados, mas ficam fora da classificação OK/INVESTIGAR nesta etapa.",
        "Mapeamentos agregados do PGD usam regras mensais explícitas quando conhecidas; meses futuros sem regra continuam usando a heurística histórica e podem exigir validação.",
    ]
    if pgd_mapping["unresolved_positive"]:
        pending.append("Existem modelos positivos do PGD com variante DPP ainda ambígua; revisar o mapeamento exibido.")

    diagnostics = {
        "base_dpp": base_diag,
        "wiu": wiu_diag,
        "explosion": explosion_diag,
        "stock": stock_diag,
        "pgd": pgd_diag,
        "pgd_mapping_rules": {
            "variant_overrides_applied": pgd_mapping["variant_overrides_applied"],
            "kit_overrides_applied": pgd_mapping["kit_overrides_applied"],
        },
        "open": open_diag,
    }

    capabilities = {
        "historical_base": True,
        "cumulative_materials": True,
        "inherited_opc": True,
        "multiple_opc_stock": True,
        "historical_description": True,
        "material_model_matrix": True,
        "explosion": True,
        "stock_sap": True,
        "stock_op": True,
        "pgd_kit": True,
        "pgd_monthly_mapping_rules": True,
        "manual_real": True,
        "nec": True,
        "balance": True,
        "open_investigation": open_content is not None,
        "automatic_solver": False,
    }

    _notify(progress, 88, "Calculando NEC, STK TTL e SALDO")
    result = register_monthly_scenario(
        materials=list(merged.values()),
        models=mapped_models,
        reference_month=reference_month,
        base_summary=base_summary,
        scope=(
            "O novo DPP nasce da base histórica do mês anterior. Materiais, descrições históricas e OPCs são acumulativos; "
            "o WIU atualiza a matriz Material × Modelo, Explosão e STK atualizam a disponibilidade, "
            "o PGD fornece o KIT DISPONÍVEL do mês com regras explícitas para variantes agregadas conhecidas e o REAL inicia pelo KIT para ajuste manual."
        ),
        capabilities=capabilities,
        sources=sources,
        pending=pending,
        diagnostics=diagnostics,
        pgd_mapping=pgd_mapping,
    )
    _notify(progress, 97, "Montando resultado do Dashboard")
    return result
