import { useMemo } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import { investigationUnits, pendingRecords, qualityFound, stockFound } from './investigation-view-model'
import ModuleInfoHint from './ModuleInfoHint'
import OrionVisualIcon from './OrionVisualIcon'
import { evidenceCoveragePercent } from './investigation-visual-metrics'
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
          <div className="module-heading-with-info orion-visual-heading">
            <span className="orion-visual-icon orion-visual-icon-feature"><OrionVisualIcon name="overview" /></span>
            <h3>Resumo operacional</h3>
            <ModuleInfoHint moduleKey="dashboard.investigations_summary" />
          </div>
          <p>Os números principais, as etapas da investigação e o que ainda precisa de confirmação.</p>
        </div>
        <nav className="orion-investigation-shortcuts" aria-label="Ir para investigação">
          <a href="#orion-stock-investigation">Estoque</a>
          <a href="#orion-quality-investigation">Qualidade</a>
        </nav>
      </header>

      <div className="orion-visual-journey" aria-label="Caminho da investigação">
        <span><OrionVisualIcon name="overview" size={16} /> Cenário inicial</span>
        <OrionVisualIcon name="arrow" size={16} />
        <span><OrionVisualIcon name="stock" size={16} /> Estoque</span>
        <OrionVisualIcon name="arrow" size={16} />
        <span><OrionVisualIcon name="quality" size={16} /> Qualidade / CQ</span>
      </div>
      <dl className="orion-investigation-overview-metrics">
        {metrics.map(metric => <OverviewMetric key={metric.label} {...metric} />)}
      </dl>

      {stock && (
        <div className="orion-visual-coverage-grid" aria-label="Registros encontrados">
          <div className="orion-visual-coverage">
            <div className="orion-visual-coverage-heading">
              <span>PNs encontrados nos depósitos de Estoque</span>
              <strong>{stock.summary.materials_with_candidates} / {criticalCount}</strong>
            </div>
            <div className="orion-visual-track" role="progressbar"
              aria-label="Proporção de PNs críticos encontrados em M221/P277"
              aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(evidenceCoveragePercent(stock.summary.materials_with_candidates, criticalCount))}>
              <span style={{ width: evidenceCoveragePercent(stock.summary.materials_with_candidates, criticalCount) + '%' }} />
            </div>
          </div>
          {quality && (
            <div className="orion-visual-coverage">
              <div className="orion-visual-coverage-heading">
                <span>PNs encontrados nos depósitos de Qualidade</span>
                <strong>{qualityFound(quality).length} / {quality.summary.items_received_from_41}</strong>
              </div>
              <div className="orion-visual-track orion-visual-track-cq" role="progressbar"
                aria-label="Proporção de PNs encaminhados com registro no CQ"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round(evidenceCoveragePercent(qualityFound(quality).length, quality.summary.items_received_from_41))}>
                <span style={{ width: evidenceCoveragePercent(qualityFound(quality).length, quality.summary.items_received_from_41) + '%' }} />
              </div>
            </div>
          )}
          <small>Encontrado não significa material liberado; as barras mostram apenas registros localizados.</small>
        </div>
      )}
      {!stock ? (
        <p className="orion-investigation-empty" role="status">
          Consulte Divergência de Estoque para visualizar os PNs encontrados e o gap recalculado.
        </p>
      ) : (
        <>
          <div className="orion-investigation-subheading">
            <h4 className="orion-visual-small-heading"><OrionVisualIcon name="gap" size={18} /> Gap por unidade de medida</h4>
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
          <h4 className="orion-visual-small-heading"><OrionVisualIcon name="action" size={18} /> Próximas confirmações</h4>
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
