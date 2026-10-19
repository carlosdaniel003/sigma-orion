import { useMemo } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import { investigationUnits, pendingRecords, qualityFound, stockFound } from './investigation-view-model'
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

function GapStage({ label, amount, unit, description }) {
  return (
    <div className="orion-investigation-gap-stage">
      <span>{label}</span>
      <strong>{display(amount)} <small>{unit}</small></strong>
      <small>{description}</small>
    </div>
  )
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

  const totals = useMemo(() => investigationUnits(stock, quality), [stock, quality])
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
          <p>Do saldo negativo à validação: o que foi encontrado, o que precisa de confirmação e quanto ainda falta explicar.</p>
        </div>
        <nav className="orion-investigation-shortcuts" aria-label="Ir para investigação">
          <a href="#orion-stock-investigation">Estoque</a>
          <a href="#orion-quality-investigation">Qualidade</a>
        </nav>
      </header>

      <dl className="orion-investigation-overview-metrics">
        {metrics.map(metric => <OverviewMetric key={metric.label} {...metric} />)}
      </dl>

      {!stock ? (
        <p className="orion-investigation-empty" role="status">
          Consulte Divergência de Estoque para visualizar os PNs encontrados e o gap recalculado.
        </p>
      ) : (
        <>
          <div className="orion-investigation-subheading">
            <h4>Gap por unidade de medida</h4>
            <p>Valores do cenário e das confirmações já registradas. Quantidade encontrada não significa material liberado.</p>
          </div>
          <div className="orion-investigation-unit-grid">
            {totals.map(item => (
              <section key={item.unit} className="orion-investigation-unit-group"
                aria-label={'Gap da unidade ' + item.unit}>
                <div className="orion-investigation-unit-heading">
                  <strong>{item.unit}</strong>
                  <span>Estoque encontrado: {display(item.foundStock)} {item.unit}</span>
                  <span>{quality ? 'CQ encontrado: ' + display(item.foundQuality) + ' ' + item.unit : 'CQ ainda não consultado'}</span>
                </div>
                <div className="orion-investigation-gap-sequence">
                  <GapStage label="Falta inicial" amount={item.deficit} unit={item.unit}
                    description="Déficit dos PNs críticos" />
                  <GapStage label="Gap após Estoque" amount={item.gapStock} unit={item.unit}
                    description="Após disponibilidade confirmada" />
                  <GapStage label="Falta ainda sem explicação em Estoque" amount={item.unexplainedStock}
                    unit={item.unit} description="Descontadas justificativas válidas" />
                  {quality && <GapStage label="Sem explicação após CQ" amount={item.unexplainedQuality}
                    unit={item.unit} description="Somente PNs analisados em Qualidade" />}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <div className="orion-investigation-priority-summary">
        <div>
          <h4>Próximas confirmações</h4>
          <p>As filas abaixo mostram apenas PNs encontrados em depósitos investigados.</p>
        </div>
        <div className="orion-investigation-priority-links">
          <a href="#orion-stock-actions">
            <strong>{display(stock ? stockPending.length : null)} registros</strong>
            <span>Confirmar com PCM / Almoxarifado</span>
          </a>
          <a href="#orion-quality-actions">
            <strong>{display(quality ? qualityPending.length : null)} registros</strong>
            <span>Confirmar com Qualidade / CQ</span>
          </a>
        </div>
      </div>
      <p className="orion-investigation-muted-note">
        PNs sem registros permanecem nos totais e nos relatórios Excel. As listas da tela destacam apenas achados que podem ser investigados pela área responsável.
      </p>
    </section>
  )
}
