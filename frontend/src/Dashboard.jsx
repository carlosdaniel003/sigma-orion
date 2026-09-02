import { useMemo } from 'react'
import './dashboard.css'
import './dashboard-state.css'
import './dashboard-comparison-metrics.css'

const NUMERIC_TOLERANCE = 1e-4

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value, digits = 0) {
  return number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function formatPercent(value) {
  return `${number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function normalizeKey(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR')
}

function sameNumber(left, right) {
  return Math.abs(number(left) - number(right)) <= NUMERIC_TOLERANCE
}

function formatSignedNumber(value, digits = 0, unit = '') {
  const numeric = number(value)
  if (sameNumber(numeric, 0)) return `0${unit ? ` ${unit}` : ''}`
  const sign = numeric > 0 ? '+' : '−'
  return `${sign}${formatNumber(Math.abs(numeric), digits)}${unit ? ` ${unit}` : ''}`
}

function modelNumericDivergences(orionModels, finalModels, orionField, finalField) {
  const orionMap = new Map((orionModels || []).map((model) => [normalizeKey(model.name), number(model[orionField])]))
  const finalMap = new Map((finalModels || []).map((model) => [normalizeKey(model.name), number(model[finalField])]))
  const keys = new Set([...orionMap.keys(), ...finalMap.keys()])
  let differences = 0

  keys.forEach((key) => {
    if (!orionMap.has(key) || !finalMap.has(key) || !sameNumber(orionMap.get(key), finalMap.get(key))) {
      differences += 1
    }
  })

  return differences
}

function symmetricDifferenceCount(leftValues, rightValues) {
  const left = new Set((leftValues || []).map(normalizeKey).filter(Boolean))
  const right = new Set((rightValues || []).map(normalizeKey).filter(Boolean))
  let differences = 0

  left.forEach((value) => {
    if (!right.has(value)) differences += 1
  })
  right.forEach((value) => {
    if (!left.has(value)) differences += 1
  })

  return differences
}

function activeModelsForMaterial(material, realLookup) {
  return Object.entries(material.consumption_by_model || {})
    .filter(([modelName, usage]) => number(usage) > 0 && number(realLookup[modelName]) > 0)
    .map(([modelName]) => modelName)
}

function buildDashboardData(scenario) {
  const models = scenario?.models || []
  const materials = scenario?.materials || []
  const summary = scenario?.summary || {}
  const realLookup = Object.fromEntries(models.map((model) => [model.name, number(model.real)]))

  const pgdTotal = number(summary.kit_pgd_total ?? models.reduce((total, model) => total + number(model.kit_pgd), 0))
  const realTotal = number(summary.real_total ?? models.reduce((total, model) => total + number(model.real), 0))
  const gap = pgdTotal - realTotal
  const realVsPgd = pgdTotal > 0 ? (realTotal / pgdTotal) * 100 : 0

  const activeModels = models.filter((model) => number(model.real) > 0)
  const criticalMaterials = materials.filter((material) => material.status === 'INVESTIGAR')
  const riskModelNames = new Set()

  criticalMaterials.forEach((material) => {
    activeModelsForMaterial(material, realLookup).forEach((modelName) => riskModelNames.add(modelName))
  })

  const riskModels = activeModels.filter((model) => riskModelNames.has(model.name))
  const safeModels = Math.max(activeModels.length - riskModels.length, 0)
  const materialCoverage = activeModels.length ? (safeModels / activeModels.length) * 100 : 0
  const pgdExposed = riskModels.reduce((total, model) => total + number(model.kit_pgd), 0)

  const sharedCritical = criticalMaterials.filter(
    (material) => activeModelsForMaterial(material, realLookup).length > 1,
  )

  const requiredSources = (scenario?.sources || []).filter((source) => source.id !== 'open')
  const loadedRequiredSources = requiredSources.filter((source) => source.loaded).length
  const pgdPending = number(summary.pgd_unresolved_positive)

  return {
    models,
    materials,
    summary,
    pgdTotal,
    realTotal,
    gap,
    realVsPgd,
    activeModels,
    riskModels,
    safeModels,
    materialCoverage,
    pgdExposed,
    criticalMaterials,
    sharedCritical,
    requiredSources,
    loadedRequiredSources,
    pgdPending,
  }
}

function Dashboard({ scenario, onNavigate, finalDppAnalysis }) {
  const data = useMemo(() => buildDashboardData(scenario), [scenario])

  const initialState = scenario ? {
    pgd: data.pgdTotal,
    real: data.realTotal,
    critical: data.criticalMaterials.length,
    opc: number(data.summary.inherited_optional_materials),
    activeModels: data.activeModels.length,
  } : null

  const finalSummary = finalDppAnalysis?.summary || null
  const finalState = finalSummary ? {
    pgd: number(finalSummary.pgd_total),
    real: number(finalSummary.real_total),
    critical: number(finalSummary.critical_materials),
    opc: number(finalSummary.opc_count),
    activeModels: number(finalSummary.active_models),
  } : null

  return (
    <>
      <header className="page-header dashboard-header">
        <div>
          <span className="eyebrow">VISÃO OPERACIONAL</span>
          <h2>Visão Geral do cenário inicial gerado pelo ORION</h2>
          <p>
            Esta visão mostra o DPP criado pelo motor Python antes dos ajustes, investigações e decisões manuais do analista.
            {scenario && <> Cenário analisado: <strong>{formatMonth(scenario.reference_month)}</strong>.</>}
          </p>
        </div>
      </header>

      {!scenario ? (
        <EmptyDashboard onNavigate={onNavigate} />
      ) : (
        <>
          <EvolutionPanel initial={initialState} finalState={finalState} />

          <AiBridge initial={initialState} finalState={finalState} />

          <ScenarioComparison data={data} finalDppAnalysis={finalDppAnalysis} />

          <PlanningPanel data={data} />

          <section className="dashboard-grid-main dashboard-footer-grid">
            <QualityPanel data={data} />
            <DecisionGuide />
          </section>
        </>
      )}
    </>
  )
}

function ScenarioComparison({ data, finalDppAnalysis }) {
  const finalSummary = finalDppAnalysis?.summary || null
  const finalModels = finalDppAnalysis?.models || []
  const hasFinal = Boolean(finalSummary)
  const finalPgd = hasFinal ? number(finalSummary.pgd_total) : 0
  const finalReal = hasFinal ? number(finalSummary.real_total) : 0
  const finalGap = finalPgd - finalReal
  const finalRealVsPgd = finalPgd > 0 ? (finalReal / finalPgd) * 100 : 0

  const pgdModelDiffs = hasFinal ? modelNumericDivergences(data.models, finalModels, 'kit_pgd', 'pgd') : 0
  const realModelDiffs = hasFinal ? modelNumericDivergences(data.models, finalModels, 'real', 'real') : 0
  const riskModelDiffs = hasFinal
    ? symmetricDifferenceCount(
        data.riskModels.map((model) => model.name),
        finalModels.filter((model) => model.at_risk).map((model) => model.name),
      )
    : 0
  const criticalMaterialDiffs = hasFinal
    ? symmetricDifferenceCount(
        data.criticalMaterials.map((material) => material.material || material.material_key),
        finalDppAnalysis?.critical_materials || [],
      )
    : 0
  const sharedCriticalDiffs = hasFinal
    ? symmetricDifferenceCount(
        data.sharedCritical.map((material) => material.material || material.material_key),
        finalDppAnalysis?.shared_critical_materials || [],
      )
    : 0

  function numericDivergence(orionValue, finalValue, unit, modelDiffs = 0) {
    if (!hasFinal) return null
    const delta = finalValue - orionValue
    const parts = []
    if (!sameNumber(delta, 0)) parts.push(`Δ total ${formatSignedNumber(delta, 0, unit)}`)
    if (modelDiffs > 0) parts.push(`${formatNumber(modelDiffs)} modelo(s) divergente(s)`)
    return parts.length ? parts.join(' · ') : 'Sem divergência'
  }

  function countDivergence(count, noun) {
    if (!hasFinal) return null
    return count > 0 ? `${formatNumber(count)} ${noun} com classificação diferente` : 'Sem divergência'
  }

  const coverageDelta = hasFinal ? number(finalSummary.material_coverage) - data.materialCoverage : 0
  const riskCountDelta = hasFinal ? number(finalSummary.risk_models) - data.riskModels.length : 0
  const activeCountDelta = hasFinal ? number(finalSummary.active_models) - data.activeModels.length : 0
  const materialTotalDelta = hasFinal ? number(finalSummary.total_materials) - data.materials.length : 0

  const coverageDivergence = !hasFinal
    ? null
    : sameNumber(coverageDelta, 0) && riskModelDiffs === 0
      ? 'Sem divergência'
      : [
          !sameNumber(coverageDelta, 0) ? `Δ ${formatSignedNumber(coverageDelta, 1, 'p.p.')}` : null,
          riskModelDiffs > 0 ? `${formatNumber(riskModelDiffs)} modelo(s) com situação diferente` : null,
        ].filter(Boolean).join(' · ')

  const riskDivergence = !hasFinal
    ? null
    : riskModelDiffs === 0 && sameNumber(activeCountDelta, 0) && sameNumber(riskCountDelta, 0)
      ? 'Sem divergência'
      : [
          riskModelDiffs > 0 ? `${formatNumber(riskModelDiffs)} modelo(s) com risco diferente` : null,
          !sameNumber(riskCountDelta, 0) ? `Δ em risco ${formatSignedNumber(riskCountDelta)}` : null,
          !sameNumber(activeCountDelta, 0) ? `Δ ativos ${formatSignedNumber(activeCountDelta)}` : null,
        ].filter(Boolean).join(' · ')

  const criticalDivergence = !hasFinal
    ? null
    : criticalMaterialDiffs === 0 && sameNumber(materialTotalDelta, 0)
      ? 'Sem divergência'
      : [
          criticalMaterialDiffs > 0 ? `${formatNumber(criticalMaterialDiffs)} material(is) com situação crítica diferente` : null,
          !sameNumber(materialTotalDelta, 0) ? `Δ base ${formatSignedNumber(materialTotalDelta)} material(is)` : null,
        ].filter(Boolean).join(' · ')

  const rows = [
    {
      label: 'PGD do mês',
      description: 'Referência mensal de produção.',
      orionValue: `${formatNumber(data.pgdTotal)} un.`,
      orionDetail: 'PGD mapeado pelo motor ORION',
      finalValue: hasFinal ? `${formatNumber(finalPgd)} un.` : null,
      finalDetail: hasFinal ? 'KIT Disponível PGD lido no DPP Final' : null,
      divergence: numericDivergence(data.pgdTotal, finalPgd, 'un.', pgdModelDiffs),
    },
    {
      label: 'REAL planejado',
      description: 'Quantidade planejada por modelo.',
      orionValue: `${formatNumber(data.realTotal)} un.`,
      orionDetail: `${formatPercent(data.realVsPgd)} do PGD`,
      finalValue: hasFinal ? `${formatNumber(finalReal)} un.` : null,
      finalDetail: hasFinal ? `${formatPercent(finalRealVsPgd)} do PGD` : null,
      divergence: numericDivergence(data.realTotal, finalReal, 'un.', realModelDiffs),
    },
    {
      label: 'Gap PGD × REAL',
      description: 'Diferença entre referência e planejamento.',
      orionValue: `${formatNumber(Math.abs(data.gap))} un.`,
      orionDetail: gapDescription(data.gap),
      finalValue: hasFinal ? `${formatNumber(Math.abs(finalGap))} un.` : null,
      finalDetail: hasFinal ? gapDescription(finalGap) : null,
      divergence: hasFinal && sameNumber(finalGap, data.gap) ? 'Sem divergência' : hasFinal ? `Δ ${formatSignedNumber(finalGap - data.gap, 0, 'un.')}` : null,
    },
    {
      label: 'Cobertura material do REAL',
      description: 'Modelos ativos sem material UN negativo.',
      orionValue: formatPercent(data.materialCoverage),
      orionDetail: `${data.safeModels} de ${data.activeModels.length} modelos ativos cobertos`,
      finalValue: hasFinal ? formatPercent(finalSummary.material_coverage) : null,
      finalDetail: hasFinal ? `${formatNumber(finalSummary.safe_models)} de ${formatNumber(finalSummary.active_models)} modelos ativos cobertos` : null,
      divergence: coverageDivergence,
    },
    {
      label: 'Modelos em risco',
      description: 'Modelos ativos ligados a material crítico.',
      orionValue: `${data.riskModels.length}/${data.activeModels.length}`,
      orionDetail: `${data.models.length} modelos na base`,
      finalValue: hasFinal ? `${formatNumber(finalSummary.risk_models)}/${formatNumber(finalSummary.active_models)}` : null,
      finalDetail: hasFinal ? `${formatNumber(finalSummary.model_count)} modelos na base` : null,
      divergence: riskDivergence,
    },
    {
      label: 'Materiais críticos',
      description: 'Materiais UN com SALDO negativo.',
      orionValue: formatNumber(data.criticalMaterials.length),
      orionDetail: `${formatNumber(data.materials.length)} analisados`,
      finalValue: hasFinal ? formatNumber(finalSummary.critical_materials) : null,
      finalDetail: hasFinal ? `${formatNumber(finalSummary.total_materials)} analisados` : null,
      divergence: criticalDivergence,
    },
    {
      label: 'PGD exposto',
      description: 'PGD de modelos ligados a material crítico.',
      orionValue: `${formatNumber(data.pgdExposed)} un.`,
      orionDetail: 'Exposição calculada no cenário ORION',
      finalValue: hasFinal ? `${formatNumber(finalSummary.pgd_exposed)} un.` : null,
      finalDetail: hasFinal ? 'Exposição recalculada no DPP Final' : null,
      divergence: numericDivergence(data.pgdExposed, number(finalSummary?.pgd_exposed), 'un.'),
    },
    {
      label: 'Críticos compartilhados',
      description: 'Materiais críticos que afetam mais de um modelo ativo.',
      orionValue: formatNumber(data.sharedCritical.length),
      orionDetail: 'Cenário ORION',
      finalValue: hasFinal ? formatNumber(finalSummary.shared_critical) : null,
      finalDetail: hasFinal ? 'DPP Final' : null,
      divergence: countDivergence(sharedCriticalDiffs, 'material(is) compartilhado(s)'),
    },
  ]

  const divergentRows = hasFinal ? rows.filter((row) => row.divergence !== 'Sem divergência').length : 0

  return (
    <section className="panel dashboard-scenario-comparison">
      <div className="panel-header">
        <div>
          <h3>ORION × DPP Final</h3>
          <p>Compara os principais indicadores do cenário gerado pelo ORION com o consolidado real e aponta onde os resultados divergem.</p>
        </div>
        <span className={`status ${hasFinal && divergentRows === 0 ? 'comparison-ok' : hasFinal ? 'comparison-warning' : ''}`}>
          {hasFinal ? `${divergentRows} indicador(es) com divergência` : 'Aguardando DPP Final'}
        </span>
      </div>

      <div className="scenario-comparison-grid" role="table" aria-label="Comparação entre cenário ORION e DPP Final">
        <div className="scenario-comparison-head" role="row">
          <span role="columnheader">Indicador</span>
          <span role="columnheader">Cenário ORION</span>
          <span role="columnheader">DPP Final</span>
          <span role="columnheader">Divergência</span>
        </div>
        {rows.map((row) => (
          <ComparisonMetricRow key={row.label} {...row} hasFinal={hasFinal} />
        ))}
      </div>
    </section>
  )
}

function ComparisonMetricRow({ label, description, orionValue, orionDetail, finalValue, finalDetail, divergence, hasFinal }) {
  const matches = hasFinal && divergence === 'Sem divergência'
  return (
    <div className="scenario-comparison-row" role="row">
      <div className="scenario-comparison-label" role="cell">
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <div className="scenario-comparison-value orion" role="cell">
        <strong>{orionValue}</strong>
        <small>{orionDetail}</small>
      </div>
      <div className="scenario-comparison-value final" role="cell">
        <strong>{hasFinal ? finalValue : '—'}</strong>
        <small>{hasFinal ? finalDetail : 'Aguardando leitura automática do DPP Final'}</small>
      </div>
      <div className={`scenario-comparison-divergence ${!hasFinal ? 'pending' : matches ? 'ok' : 'warning'}`} role="cell">
        <strong>{!hasFinal ? 'Aguardando comparação' : divergence}</strong>
      </div>
    </div>
  )
}

function gapDescription(gap) {
  if (sameNumber(gap, 0)) return 'REAL alinhado ao PGD'
  return gap > 0 ? 'PGD acima do REAL' : 'REAL acima do PGD'
}

function EvolutionPanel({ initial, finalState }) {
  const criticalDelta = finalState ? number(finalState.critical) - number(initial.critical) : 0
  const opcDelta = finalState ? number(finalState.opc) - number(initial.opc) : 0
  const realDelta = finalState ? number(finalState.real) - number(initial.real) : 0
  const activeDelta = finalState ? number(finalState.activeModels) - number(initial.activeModels) : 0

  return (
    <section className="panel dpp-evolution-panel">
      <div className="panel-header">
        <div>
          <h3>Evolução do DPP</h3>
          <p>Compara resultados de alto nível entre o cenário calculado pelo ORION e o DPP Final consolidado, mantendo a origem de cada valor explícita.</p>
        </div>
        <span className="status">{finalState ? 'ORION × DPP FINAL' : 'Aguardando DPP Final'}</span>
      </div>

      {finalState ? (
        <div className="dpp-evolution-list" role="table" aria-label="Evolução do DPP entre Cenário ORION e DPP Final">
          <div className="dpp-evolution-head" role="row">
            <span role="columnheader">Indicador</span>
            <span role="columnheader">Cenário ORION</span>
            <span role="columnheader">DPP Final</span>
            <span role="columnheader">Diferença · Final − ORION</span>
          </div>
          <EvolutionRow label="Materiais críticos" orion={initial.critical} final={finalState.critical} delta={criticalDelta} />
          <EvolutionRow label="OPCs" orion={initial.opc} final={finalState.opc} delta={opcDelta} />
          <EvolutionRow label="REAL" orion={initial.real} final={finalState.real} delta={realDelta} />
          <EvolutionRow label="Modelos ativos" orion={initial.activeModels} final={finalState.activeModels} delta={activeDelta} />
        </div>
      ) : (
        <p className="dashboard-method-note">O DPP Final do pacote compartilhado será analisado automaticamente. Até essa leitura terminar, este bloco mostra apenas que a comparação ainda está pendente.</p>
      )}
    </section>
  )
}

function EvolutionRow({ label, orion, final, delta }) {
  const neutral = sameNumber(delta, 0)
  return (
    <div className="dpp-evolution-row" role="row">
      <strong role="rowheader">{label}</strong>
      <span className="evolution-value orion" role="cell">{formatNumber(orion)}</span>
      <span className="evolution-value final" role="cell">{formatNumber(final)}</span>
      <small className={neutral ? 'neutral' : 'attention'} role="cell">
        {neutral ? 'Igual' : formatSignedNumber(delta)}
      </small>
    </div>
  )
}

function AiBridge({ initial, finalState }) {
  const resolved = finalState ? Math.max(number(initial.critical) - number(finalState.critical), 0) : null
  return (
    <section className="panel dpp-ai-bridge">
      <div className="panel-header">
        <div>
          <h3>Onde entra o Agente ORION</h3>
          <p>O intervalo entre o cenário inicial e o DPP final representa o trabalho de investigação e decisão que a próxima camada de IA deve apoiar.</p>
        </div>
        <span className="status">Próxima camada</span>
      </div>

      <div className="ai-flow-grid">
        <div className="ai-flow-stage current">
          <span>HOJE</span>
          <strong>Python gera o cenário inicial</strong>
          <p>{formatNumber(initial.critical)} materiais críticos entram para investigação.</p>
        </div>
        <div className="ai-flow-arrow">→</div>
        <div className="ai-flow-stage human">
          <span>HOJE</span>
          <strong>Humano investiga e decide</strong>
          <p>Ajusta REAL, localiza OPC, consulta evidências e consolida o DPP.</p>
        </div>
        <div className="ai-flow-arrow">→</div>
        <div className="ai-flow-stage future">
          <span>FUTURO</span>
          <strong>Agente ORION apoia a investigação</strong>
          <p>Sugere prioridade, causa, OPC, OPEN e possíveis ajustes; o humano continua validando.</p>
        </div>
      </div>

      {finalState && (
        <div className="ai-gap-summary">
          <strong>{formatNumber(initial.critical)} → {formatNumber(finalState.critical)} materiais críticos</strong>
          <span>{resolved > 0 ? `${formatNumber(resolved)} situações deixaram de permanecer críticas entre o cenário inicial e o DPP final.` : 'O DPP final permite medir o efeito real das decisões tomadas durante a análise.'}</span>
        </div>
      )}
    </section>
  )
}

function EmptyDashboard({ onNavigate }) {
  return (
    <>
      <section className="panel dashboard-empty">
        <div>
          <span className="eyebrow">SEM DPP CARREGADO</span>
          <h3>Gere o DPP do mês para alimentar a visão operacional.</h3>
          <p>No Gerar novo DPP você pode selecionar todo o pacote mensal de uma vez; quando estiver completo, o processamento começa automaticamente.</p>
          <button className="primary-button" type="button" onClick={() => onNavigate?.('consolidation')}>Adicionar pacote e gerar DPP</button>
        </div>
        <div className="dashboard-readiness">
          <Readiness label="Construção mensal do DPP" status="Disponível" />
          <Readiness label="Cálculos NEC / STK TTL / SALDO" status="Disponível" />
          <Readiness label="Validação histórica" status="Aprovada" />
          <Readiness label="Solver automático de REAL" status="Próxima etapa" pending />
        </div>
      </section>

      <section className="dashboard-empty-kpis">
        <EmptyKpi label="PGD" text="O que precisamos produzir" />
        <EmptyKpi label="REAL" text="O que planejamos produzir" />
        <EmptyKpi label="Cobertura" text="Se o REAL está suportado pelos materiais" />
        <EmptyKpi label="Gargalos" text="O que impede o plano de avançar" />
      </section>
    </>
  )
}

function PlanningPanel({ data }) {
  const max = Math.max(data.pgdTotal, data.realTotal, 1)
  const pgdWidth = Math.max((data.pgdTotal / max) * 100, data.pgdTotal > 0 ? 3 : 0)
  const realWidth = Math.max((data.realTotal / max) * 100, data.realTotal > 0 ? 3 : 0)

  return (
    <section className="panel dashboard-planning-panel">
      <div className="panel-header">
        <div><h3>PGD × REAL</h3><p>Compare a referência do PGD com o volume definido no REAL do cenário inicial.</p></div>
        <span className="status">{formatPercent(data.realVsPgd)}</span>
      </div>
      <div className="planning-bars">
        <PlanningBar label="PGD" value={data.pgdTotal} width={pgdWidth} />
        <PlanningBar label="REAL" value={data.realTotal} width={realWidth} real />
      </div>
      <div className="dashboard-explanation-row">
        <div><small>PGD</small><strong>Referência do plano</strong></div>
        <div><small>REAL</small><strong>Decisão inicial</strong></div>
        <div><small>GAP</small><strong>{data.gap > 0 ? `${formatNumber(data.gap)} un.` : data.gap < 0 ? `${formatNumber(Math.abs(data.gap))} un. acima` : 'Alinhado ao PGD'}</strong></div>
      </div>
    </section>
  )
}

function PlanningBar({ label, value, width, real = false }) {
  return (
    <div className="planning-bar-row">
      <div><strong>{label}</strong><span>{formatNumber(value)} un.</span></div>
      <div className="planning-bar-track"><div className={real ? 'planning-bar-fill real' : 'planning-bar-fill'} style={{ width: `${Math.min(width, 100)}%` }} /></div>
    </div>
  )
}

function QualityPanel({ data }) {
  const sourceOk = data.requiredSources.length > 0 && data.loadedRequiredSources === data.requiredSources.length
  return (
    <section className="panel dashboard-quality-panel">
      <div className="panel-header"><div><h3>Qualidade dos dados</h3><p>Condições básicas para confiar no cenário inicial exibido.</p></div></div>
      <div className="quality-list">
        <QualityRow label="Fontes obrigatórias" value={`${data.loadedRequiredSources}/${data.requiredSources.length}`} ok={sourceOk} />
        <QualityRow label="Mapeamentos PGD pendentes" value={formatNumber(data.pgdPending)} ok={data.pgdPending === 0} />
        <QualityRow label="Motor determinístico" value="Ativo" ok />
        <QualityRow label="Cálculo NEC / SALDO" value="Python" ok />
      </div>
    </section>
  )
}

function QualityRow({ label, value, ok }) {
  return <div className="quality-row"><div><span className={ok ? 'quality-dot ok' : 'quality-dot attention'} /><strong>{label}</strong></div><span>{value}</span></div>
}

function DecisionGuide() {
  return (
    <section className="panel dashboard-guide-panel">
      <div className="panel-header"><div><h3>Como ler o cenário inicial</h3><p>Três perguntas orientam a análise operacional.</p></div></div>
      <div className="decision-guide">
        <div><span>01</span><strong>Quanto precisamos produzir?</strong><p>PGD define a referência do mês.</p></div>
        <div><span>02</span><strong>Quanto o cenário inicial planeja?</strong><p>REAL começa pela referência disponível no PGD.</p></div>
        <div><span>03</span><strong>O que limita o plano?</strong><p>Materiais críticos mostram onde o analista precisa investigar.</p></div>
      </div>
      <div className="dashboard-method-note strong-note">A capacidade agregada máxima ainda não é apresentada como um número único porque materiais compartilhados exigem uma regra de alocação/solver. Esta versão exibe apenas indicadores sustentados pelo motor atual.</div>
    </section>
  )
}

function Readiness({ label, status, pending = false }) {
  return <div className="readiness-row"><span className={pending ? 'readiness-marker pending' : 'readiness-marker'} /><strong>{label}</strong><small>{status}</small></div>
}

function EmptyKpi({ label, text }) {
  return <article><span>{label}</span><strong>—</strong><p>{text}</p></article>
}

export default Dashboard
