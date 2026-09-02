from __future__ import annotations

import json
import math
import re
import unicodedata

from app.services.database_answer_service import DatabaseKnowledgeAnswer
from app.services.database_query_planner_service import QueryPlan
from app.services.dpp_projection_service import calculate_nec
from app.services.dpp_rule_registry import get_rule_definition, rule_evidence_text
from app.services.knowledge_service import KnowledgeChunk
from app.services.rag_runtime_service import load_runtime_entities


NUMERIC_TOLERANCE = 1e-4
MODEL_IMPACT_RULES = ("REGRA-001", "REGRA-002", "REGRA-003", "REGRA-006")


def _normalize(text: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(text or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9_.-]+", " ", normalized).strip()


def _format_number(value: object) -> str:
    if value in (None, ""):
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return str(value)
    if abs(number - round(number)) < 1e-9:
        return f"{int(round(number)):,}".replace(",", ".")
    text = f"{number:,.6f}".rstrip("0").rstrip(".")
    return text.replace(",", "X").replace(".", ",").replace("X", ".")


def _number(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _delta(final_value: object, scenario_value: object) -> float | None:
    final_number = _number(final_value)
    scenario_number = _number(scenario_value)
    if final_number is None or scenario_number is None:
        return None
    return final_number - scenario_number


def _runtime_chunk(record: dict, heading: str) -> KnowledgeChunk:
    payload = record.get("payload") or {}
    compact = {
        key: payload.get(key)
        for key in ("name", "kit_pgd", "pgd", "real", "difference_real_vs_kit", "delta")
        if key in payload
    }
    return KnowledgeChunk(
        source=str(record.get("source") or "sqlite://rag_runtime_entities/model"),
        content=json.dumps(compact, ensure_ascii=False, default=str),
        score=1000.0,
        heading=heading,
        category="current",
    )


def _impact_rules_chunk() -> KnowledgeChunk:
    evidence = "\n\n".join(rule_evidence_text(code) for code in MODEL_IMPACT_RULES if rule_evidence_text(code))
    return KnowledgeChunk(
        source="regras-globais.md",
        content=evidence,
        score=1000.0,
        heading="REGRA-001/002/003/006 — propagação determinística de REAL, NEC, STK TTL, SALDO e Amount",
        category="deterministic",
    )


def rule_knowledge_answer(plan: QueryPlan) -> DatabaseKnowledgeAnswer | None:
    if not plan.rule_entities:
        return None
    code = plan.rule_entities[0]
    item = get_rule_definition(code)
    if item is None:
        return None

    evidence = rule_evidence_text(code)
    source = str(item["source"])
    return DatabaseKnowledgeAnswer(
        answer=evidence,
        sources=[source],
        chunks=[KnowledgeChunk(
            source=source,
            content=evidence,
            score=1000.0,
            heading=f"{item['code']} — {item['title']}",
            category="deterministic",
        )],
        entities=[item["code"]],
        resolved_question=plan.resolved_question,
        context={
            "subject_type": "rule",
            "subject_key": item["code"],
            "topic": "rule_definition",
            "structured_evidence_complete": True,
        },
    )


def _parse_pt_number(token: str) -> float | None:
    text = str(token or "").strip().replace(" ", "")
    if not text:
        return None
    sign = -1.0 if text.startswith("-") else 1.0
    text = text.lstrip("+-")
    if not text or not re.fullmatch(r"\d[\d.,]*", text):
        return None

    if "." in text and "," in text:
        normalized = text.replace(".", "").replace(",", ".")
    elif "," in text:
        normalized = text.replace(".", "").replace(",", ".")
    elif "." in text:
        groups = text.split(".")
        normalized = "".join(groups) if len(groups) > 1 and all(len(group) == 3 for group in groups[1:]) else text
    else:
        normalized = text

    try:
        return sign * float(normalized)
    except ValueError:
        return None


def _question_numbers(question: str) -> list[float]:
    values: list[float] = []
    for token in re.findall(r"[-+]?\d[\d.,]*", str(question or "")):
        value = _parse_pt_number(token)
        if value is not None:
            values.append(value)
    return values


def _close(left: object, right: object) -> bool:
    try:
        a = float(left)
        b = float(right)
    except (TypeError, ValueError):
        return False
    tolerance = max(NUMERIC_TOLERANCE, abs(a) * 1e-9, abs(b) * 1e-9)
    return abs(a - b) <= tolerance


def _in_question(value: object, question_values: list[float]) -> bool:
    return any(_close(value, candidate) for candidate in question_values)


def _paired_models() -> dict[str, dict[str, dict]]:
    pairs: dict[str, dict[str, dict]] = {}
    for record in load_runtime_entities(entity_type="model"):
        key = str(record.get("entity_key") or "").strip()
        scope = str(record.get("scope") or "").strip()
        if not key or scope not in {"scenario", "final"}:
            continue
        pairs.setdefault(key, {})[scope] = record
    return pairs


def _explicit_model(question: str, context: dict, pairs: dict[str, dict[str, dict]]) -> str | None:
    normalized_question = _normalize(question)
    matches = [key for key in pairs if _normalize(key) and _normalize(key) in normalized_question]
    if matches:
        return max(matches, key=len)
    if str(context.get("subject_type") or "") == "model":
        key = str(context.get("subject_key") or "").strip()
        if key in pairs:
            return key
    return None


def _model_values(pair: dict[str, dict]) -> dict[str, object]:
    scenario_payload = (pair.get("scenario") or {}).get("payload") or {}
    final_payload = (pair.get("final") or {}).get("payload") or {}
    scenario_kit = scenario_payload.get("kit_pgd", scenario_payload.get("pgd"))
    scenario_real = scenario_payload.get("real")
    final_kit = final_payload.get("pgd", final_payload.get("kit_pgd"))
    final_real = final_payload.get("real")
    scenario_delta = scenario_payload.get("difference_real_vs_kit")
    if scenario_delta in (None, "") and scenario_real not in (None, "") and scenario_kit not in (None, ""):
        try:
            scenario_delta = float(scenario_real) - float(scenario_kit)
        except (TypeError, ValueError):
            scenario_delta = None
    final_delta = final_payload.get("delta", final_payload.get("difference_real_vs_kit"))
    if final_delta in (None, "") and final_real not in (None, "") and final_kit not in (None, ""):
        try:
            final_delta = float(final_real) - float(final_kit)
        except (TypeError, ValueError):
            final_delta = None
    return {
        "scenario_kit": scenario_kit,
        "scenario_real": scenario_real,
        "scenario_delta": scenario_delta,
        "final_kit": final_kit,
        "final_real": final_real,
        "final_delta": final_delta,
    }


def _reverse_model(question: str, pairs: dict[str, dict[str, dict]]) -> str | None:
    question_values = _question_numbers(question)
    if len(question_values) < 2:
        return None

    ranked: list[tuple[int, int, str]] = []
    for key, pair in pairs.items():
        if "scenario" not in pair or "final" not in pair:
            continue
        values = _model_values(pair)
        matched = {name: _in_question(value, question_values) for name, value in values.items() if value not in (None, "")}
        score = sum(1 for value in matched.values() if value)
        core = sum(
            1
            for name in ("scenario_kit", "scenario_real", "final_kit", "final_real", "final_delta")
            if matched.get(name)
        )
        if core >= 4 and matched.get("final_real") and matched.get("final_delta"):
            ranked.append((score, core, key))

    if not ranked:
        return None
    ranked.sort(reverse=True)
    best_score, best_core, best_key = ranked[0]
    tied = [row for row in ranked if row[:2] == (best_score, best_core)]
    return best_key if len(tied) == 1 else None


def _wants_model_impact(plan: QueryPlan) -> bool:
    normalized = _normalize(plan.original_question)
    concepts = {_normalize(item) for item in plan.concept_entities}
    return (
        bool(concepts & {"nec", "saldo", "stk ttl", "amount"})
        or "influenc" in normalized
        or "impact" in normalized
        or "afet" in normalized
    )


def _model_consumption(payload: dict, model_key: str) -> float:
    target = _normalize(model_key)
    for model_name, value in (payload.get("consumption_by_model") or {}).items():
        if _normalize(model_name) != target:
            continue
        number = _number(value)
        return number or 0.0
    return 0.0


def _material_pairs() -> tuple[list[dict], dict[str, dict]]:
    scenario_records = load_runtime_entities(entity_type="material", scope="scenario")
    final_records = {
        str(record.get("entity_key") or "").strip(): record
        for record in load_runtime_entities(entity_type="material", scope="final")
        if str(record.get("entity_key") or "").strip()
    }
    return scenario_records, final_records


def _model_impact_rows(model_key: str, scenario_real: object, final_real: object) -> tuple[list[dict], dict]:
    scenario_real_number = _number(scenario_real)
    final_real_number = _number(final_real)
    if scenario_real_number is None or final_real_number is None:
        return [], {"available": False}

    scenario_materials, final_by_key = _material_pairs()
    rows: list[dict] = []
    observed_stk_changes = 0
    paired_materials = 0
    amount_estimable = 0

    for scenario_record in scenario_materials:
        payload = scenario_record.get("payload") or {}
        consumption = _model_consumption(payload, model_key)
        if abs(consumption) <= NUMERIC_TOLERANCE:
            continue

        material_key = str(scenario_record.get("entity_key") or payload.get("material") or "").strip()
        if not material_key:
            continue
        final_record = final_by_key.get(material_key)
        final_payload = (final_record or {}).get("payload") or {}
        if final_record:
            paired_materials += 1

        isolated_material = {"consumption_by_model": {model_key: consumption}}
        nec_orion = calculate_nec(isolated_material, {model_key: scenario_real_number})
        nec_final_real_only = calculate_nec(isolated_material, {model_key: final_real_number})
        isolated_nec_effect = nec_final_real_only - nec_orion
        isolated_balance_effect = -isolated_nec_effect

        price = _number(payload.get("price"))
        isolated_amount_effect = price * isolated_balance_effect if price is not None else None
        if isolated_amount_effect is not None:
            amount_estimable += 1

        observed_nec_delta = _delta(final_payload.get("nec"), payload.get("nec")) if final_record else None
        observed_stk_delta = _delta(final_payload.get("stock_total"), payload.get("stock_total")) if final_record else None
        observed_balance_delta = _delta(final_payload.get("balance"), payload.get("balance")) if final_record else None
        if observed_stk_delta is not None and abs(observed_stk_delta) > NUMERIC_TOLERANCE:
            observed_stk_changes += 1

        rows.append({
            "material": material_key,
            "description": payload.get("description") or final_payload.get("description") or "—",
            "um": payload.get("um") or final_payload.get("um") or "—",
            "consumption": _format_number(consumption),
            "nec_effect": _format_number(isolated_nec_effect),
            "saldo_effect": _format_number(isolated_balance_effect),
            "amount_effect": _format_number(isolated_amount_effect),
            "observed_nec_delta": _format_number(observed_nec_delta),
            "observed_stk_delta": _format_number(observed_stk_delta),
            "observed_balance_delta": _format_number(observed_balance_delta),
        })

    rows.sort(key=lambda row: str(row["material"]))
    return rows, {
        "available": bool(rows),
        "impacted_materials": len(rows),
        "paired_materials": paired_materials,
        "observed_stk_changes": observed_stk_changes,
        "amount_estimable": amount_estimable,
        "real_change": final_real_number - scenario_real_number,
    }


def _impact_answer(model_key: str, values: dict[str, object]) -> tuple[str, list[dict], dict]:
    rows, summary = _model_impact_rows(model_key, values["scenario_real"], values["final_real"])
    if not summary.get("available"):
        return (
            "A relação entre REAL, NEC, SALDO, STK TTL e Amount está documentada nas regras determinísticas, "
            "mas o workspace atual não contém consumo Material × Modelo suficiente para quantificar o efeito deste modelo por material.",
            rows,
            summary,
        )

    answer = (
        f"A mudança do REAL de {model_key} alcança {summary['impacted_materials']} material(is) que possuem consumo desse modelo no Cenário ORION. "
        "Pela REGRA-001, o efeito isolado do REAL no NEC de cada material é ΔREAL × consumo do material nesse modelo; "
        "a tabela mostra esse efeito sem atribuir a ele outras mudanças de REAL ou de consumo. "
        "Pela REGRA-003, mantendo o STK TTL constante, o efeito isolado no SALDO é o oposto do efeito no NEC. "
        "Pela REGRA-002, o REAL não entra diretamente no STK TTL: STK TTL depende de STK SAP efetivo + EXPLOSÃO + STK OP. "
        f"Entre os {summary['paired_materials']} material(is) também presentes no DPP Final, {summary['observed_stk_changes']} apresentam mudança observada de STK TTL; "
        "essas mudanças precisam ser explicadas pelos componentes de estoque e não devem ser atribuídas diretamente ao REAL. "
        "Pela REGRA-006, Amount = Preço × SALDO; quando o preço do cenário está disponível, a tabela mostra também o efeito isolado estimado no Amount, "
        "mantendo o preço constante."
    )
    return answer, rows, summary


def _model_comparison_answer(plan: QueryPlan, context: dict) -> DatabaseKnowledgeAnswer:
    pairs = _paired_models()
    model_key = _explicit_model(plan.original_question, context, pairs) or _reverse_model(plan.original_question, pairs)
    if not model_key:
        return DatabaseKnowledgeAnswer(
            answer=(
                "Não consegui identificar de forma única qual modelo corresponde aos valores informados. "
                "A comparação foi interrompida para evitar associar a pergunta a um modelo incorreto. "
                "Informe o nome do modelo ou valores adicionais do mesmo registro."
            ),
            sources=[],
            chunks=[],
            entities=[],
            resolved_question=plan.resolved_question,
            context={
                "subject_type": "comparison",
                "subject_key": "modelo não resolvido",
                "topic": "model_comparison_unresolved",
                "skip_llm": True,
                "structured_evidence_complete": True,
            },
        )

    pair = pairs[model_key]
    scenario = pair.get("scenario")
    final = pair.get("final")
    if not scenario or not final:
        return DatabaseKnowledgeAnswer(
            answer=f"O modelo {model_key} não possui os dois lados necessários (Cenário ORION e DPP Final) para a comparação.",
            sources=[record["source"] for record in pair.values()],
            chunks=[],
            entities=[model_key],
            resolved_question=plan.resolved_question,
            context={
                "subject_type": "model",
                "subject_key": model_key,
                "topic": "model_comparison_incomplete",
                "skip_llm": True,
                "structured_evidence_complete": True,
            },
        )

    values = _model_values(pair)
    scenario_kit = values["scenario_kit"]
    scenario_real = values["scenario_real"]
    scenario_delta = values["scenario_delta"]
    final_kit = values["final_kit"]
    final_real = values["final_real"]
    final_delta = values["final_delta"]

    kit_unchanged = _close(scenario_kit, final_kit)
    real_changed = not _close(scenario_real, final_real)
    real_change = _delta(final_real, scenario_real)

    if kit_unchanged and real_changed:
        conclusion = (
            f"O KIT/PGD permaneceu em {_format_number(scenario_kit)} nos dois lados. "
            f"A divergência matemática está no REAL: o Cenário ORION usa {_format_number(scenario_real)} e o DPP Final registra {_format_number(final_real)}, "
            f"uma variação de {_format_number(real_change)} entre os dois cenários."
        )
    else:
        conclusion = (
            f"A comparação do modelo {model_key} mostra KIT/PGD {_format_number(scenario_kit)} no Cenário ORION e {_format_number(final_kit)} no DPP Final; "
            f"REAL {_format_number(scenario_real)} no Cenário ORION e {_format_number(final_real)} no DPP Final."
        )

    answer = (
        f"Modelo identificado pelos dados informados: {model_key}. {conclusion} "
        f"No DPP Final, a diferença REAL vs KIT/PGD é {_format_number(final_delta)}; no Cenário ORION é {_format_number(scenario_delta)}. "
        "As evidências estruturadas atuais demonstram onde a divergência ocorreu, mas não demonstram a causa operacional que levou o DPP Final a usar esse REAL. "
        "Essa causa ainda precisa ser investigada em evidências operacionais adicionais."
    )

    comparison_rows = [
        {
            "source": "Cenário ORION",
            "kit": _format_number(scenario_kit),
            "real": _format_number(scenario_real),
            "delta": _format_number(scenario_delta),
        },
        {
            "source": "DPP Final",
            "kit": _format_number(final_kit),
            "real": _format_number(final_real),
            "delta": _format_number(final_delta),
        },
    ]

    chunks = [
        _runtime_chunk(scenario, f"Modelo {model_key} · Cenário ORION"),
        _runtime_chunk(final, f"Modelo {model_key} · DPP Final"),
    ]
    sources = [scenario["source"], final["source"]]
    table = {
        "title": f"Comparação do modelo {model_key}",
        "total_rows": 2,
        "columns": [
            {"key": "source", "label": "Fonte"},
            {"key": "kit", "label": "KIT/PGD", "align": "right"},
            {"key": "real", "label": "REAL", "align": "right"},
            {"key": "delta", "label": "Diferença REAL vs KIT", "align": "right"},
        ],
        "rows": comparison_rows,
    }
    required = [[model_key], [_format_number(scenario_real)], [_format_number(final_real)], [_format_number(final_delta)]]
    topic = "model_comparison"

    if _wants_model_impact(plan):
        impact_text, impact_rows, impact_summary = _impact_answer(model_key, values)
        answer = f"{answer} {impact_text}"
        rules_chunk = _impact_rules_chunk()
        chunks = [rules_chunk, *chunks]
        if "regras-globais.md" not in sources:
            sources.append("regras-globais.md")
        required.extend([["NEC"], ["SALDO"], ["STK TTL"], ["Amount"]])
        topic = "model_real_impact"
        if impact_rows:
            display_rows = impact_rows[:50]
            table = {
                "title": f"Impacto isolado do ΔREAL de {model_key} por material",
                "total_rows": len(display_rows),
                "columns": [
                    {"key": "material", "label": "Material", "kind": "code"},
                    {"key": "description", "label": "Descrição", "kind": "description"},
                    {"key": "um", "label": "UM"},
                    {"key": "consumption", "label": "Consumo no modelo", "align": "right"},
                    {"key": "nec_effect", "label": "Efeito isolado no NEC", "align": "right"},
                    {"key": "saldo_effect", "label": "Efeito isolado no SALDO", "align": "right"},
                    {"key": "amount_effect", "label": "Efeito no Amount*", "align": "right"},
                    {"key": "observed_stk_delta", "label": "Δ STK TTL observado", "align": "right"},
                ],
                "rows": display_rows,
                "note": (
                    f"{impact_summary.get('impacted_materials', len(display_rows))} material(is) impactados no total. "
                    "*Amount considera o preço do Cenário ORION constante. Os efeitos de NEC/SALDO isolam somente a mudança de REAL deste modelo."
                ),
            }

    return DatabaseKnowledgeAnswer(
        answer=answer,
        sources=sources,
        chunks=chunks,
        entities=[model_key],
        table=table,
        resolved_question=plan.resolved_question,
        context={
            "subject_type": "model",
            "subject_key": model_key,
            "topic": topic,
            "structured_evidence_complete": True,
            "compact_llm": True,
            "operational_cause_demonstrated": False,
            "required_answer_terms": required,
        },
    )


def structured_knowledge_answer(plan: QueryPlan, context: dict | None = None) -> tuple[DatabaseKnowledgeAnswer | None, str]:
    context = context or {}

    # Regra explicitamente citada na pergunta atual tem prioridade. Regra herdada do
    # contexto não pode sequestrar uma comparação nova e autossuficiente.
    explicit_rules = [code for code in plan.rule_entities if code not in plan.context_rule_entities]
    if explicit_rules:
        rule = rule_knowledge_answer(plan)
        if rule is not None:
            return rule, "rule-registry"

    if plan.intent == "comparison":
        return _model_comparison_answer(plan, context), "model-comparison"

    if plan.context_rule_entities:
        rule = rule_knowledge_answer(plan)
        if rule is not None:
            return rule, "rule-registry"

    return None, ""
