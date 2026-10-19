import { useEffect, useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import './dpp-gap-projection.css'

const display = value => value === null || value === undefined
  ? '—'
  : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function reviewSignature(report) {
  return (report?.materials || [])
    .flatMap(material => (material.candidates || [])
      .map(candidate => candidate.candidate_id + ':' + (candidate.validation?.id || 0)))
    .join('|')
}

function Count({ label, value }) {
  return <div className="orion-dpp-gap-count">
    <span>{label}</span>
    <strong>{display(value)}</strong>
  </div>
}

export default function DppGapProjection({ scenario, stockFile, apiUrl = '' }) {
  const { stockInvestigation, qualityInvestigation, workspaceReady, dppState } = useDppWorkspace()
  const packageKey = workspaceReady && stockFile && dppState.bundle.signature
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile) : ''
  const stockKey = buildStockInvestigationReportKey(packageKey, scenario)
  const stock = stockInvestigation?.reportKey === stockKey
    && stockInvestigation?.packageKey === packageKey
    ? stockInvestigation.result : null
  const stockRevision = useMemo(() => reviewSignature(stock), [stock])
  const expectedQualityKey = stock ? stockKey + '|quality-4.2-v2|' + stockRevision : ''
  const quality = expectedQualityKey && qualityInvestigation?.reportKey === expectedQualityKey
    ? qualityInvestigation.result : null
  const qualityRevision = useMemo(() => reviewSignature(quality), [quality])
  const signature = stock
    ? stockKey + '|full-dpp-gap-v1|' + stockRevision + '|cq:' + qualityRevision
    : ''
  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!signature || !scenario?.scenario_id || !stockFile) return undefined
    const controller = new AbortController()
    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)
    setLoading(true)
    setError('')
    fetch(apiUrl + '/api/dpp/monthly/gap/recalculate', {
      method: 'POST', body: form, signal: controller.signal,
    }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível recalcular o gap.')
      if (!controller.signal.aborted) setSnapshot({ signature, data })
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message || 'Falha no recálculo.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [signature, refresh, scenario?.scenario_id, stockFile, apiUrl])

  const result = snapshot?.signature === signature ? snapshot.data : null
  const applied = useMemo(() => (result?.materials || []).filter(item =>
    item.critical && (
      item.recovered_stock > 0 || item.recovered_cq > 0 ||
      item.justified_stock > 0 || item.justified_cq_rejection > 0 ||
      item.justified_cq_scrap > 0
    ),
  ), [result])
  const units = result?.summary?.units || []

  return (
    <section className="orion-stock-investigation orion-investigation-ui orion-dpp-gap"
      id="orion-dpp-gap-recalculation" aria-label="Gap recalculado do DPP">
      <header className="orion-stock-investigation-header">
        <div>
          <h3>Gap recalculado do DPP</h3>
          <p>Resultado consolidado de Divergência de Estoque e Análise de Qualidade, aplicado a todos os materiais do cenário.</p>
          <small>Valores projetados a partir das confirmações das áreas. O SALDO original e o Excel do DPP continuam inalterados.</small>
        </div>
        <button className="secondary-button" type="button"
          disabled={!signature || loading} onClick={() => setRefresh(value => value + 1)}
          aria-busy={loading}>
          {loading ? 'Recalculando...' : 'Recalcular gap'}
        </button>
      </header>
      {!stock && <p role="status">Consulte primeiro a Divergência de Estoque para habilitar o recálculo completo do DPP.</p>}
      {error && <p role="alert">{error}</p>}
      {stock && loading && !result && <p role="status">Recalculando os materiais do DPP...</p>}
      {result && <>
        <div className="orion-dpp-gap-overview" aria-label="Resumo da projeção mensal">
          <Count label="Materiais do DPP" value={result.summary.materials_total} />
          <Count label="PNs críticos (UN)" value={result.summary.critical_materials} />
          <Count label="PNs com quantidade aplicada ou justificada" value={result.summary.materials_with_applied_explanations} />
          <Count label="PNs com validações pendentes" value={result.summary.critical_materials_with_pending_validations} />
        </div>

        <h4>Falta por unidade de medida</h4>
        <p className="orion-dpp-gap-caption">A falta física só diminui com disponibilidade validada e fora do DPP. Justificativas diminuem a falta sem explicação, não o estoque.</p>
        <div className="orion-dpp-gap-units">
          {units.filter(item => item.negative_materials > 0).map(item => (
            <section className="orion-dpp-gap-unit" key={item.unit}>
              <div className="orion-dpp-gap-unit-header">
                <strong>{item.unit}</strong>
                <span>{display(item.negative_materials)} materiais negativos</span>
              </div>
              <dl>
                <div><dt>Falta inicial</dt><dd>{display(item.initial_gap)}</dd></div>
                <div><dt>Recuperado em Estoque</dt><dd>{display(item.recovered_stock)}</dd></div>
                <div><dt>Gap após Estoque</dt><dd>{display(item.physical_gap_after_stock)}</dd></div>
                <div><dt>Liberado pelo CQ</dt><dd>{display(item.recovered_cq)}</dd></div>
                <div><dt>Gap físico após Qualidade</dt><dd>{display(item.physical_gap_after_quality)}</dd></div>
                <div><dt>Falta sem explicação</dt><dd>{display(item.unexplained_after_quality)}</dd></div>
              </dl>
            </section>
          ))}
        </div>
        {result.summary.negative_outside_scope > 0 && (
          <p className="orion-dpp-gap-caption">
            {display(result.summary.negative_outside_scope)} material(is) negativo(s) de outras unidades
            continuam sem ajuste por não pertencerem ao escopo de investigação atual.
          </p>
        )}

        <div className="orion-dpp-gap-details-header">
          <div>
            <h4>Materiais com análise aplicada</h4>
            <p>{display(applied.length)} PN(s) com disponibilidade ou justificativa validada. Os demais materiais são considerados nos totais, mas não geram uma lista extensa.</p>
          </div>
          {applied.length > 0 &&
            <button type="button" className="secondary-button" onClick={() => setExpanded(value => !value)}>
              {expanded ? 'Ocultar PNs' : 'Ver PNs com ajustes'}
            </button>}
        </div>
        {expanded && applied.length > 0 && (
          <div className="orion-dpp-gap-material-list">
            {applied.map(item => (
              <details key={item.material}>
                <summary>
                  <strong>{item.material}</strong>
                  <span>{display(item.initial_gap)} {item.unit} iniciais</span>
                  <span>{display(item.physical_gap_after_quality)} {item.unit} ainda em falta</span>
                </summary>
                <div>
                  <p>{item.description || 'Sem descrição'}</p>
                  <dl>
                    <div><dt>Estoque recuperado</dt><dd>{display(item.recovered_stock)} {item.unit}</dd></div>
                    <div><dt>CQ liberado</dt><dd>{display(item.recovered_cq)} {item.unit}</dd></div>
                    <div><dt>Indisponível justificado</dt><dd>{display(item.justified_stock)} {item.unit}</dd></div>
                    <div><dt>CQ justificado (reprovação/refugo)</dt><dd>{display(item.justified_cq_rejection + item.justified_cq_scrap)} {item.unit}</dd></div>
                    <div><dt>Falta sem explicação</dt><dd>{display(item.unexplained_after_quality)} {item.unit}</dd></div>
                    <div><dt>SALDO original</dt><dd>{display(item.original_balance)} {item.unit}</dd></div>
                    <div><dt>SALDO projetado (não oficial)</dt><dd>{display(item.projected_balance)} {item.unit}</dd></div>
                  </dl>
                  {item.provisional && <small>Projeção provisória: há confirmações pendentes.</small>}
                </div>
              </details>
            ))}
          </div>
        )}
        <p className="orion-dpp-gap-disclaimer">
          A projeção usa somente as investigações de Estoque e Qualidade. Não realiza Scrap posterior,
          não altera NEC/REAL/STK TTL e não substitui o SALDO oficial. Revisões das validações
          atualizam automaticamente este recálculo.
        </p>
      </>}
    </section>
  )
}
