import { useMemo } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import { pendingRecords, qualityFound, stockFound } from './investigation-view-model'
import ModuleInfoHint from './ModuleInfoHint'
import './investigation-cards.css'

function display(value) {
  return value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function OverviewMetric({ label, value, context }) {
  return <div className="orion-investigation-overview-metric">
    <dt>{label}</dt>
    <dd>{display(value)}</dd>
    {context && <small>{context}</small>}
  </div>
}

export default function InvestigationOverview({ scenario, stockFile }) {
  const { dppState, workspaceReady, stockInvestigation, qualityInvestigation } = useDppWorkspace()
  const packageKey = workspaceReady && stockFile && dppState.bundle.signature
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile) : ''
  const stockKey = buildStockInvestigationReportKey(packageKey, scenario)
  const stock = stockKey && stockInvestigation?.reportKey === stockKey
    ? stockInvestigation.result : null
  const revisions = useMemo(() => stock
    ? (stock.materials || []).flatMap(item =>
      item.candidates.map(candidate => candidate.candidate_id + ':' + (candidate.validation?.id || 0)),
    ).join(';') : '', [stock])
  const qualityKey = stock ? stockKey + '|quality-4.2-v2|' + revisions : ''
  const quality = qualityKey && qualityInvestigation?.reportKey === qualityKey
    ? qualityInvestigation.result : null

  const stockPending = useMemo(() => pendingRecords(stockFound(stock)), [stock])
  const qualityPending = useMemo(() => pendingRecords(qualityFound(quality)), [quality])
  const criticalCount = stock?.summary?.critical_materials
    ?? (scenario?.materials || []).filter(material => material.status === 'INVESTIGAR').length

  const metrics = [
    { label: 'PNs negativos', value: criticalCount, context: 'SALDO negativo no cenário' },
    { label: 'Encontrados em Estoque', value: stock?.summary?.materials_with_candidates, context: 'M221 / P277' },
    { label: 'Aguardando Almoxarifado', value: stock ? new Set(stockPending.map(p => p.material.material)).size : null, context: 'PNs com registros pendentes' },
    { label: 'Encaminhados à Qualidade', value: stock?.summary?.items_to_quality, context: 'Falta ainda sem explicação' },
    { label: 'Encontrados em CQ', value: quality ? qualityFound(quality).length : null, context: 'Q239 / Q273 ativos' },
    { label: 'Aguardando Qualidade', value: quality ? new Set(qualityPending.map(p => p.material.material)).size : null, context: 'PNs aguardando CQ' },
  ]

  return (
    <section className="orion-stock-investigation orion-investigation-overview orion-investigation-ui"
      id="orion-investigation-overview" aria-label="Resumo operacional das investigações">
      <header className="orion-investigation-block-heading">
        <div>
          <div className="module-heading-with-info">
            <h3>Resumo operacional</h3>
            <ModuleInfoHint moduleKey="dashboard.investigations_summary" />
          </div>
        </div>
      </header>
      <dl className="orion-investigation-overview-metrics">
        {metrics.map(metric => <OverviewMetric key={metric.label} {...metric} />)}
      </dl>
    </section>
  )
}
