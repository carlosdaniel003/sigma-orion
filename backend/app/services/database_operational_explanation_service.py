from __future__ import annotations

"""Explicações operacionais fundamentadas para DPP, Dashboard e investigações.

Sem conhecimento inventado: textos vêm da fonte única de módulos, métricas de
entidades sincronizadas e fórmulas de regras versionadas. Não investiga causa
operacional por associação lexical nem altera qualquer resultado do DPP.
"""

import math
import re
import unicodedata

from app.services.database_answer_service import (
    DatabaseKnowledgeAnswer, _format_number, _runtime_chunk, _find_exact_entity_key,
)
from app.services.knowledge_service import KnowledgeChunk
from app.services.module_info_service import MODULE_INFO_SOURCE, load_module_info
from app.services.rag_runtime_service import load_runtime_entities


# Sinônimos de navegação; a definição de cada módulo continua em
# knowledge/modulos-interface.md, não neste roteador.
MODULE_ALIASES: dict[str, tuple[str, ...]] = {
    "dashboard.overview": (
        "dashboard do dpp", "painel do dpp", "visao geral do dashboard",
        "visao geral do dpp", "dashboard", "painel principal",
    ),
    "dashboard.package": (
        "pacote compartilhado", "pacote mensal", "arquivos mensais",
        "arquivos de entrada", "fontes do dpp", "fontes do cenario",
        "arquivo do mes", "arquivos do mes",
    ),
    "dashboard.export": (
        "excel do cenario", "exportacao do cenario", "baixar excel",
        "exportar o dpp", "exportar o cenario",
    ),
    "dashboard.evolution": (
        "evolucao do dpp", "evolucao orion", "evolucao entre",
    ),
    "dashboard.agent_bridge": (
        "agente orion", "papel da ia", "o agente decide",
        "o agente calcula", "inteligencia artificial no dpp",
    ),
    "dashboard.scenario_comparison": (
        "orion x dpp final", "orion vs dpp final", "cenario vs dpp final",
        "cenario orion e dpp final", "cenario orion", "comparacao do cenario",
        "comparacao orion", "dpp final e orion", "dpp final",
    ),
    "dashboard.planning": (
        "aderencia do planejamento", "gap pgd", "pgd x real",
        "kit disponivel pgd", "planejamento versus realizado",
    ),
    "dashboard.quality": (
        "qualidade dos dados", "integridade dos dados", "confiabilidade das fontes",
        "mapeamentos pendentes", "mapeamento pgd",
    ),
    "dashboard.investigations_summary": (
        "resumo das investigacoes", "resumo operacional", "indicadores de investigacao",
        "seis indicadores", "resumo das pendencias",
    ),
    "dashboard.pending_validations": (
        "pendencias de validacao", "validacoes pendentes",
        "aguardando validacao", "pendentes de aprovacao",
    ),
    "dashboard.monthly_gap_projection": (
        "gap recalculado", "gap fisico", "projecao do gap",
        "falta sem explicacao", "deficit projetado",
    ),
    "dashboard.monthly_gap_approval": (
        "aplicacao do gap", "aprovacao do gap", "confirmacao do gap",
        "confirmar e aplicar", "alterar o dpp", "atualizacao do dpp aprovado",
    ),
    "dashboard.stock_divergence": (
        "divergencia de estoque", "investigacao de estoque",
        "investigacoes de estoque", "almoxarifado", "m221", "p277",
    ),
    "dashboard.quality_investigation": (
        "analise de qualidade", "investigacao de qualidade",
        "investigacoes de qualidade", "controle de qualidade", "q239", "q273",
        "qualidade", "refugo", "scrap", "encaminhado ao cq",
        "encaminhamento para qualidade",
    ),
    "dashboard.guide": (
        "como ler o cenario", "guia do cenario", "leitura do dashboard",
    ),
    "dashboard.final_model_plan": (
        "plano consolidado", "planejamento por modelo",
        "real por modelo", "kit por modelo",
    ),
    "dashboard.column_comparison": (
        "comparativo de colunas", "comparacao das colunas",
        "colunas divergentes", "divergencia de colunas",
    ),
    "tests.overview": ("testes do dpp", "tela de testes", "teste do dpp"),
    "tests.preparation": ("preparacao do teste",),
    "tests.month": ("mes que sera reconstruido",),
    "tests.shared_package": ("pacote compartilhado do teste",),
    "tests.execution": ("execucao do teste", "executar o teste"),
    "tests.verdict": ("veredito do teste", "resultado do teste"),
    "tests.controlled_real": ("real controlado",),
    "tests.validation_summary": ("resumo das validacoes do teste",),
    "tests.field_comparison": ("comparacao campo a campo",),
    "tests.orion_differences": ("divergencias do orion",),
    "tests.human_interventions": ("intervencoes humanas",),
    "tests.legacy_corrections": ("correcoes do legado",),
}

EXPLAIN_MARKERS = (
    "o que", "qual a finalidade", "qual e a finalidade", "para que",
    "por que", "porque", "como funciona", "como e feito", "como e gerado",
    "como e montado", "explique", "explica", "descreva", "detalhe",
    "qual o objetivo", "qual e o objetivo", "de onde vem", "de onde veio",
    "qual a origem", "o que acontece", "o que ocorre",
    "como interpretar", "como ler", "qual a diferenca",
    "como sao", "como se", "por qual motivo",
)
NUMERIC_MARKERS = (
    "quantos", "quantas", "quanto", "qual o valor", "qual e o valor",
    "qual o total", "qual e o total", "qual a quantidade",
    "mostre o indicador", "informe o total", "informe a quantidade",
)

# Somente métricas materializadas no workspace; jamais inventar cobertura
# ou indicadores de risco do Cenário ORION a partir de colunas insuficientes.
METRICS: dict[str, tuple[tuple[str, ...], str, str, str]] = {
    "kit_pgd_total": (
        ("kit pgd total", "total de kit pgd", "total de pgd", "pgd total", "kit disponivel pgd", "total do kit"),
        "KIT disponível PGD", "scenario", "kit_pgd_total",
    ),
    "real_total": (
        ("real planejado", "total de real", "real total", "producao real planejada"),
        "REAL planejado", "scenario", "real_total",
    ),
    "materials": (
        ("total de materiais", "quantidade de materiais", "quantos materiais"),
        "Materiais do cenário", "scenario", "materials",
    ),
    "models": (
        ("quantos modelos", "total de modelos", "quantidade de modelos"),
        "Modelos do cenário", "scenario", "models",
    ),
    "models_above_kit": (
        ("modelos acima do kit", "modelos acima do pgd", "modelos acima do planejamento", "real acima do kit"),
        "Modelos com REAL acima do KIT", "scenario", "models_above_kit",
    ),
    "outside_scope_um": (
        ("materiais fora do escopo", "fora do escopo um", "materiais nao un"),
        "Materiais fora do escopo de UM=UN", "scenario", "outside_scope_um",
    ),
    "negative_balance_all_units": (
        ("saldos negativos em todas as unidades", "saldos negativos todas um",
         "materiais com saldo negativo", "itens com saldo negativo"),
        "Materiais com SALDO negativo em todas as UMs", "scenario", "negative_balance_all_units",
    ),
    "active_models": (
        ("modelos ativos",), "Modelos ativos", "final", "active_models",
    ),
    "risk_models": (
        ("modelos em risco",), "Modelos em risco", "final", "risk_models",
    ),
    "safe_models": (
        ("modelos sem restricao material", "modelos sem risco", "modelos seguros"),
        "Modelos sem restrição material", "final", "safe_models",
    ),
    "material_coverage": (
        ("cobertura material", "cobertura de materiais"), "Cobertura material", "final", "material_coverage",
    ),
    "pgd_exposed": (
        ("pgd exposto",), "PGD exposto", "final", "pgd_exposed",
    ),
    "opc_count": (
        ("total de opc", "quantos opc", "quantidade de opc", "opcs cadastrados"),
        "Quantidade de OPCs", "final", "opc_count",
    ),
}

METRIC_MODULES = {
    "kit_pgd_total": "dashboard.planning", "real_total": "dashboard.planning",
    "materials": "dashboard.overview", "models": "dashboard.overview",
    "models_above_kit": "dashboard.planning", "outside_scope_um": "dashboard.quality",
    "negative_balance_all_units": "dashboard.stock_divergence",
    "active_models": "dashboard.scenario_comparison",
    "risk_models": "dashboard.scenario_comparison",
    "safe_models": "dashboard.scenario_comparison",
    "material_coverage": "dashboard.scenario_comparison",
    "pgd_exposed": "dashboard.scenario_comparison",
    "opc_count": "dashboard.evolution",
}


def _normalize(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _contains(text: str, phrase: str) -> bool:
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])", text))


def _is_explanation(question: str) -> bool:
    q = _normalize(question)
    return any(_contains(q, marker) for marker in EXPLAIN_MARKERS)


def _question_mentions_explicit_entity(question: str) -> bool:
    # Perguntas de PN/modelo específico devem consultar seus fatos antes da
    # documentação geral sobre a área ou o indicador mencionado.
    return bool(_find_exact_entity_key(question, "material") or _find_exact_entity_key(question, "model"))


def _module_key(question: str, context: dict) -> str | None:
    q = _normalize(question)
    matches = [
        (len(alias), key)
        for key, aliases in MODULE_ALIASES.items()
        for value in aliases
        if (alias := _normalize(value)) and _contains(q, alias)
    ]
    if matches:
        matches.sort(reverse=True)
        return matches[0][1]
    if _is_explanation(question):
        # "O que isso mostra?" após descrição de um painel pode herdar o foco
        # somente se for um módulo explicitamente selecionado na sessão.
        previous_key = str(context.get("subject_key") or "")
        if context.get("subject_type") == "module" and _contains(q, "isso"):
            return previous_key
    return None


def _module_chunk(key: str, title: str, what: str, source: str, purpose: str) -> KnowledgeChunk:
    return KnowledgeChunk(
        source=MODULE_INFO_SOURCE,
        heading=f"{key} — {title}",
        content=f"O que mostra: {what}\nOrigem: {source}\nFinalidade: {purpose}",
        score=1000.0,
        category="operational",
    )


def _module_answer(question: str, key: str) -> DatabaseKnowledgeAnswer | None:
    item = load_module_info().get(key)
    if item is None:
        return None
    # Esta seção é expositiva, não explica a causa de uma divergência real.
    answer = (
        f"**{item.title}**\n\n"
        f"**O que mostra:** {item.what}\n\n"
        f"**De onde vêm os dados:** {item.source}\n\n"
        f"**Para que serve / por quê:** {item.purpose}"
    )
    return DatabaseKnowledgeAnswer(
        answer=answer, sources=[MODULE_INFO_SOURCE],
        chunks=[_module_chunk(key, item.title, item.what, item.source, item.purpose)],
        resolved_question=question,
        context={
            "subject_type": "module", "subject_key": key, "topic": "operational_explanation",
            "structured_evidence_complete": True, "skip_llm": True,
        },
    )


def _numeric(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _metric_answer(question: str, key: str) -> DatabaseKnowledgeAnswer:
    _, label, default_scope, column = METRICS[key]
    requested = _normalize(question)
    scope = "final" if _contains(requested, "dpp final") else "scenario" if (
        _contains(requested, "cenario orion") or _contains(requested, "no cenario")
    ) else default_scope

    entity_type = "final_summary" if scope == "final" else "scenario_summary"
    summaries = load_runtime_entities(entity_type=entity_type, scope=scope)
    record = summaries[0] if summaries else None
    p = (record or {}).get("payload") or {}
    summary = p.get("summary") or {}
    scoped_column = {
        "materials": "total_materials", "models": "model_count",
        "kit_pgd_total": "pgd_total",
    }.get(column, column) if scope == "final" else column
    value = summary.get(scoped_column)
    source = [record["source"]] if record else []
    items = [_runtime_chunk(record, f"Indicador {label} · {scope}")] if record else []

    # Nunca obter o valor do DPP Final quando o pedido é do Cenário ORION
    # (nem o contrário). Falta de indicador != zero.
    if _numeric(value) is None:
        msg = (
            f"O indicador **{label}** não possui valor disponível no resumo "
            f"do {'DPP Final' if scope == 'final' else 'Cenário ORION'} sincronizado. "
            "Não é possível afirmar que o valor é zero."
        )
    else:
        msg = (
            f"**Fato:** {label} no {'DPP Final' if scope == 'final' else 'Cenário ORION'}: "
            f"{_format_number(value)}{'%' if key == 'material_coverage' else ''}. "
            "Valor consultado diretamente no resumo sincronizado, não estimado pela IA."
        )
    if key == "material_coverage":
        msg += (
            "\n\n**Definição:** cobertura material = "
            "modelos ativos sem nenhum material UN com SALDO negativo ÷ modelos ativos × 100. "
            "Não representa percentual da quantidade produzível."
        )
    elif key == "risk_models":
        msg += "\n\n**Definição:** modelos com restrição de material UN crítico; não comprova impossibilidade física absoluta de produzir."
    elif key in {"kit_pgd_total", "real_total"}:
        msg += "\n\n**Origem:** planejamento PGD mapeado e REAL calculado/ajustado no Cenário ORION, conforme a documentação do Dashboard."
    else:
        msg += "\n\n**Interpretação:** quantidade do cenário ou fechamento consultado; divergência e causa operacional exigem análise das evidências específicas."
    module = load_module_info().get(METRIC_MODULES[key])
    if module:
        source.append(MODULE_INFO_SOURCE)
        items.append(_module_chunk(module.key, module.title, module.what, module.source, module.purpose))
    return DatabaseKnowledgeAnswer(
        answer=msg, sources=source, chunks=items, resolved_question=question,
        context={
            "subject_type": "metric", "subject_key": key, "topic": "operational_metric",
            "structured_evidence_complete": True, "skip_llm": True,
        },
    )


def _process_overview(question: str) -> DatabaseKnowledgeAnswer:
    modules = load_module_info()
    chosen = [
        modules[key] for key in (
            "dashboard.package", "dashboard.overview", "dashboard.stock_divergence",
            "dashboard.quality_investigation", "dashboard.monthly_gap_approval",
        )
        if key in modules
    ]
    paragraphs = ["**Fluxo documentado do DPP e do Dashboard**"]
    for index, item in enumerate(chosen, 1):
        paragraphs.append(f"{index}. **{item.title}:** {item.what} **Finalidade:** {item.purpose}")
    paragraphs.append(
        "**Limite das conclusões:** o Cenário ORION é calculado em Python; "
        "Estoque e Qualidade registram evidências e decisões humanas. "
        "Um depósito com quantidade bruta não equivale a liberação, e "
        "uma divergência matemática não identifica por si só sua causa."
    )
    return DatabaseKnowledgeAnswer(
        answer="\n\n".join(paragraphs),
        sources=[MODULE_INFO_SOURCE],
        chunks=[
            _module_chunk(m.key, m.title, m.what, m.source, m.purpose)
            for m in chosen
        ],
        resolved_question=question,
        context={
            "subject_type": "module", "subject_key": "dashboard.overview",
            "topic": "dpp_operational_flow", "structured_evidence_complete": True,
            "skip_llm": True,
        },
    )


def answer_operational_explanation(
    question: str, context: dict | None = None,
) -> DatabaseKnowledgeAnswer | None:
    context = context or {}
    q = _normalize(question)
    if not q:
        return None
    # Não capturar perguntas que exigem classificação sobre PNs/modelos reais,
    # números específicos ou interpretação da regra determinística literal.
    if _question_mentions_explicit_entity(question):
        return None
    if re.search(r"\bregra\s*0\d{2}\b", q):
        return None
    if not _is_explanation(question) and not any(
        _contains(q, marker) for marker in NUMERIC_MARKERS
    ):
        return None

    metric_requested = any(_contains(q, marker) for marker in NUMERIC_MARKERS)
    # "por que cobertura material é diferente?" solicita a definição, não
    # um número causal não demonstrado.
    if metric_requested or _is_explanation(question):
        matches = [
            (len(alias), key)
            for key, (aliases, _, _, _) in METRICS.items()
            for raw in aliases if (alias := _normalize(raw)) and _contains(q, alias)
        ]
        if matches:
            matches.sort(reverse=True)
            return _metric_answer(question, matches[0][1])

    if any(_contains(q, item) for item in (
        "fluxo completo do dpp", "fluxo do dpp", "processo inteiro do dpp",
        "etapas do dpp", "dpp do inicio ao fim", "como e feito o dpp",
        "como o dpp e gerado", "como funciona o dpp", "como montar o dpp",
    )):
        return _process_overview(question)

    # "Por que este PN teve divergência na Qualidade?" sem código mas com foco
    # em PN selecionado deve seguir o executor de investigação, não o glossário.
    if context.get("subject_type") == "material" and re.search(
        r"\b(?:esse|este|desse|deste|ele|dele)\s+(?:pn|material|item)\b", q
    ):
        return None

    module_key = _module_key(question, context)
    if not module_key:
        return None

    # Questões quantitativas como "quais materiais na Qualidade" não são
    # explicações de módulo e continuam no executor de investigações.
    if metric_requested and not _is_explanation(question):
        return None
    if _is_explanation(question):
        return _module_answer(question, module_key)
    return None
