import { useMemo } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import ModuleInfoHint from './ModuleInfoHint'
import './investigation-overview.css'

function format(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function countCandidates(material) {
  return (material.candidates || []).reduce((total, c) => total + Number(c.quantity || 0), 0)
}

function unitTotals(stock, quality) {
  if (!stock) return []
  const byUnit = new Map()
  function forUnit(unit) {
    const key = unit || 'SEM UM'
    if (!byUnit.has(key)) byUnit.set(key, {
      unit: key, deficit: 0, foundStock: 0, gapStock: 0,
      unexplainedStock: 0, foundQuality: 0, unexplainedQuality: 0,
    })
    return byUnit.get(key)
  }
  for (const m of [...stock.materials, ...(stock.unmatched_materials || [])]) {
    const bucket = forUnit(m.unit)
    bucket.deficit += Number(m.negative_balance || 0)
    bucket.foundStock += countCandidates(m)
    bucket.gapStock += Number(m.projected_gap_remaining ?? m.negative_balance ?? 0)
    bucket.unexplainedStock += Number(m.unexplained_quantity ?? m.negative_balance ?? 0)
  }
  if (quality) {
    for (const m of quality.materials || []) {
      const bucket = forUnit(m.unit)
      bucket.foundQuality += countCandidates(m)
      bucket.unexplainedQuality += Number(m.unexplained_after_quality || 0)
    }
  }
  return [...byUnit.values()].sort((a, b) => a.unit.localeCompare(b.unit))
}

function InvestigationOverview({ scenario, stockFile }) {
  const {
    dppState, workspaceReady, stockInvestigation, qualityInvestigation,
  } = useDppWorkspace()
  const packageKey = workspaceReady && stockFile && dppState.bundle.signature
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile) : ''
  const stockKey = buildStockInvestigationReportKey(packageKey, scenario)
  const stock = stockKey && stockInvestigation?.reportKey === stockKey
    ? stockInvestigation.result : null
  const revisions = useMemo(() => stock
    ? (stock.materials || []).flatMap((item) =>
      item.candidates.map((candidate) =>
        candidate.candidate_id + ':' + (candidate.validation?.id || 0)),
    ).join(';') : '', [stock])
  const qualityKey = stock ? stockKey + '|quality-4.2-v2|' + revisions : ''
  const quality = qualityKey && qualityInvestigation?.reportKey === qualityKey
    ? qualityInvestigation.result : null

  const totals = useMemo(() => unitTotals(stock, quality), [stock, quality])
  const initialCritical = (scenario?.materials || []).filter((m) => m.status === 'INVESTIGAR').length
  const metrics = [
    ['PNs críticos', stock?.summary.critical_materials ?? initialCritical],
    ['PNs com registros em Estoque', stock?.summary.materials_with_candidates],
    ['PNs encaminhados à Qualidade', stock?.summary.items_to_quality],
    ['PNs com registros em Qualidade', quality
      ? quality.summary.materials_with_q239 + quality.summary.materials_with_q273 : null],
    ['Aguardando validação de Estoque', stock?.summary.items_awaiting_validation],
    ['Aguardando CQ', quality?.summary.items_awaiting_quality],
  ]

  return (
    <section className="orion-stock-investigation orion-investigation-overview" aria-label="Resumo das investigações">
      <div className="module-heading-with-info">
        <h3>Resumo das investigações</h3>
        <ModuleInfoHint moduleKey="dashboard.investigations_summary" />
      </div>
      <p>Visão conjunta dos PNs negativos, registros encontrados e falta ainda sem explicação.</p>
      <div className="orion-investigation-overview-metrics">
        {metrics.map(([title, value]) => (
          <div key={title} className="orion-investigation-overview-metric">
            <span>{title}</span>
            <strong>{format(value)}</strong>
          </div>
        ))}
      </div>
      {stock ? (
        <div className="orion-stock-investigation-scroll">
          <table>
            <thead>
              <tr>
                <th>UM</th>
                <th>Falta inicial</th>
                <th>Encontrado em Estoque</th>
                <th>Gap após Estoque</th>
                <th>Sem justificativa em Estoque</th>
                <th>Encontrado em Qualidade</th>
                <th>Sem explicação após Qualidade</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((unit) => (
                <tr key={unit.unit}>
                  <td>{unit.unit}</td>
                  <td className="orion-stock-number">{format(unit.deficit)}</td>
                  <td className="orion-stock-number">{format(unit.foundStock)}</td>
                  <td className="orion-stock-number">{format(unit.gapStock)}</td>
                  <td className="orion-stock-number">{format(unit.unexplainedStock)}</td>
                  <td className="orion-stock-number">{format(quality ? unit.foundQuality : null)}</td>
                  <td className="orion-stock-number">{format(quality ? unit.unexplainedQuality : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Consulte Divergência de Estoque para apresentar os totais detalhados.</p>
      )}
      <small>Quantidades encontradas não são automaticamente disponíveis. Os totais são separados por unidade de medida e não alteram o SALDO do cenário.</small>
    </section>
  )
}

export default InvestigationOverview
