import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDppWorkspace } from './DppWorkspaceContext'

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

function activeModelsForMaterial(material, realLookup) {
  return Object.entries(material?.consumption_by_model || {})
    .filter(([modelName, usage]) => number(usage) > 0 && number(realLookup[modelName]) > 0)
    .map(([modelName]) => modelName)
}

function buildInitialMetrics(scenario) {
  if (!scenario) return null

  const models = scenario.models || []
  const materials = scenario.materials || []
  const summary = scenario.summary || {}
  const realLookup = Object.fromEntries(models.map((model) => [model.name, number(model.real)]))
  const pgd = number(summary.kit_pgd_total ?? models.reduce((total, model) => total + number(model.kit_pgd), 0))
  const real = number(summary.real_total ?? models.reduce((total, model) => total + number(model.real), 0))
  const activeModels = models.filter((model) => number(model.real) > 0)
  const criticalMaterials = materials.filter((material) => material.status === 'INVESTIGAR')
  const riskNames = new Set()
  let sharedCritical = 0

  for (const material of criticalMaterials) {
    const affected = activeModelsForMaterial(material, realLookup)
    affected.forEach((name) => riskNames.add(name))
    if (affected.length > 1) sharedCritical += 1
  }

  const riskModels = riskNames.size
  const safeModels = Math.max(activeModels.length - riskModels, 0)
  const coverage = activeModels.length ? (safeModels / activeModels.length) * 100 : 0
  const pgdExposed = activeModels
    .filter((model) => riskNames.has(model.name))
    .reduce((total, model) => total + number(model.kit_pgd), 0)

  return {
    pgd,
    real,
    gap: pgd - real,
    coverage,
    safeModels,
    activeModels: activeModels.length,
    modelCount: models.length,
    riskModels,
    criticalMaterials: criticalMaterials.length,
    totalMaterials: materials.length,
    pgdExposed,
    sharedCritical,
  }
}

function buildFinalMetrics(summary) {
  if (!summary) return null
  const pgd = number(summary.pgd_total)
  const real = number(summary.real_total)
  return {
    pgd,
    real,
    gap: pgd - real,
    coverage: number(summary.material_coverage),
    safeModels: number(summary.safe_models),
    activeModels: number(summary.active_models),
    modelCount: number(summary.model_count),
    riskModels: number(summary.risk_models),
    criticalMaterials: number(summary.critical_materials),
    totalMaterials: number(summary.total_materials),
    pgdExposed: number(summary.pgd_exposed),
    sharedCritical: number(summary.shared_critical),
  }
}

function gapDetail(gap) {
  if (Math.abs(number(gap)) < 1e-9) return 'REAL alinhado ao PGD'
  return gap > 0 ? `${formatNumber(gap)} un. abaixo do PGD` : `${formatNumber(Math.abs(gap))} un. acima do PGD`
}

function DashboardKpiComparison({ finalDppAnalysis }) {
  const { generatedScenario } = useDppWorkspace()
  const initial = useMemo(() => buildInitialMetrics(generatedScenario), [generatedScenario])
  const finalMetrics = useMemo(() => buildFinalMetrics(finalDppAnalysis?.summary), [finalDppAnalysis])
  const [portalHost, setPortalHost] = useState(null)

  useEffect(() => {
    let cancelled = false
    let observer = null

    function attach() {
      if (cancelled) return true
      const primaryGrid = document.querySelector('.dashboard-kpi-primary')
      if (!primaryGrid?.parentNode) return false

      let host = primaryGrid.parentNode.querySelector(':scope > .dashboard-comparison-portal-host')
      if (!host) {
        host = document.createElement('div')
        host.className = 'dashboard-comparison-portal-host'
        primaryGrid.parentNode.insertBefore(host, primaryGrid)
      }
      setPortalHost(host)
      return true
    }

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) observer?.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      cancelled = true
      observer?.disconnect()
      setPortalHost(null)
      document.querySelectorAll('.dashboard-comparison-portal-host').forEach((host) => host.remove())
    }
  }, [])

  if (!portalHost || !initial) return null

  const cards = [
    {
      label: 'PGD do mês',
      initialValue: `${formatNumber(initial.pgd)} un.`,
      finalValue: finalMetrics ? `${formatNumber(finalMetrics.pgd)} un.` : '—',
      initialDetail: 'Referência de produção do PGD',
      finalDetail: finalMetrics ? 'Referência registrada no DPP final' : 'Aguardando DPP final',
    },
    {
      label: 'REAL planejado',
      initialValue: `${formatNumber(initial.real)} un.`,
      finalValue: finalMetrics ? `${formatNumber(finalMetrics.real)} un.` : '—',
      initialDetail: initial.pgd ? `${formatPercent((initial.real / initial.pgd) * 100)} do PGD` : 'Sem PGD',
      finalDetail: finalMetrics && finalMetrics.pgd ? `${formatPercent((finalMetrics.real / finalMetrics.pgd) * 100)} do PGD` : finalMetrics ? 'Sem PGD' : 'Aguardando DPP final',
    },
    {
      label: 'Gap PGD × REAL',
      initialValue: `${formatNumber(Math.abs(initial.gap))} un.`,
      finalValue: finalMetrics ? `${formatNumber(Math.abs(finalMetrics.gap))} un.` : '—',
      initialDetail: gapDetail(initial.gap),
      finalDetail: finalMetrics ? gapDetail(finalMetrics.gap) : 'Aguardando DPP final',
    },
    {
      label: 'Cobertura material do REAL',
      initialValue: formatPercent(initial.coverage),
      finalValue: finalMetrics ? formatPercent(finalMetrics.coverage) : '—',
      initialDetail: `${initial.safeModels} de ${initial.activeModels} modelos ativos sem material UN negativo`,
      finalDetail: finalMetrics ? `${finalMetrics.safeModels} de ${finalMetrics.activeModels} modelos ativos sem material UN negativo` : 'Aguardando DPP final',
    },
    {
      label: 'Modelos em risco',
      initialValue: `${initial.riskModels}/${initial.activeModels}`,
      finalValue: finalMetrics ? `${finalMetrics.riskModels}/${finalMetrics.activeModels}` : '—',
      initialDetail: `${initial.modelCount} modelos na base`,
      finalDetail: finalMetrics ? `${finalMetrics.modelCount} modelos na base` : 'Aguardando DPP final',
    },
    {
      label: 'Materiais críticos',
      initialValue: formatNumber(initial.criticalMaterials),
      finalValue: finalMetrics ? formatNumber(finalMetrics.criticalMaterials) : '—',
      initialDetail: `${formatNumber(initial.totalMaterials)} analisados`,
      finalDetail: finalMetrics ? `${formatNumber(finalMetrics.totalMaterials)} analisados` : 'Aguardando DPP final',
    },
    {
      label: 'PGD exposto',
      initialValue: formatNumber(initial.pgdExposed),
      finalValue: finalMetrics ? formatNumber(finalMetrics.pgdExposed) : '—',
      initialDetail: 'PGD ligado a modelos com material crítico',
      finalDetail: finalMetrics ? 'PGD ligado a modelos com material crítico no DPP final' : 'Aguardando DPP final',
    },
    {
      label: 'Críticos compartilhados',
      initialValue: formatNumber(initial.sharedCritical),
      finalValue: finalMetrics ? formatNumber(finalMetrics.sharedCritical) : '—',
      initialDetail: 'Afetam mais de um modelo ativo',
      finalDetail: finalMetrics ? 'Afetam mais de um modelo ativo no DPP final' : 'Aguardando DPP final',
    },
  ]

  return createPortal(
    <section className="dashboard-kpi-comparison" aria-label="Comparativo de indicadores do cenário ORION e DPP final">
      <div className="dashboard-comparison-heading">
        <div>
          <span className="dashboard-comparison-eyebrow">INDICADORES COMPARADOS</span>
          <h3>Cenário ORION × DPP Final</h3>
          <p>Compare o cenário inicial calculado pelo ORION com os mesmos indicadores recalculados sobre o DPP final consolidado.</p>
        </div>
        <div className="dashboard-comparison-legend" aria-hidden="true">
          <span><i className="orion" />ORION</span>
          <span><i className="final" />DPP FINAL</span>
        </div>
      </div>

      <div className="dashboard-comparison-grid">
        {cards.map((card) => (
          <article className="dashboard-comparison-card" key={card.label}>
            <span className="dashboard-comparison-label">{card.label}</span>
            <div className="dashboard-comparison-values">
              <div>
                <small>ORION</small>
                <strong>{card.initialValue}</strong>
                <p>{card.initialDetail}</p>
              </div>
              <div className="final-value">
                <small>DPP FINAL</small>
                <strong>{card.finalValue}</strong>
                <p>{card.finalDetail}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>,
    portalHost,
  )
}

export default DashboardKpiComparison
