import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import { downloadInvestigationExcel } from './investigation-excel'
import StockDepotReviewForm from './StockDepotReviewForm'
import { InvestigationKpiGrid, InvestigationModal, InvestigationRecord } from './InvestigationKpiPanel'
import { stockCohorts } from './investigation-view-model'
import './investigation-cards.css'
import { useDppWorkspace } from './DppWorkspaceContext'
import { fileIdentity, buildStockInvestigationReportKey } from './dpp-workspace-state'
import './stock-divergence-investigation.css'

function formatQuantity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'
}

function StockDivergenceInvestigation({ scenario, stockFile, apiUrl = '' }) {
  const { stockInvestigation, setStockInvestigation, workspaceReady, dppState } = useDppWorkspace()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [category, setCategory] = useState('')
  const controllerRef = useRef(null)
  const scrollRef = useRef(null)
  const refreshRef = useRef('')

  // A identidade depende do pacote e dos valores REAL, não da referência do
  // objeto React. Navegação e restauração de File do IndexedDB preservam a consulta.
  const packageKey = useMemo(
    () => workspaceReady && stockFile && dppState.bundle.signature
      ? `${dppState.bundle.signature}|${fileIdentity(stockFile)}`
      : '',
    [workspaceReady, stockFile, dppState.bundle.signature],
  )
  const reportKey = useMemo(
    () => buildStockInvestigationReportKey(packageKey, scenario),
    [packageKey, scenario],
  )
  const cachedForPackage = Boolean(packageKey && stockInvestigation?.packageKey === packageKey)
  const result = cachedForPackage && stockInvestigation?.reportKey === reportKey
    ? stockInvestigation.result : null

  const fetchReport = useCallback(async ({ automatic = false } = {}) => {
    if (!scenario?.scenario_id || !stockFile || !reportKey || !packageKey || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    if (!automatic) {
      setConfirmation('')
      setSelectedId('')
    }

    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)

    try {
      const response = await fetch(apiUrl + '/api/dpp/investigations/stock-divergence', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Falha ao consultar depósitos.')
      if (!controller.signal.aborted) {
        setStockInvestigation({ packageKey, reportKey, result: payload })
      }
    } catch (failure) {
      if (failure.name !== 'AbortError' && !controller.signal.aborted) {
        setError(failure.message || 'Não foi possível investigar o estoque.')
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setLoading(false)
      }
    }
  }, [scenario, stockFile, reportKey, packageKey, apiUrl, setStockInvestigation])

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setError('')
    setConfirmation('')
    setSelectedId('')
    setCategory('')
    setLoading(false)
    setExporting(false)
    refreshRef.current = ''
  }, [packageKey])

  useEffect(() => {
    if (!cachedForPackage || !reportKey || result || loading || refreshRef.current === reportKey) return
    refreshRef.current = reportKey
    fetchReport({ automatic: true })
  }, [cachedForPackage, reportKey, result, loading, fetchReport])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (!selectedId || !scrollRef.current) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [selectedId])

  function investigate() {
    if (!loading) fetchReport()
  }

  async function exportExcel() {
    if (!result || exporting) return
    setExporting(true)
    setError('')
    try {
      await downloadInvestigationExcel({
        apiUrl, endpoint: '/api/dpp/investigations/stock-divergence/export',
        scenario, stockFile,
      })
    } catch (failure) {
      setError(failure.message || 'Não foi possível exportar a investigação de estoque.')
    } finally {
      setExporting(false)
    }
  }

  const metrics = useMemo(() => stockCohorts(result), [result])
  const selectedMetric = metrics.find(metric => metric.key === category)
  const selected = (result?.materials || []).flatMap(material => (material.candidates || [])
    .map(candidate => ({ material, candidate })))
    .find(({ candidate }) => candidate.candidate_id === selectedId)
  const qty = (value, unit) => formatQuantity(value) + (unit ? ' ' + unit : '')
  const status = candidate => {
    if (!candidate.validation) return 'Pendente de validação humana'
    if (candidate.validation.decision === 'UNAVAILABLE') return 'Validado: indisponível'
    if (candidate.validation.accounting === 'NOT_INCLUDED') return 'Validado: disponível fora do DPP'
    if (candidate.validation.accounting === 'INCLUDED') return 'Validado: disponível e contabilizado'
    return 'Validado: contabilização não confirmada'
  }
  function openCategory(key) {
    setSelectedId('')
    setCategory(key)
  }

  return (
    <section className="orion-stock-investigation orion-investigation-ui"
      id="orion-stock-investigation" aria-label="Divergência de Estoque">
      <div className="orion-stock-investigation-header">
        <div>
          <div className="module-heading-with-info">
            <h3>Divergência de Estoque</h3>
            <ModuleInfoHint moduleKey="dashboard.stock_divergence" />
          </div>
        </div>
        <div className="orion-investigation-actions">
          <button type="button" className="secondary-button" onClick={investigate}
            disabled={!scenario?.scenario_id || !stockFile || loading || exporting} aria-busy={loading}>
            {loading ? 'Consultando...' : result ? 'Consultar novamente' : 'Investigar depósitos'}
          </button>
          {result && <button type="button" className="secondary-button" onClick={exportExcel}
            disabled={loading || exporting || !stockFile} aria-busy={exporting}>
            {exporting ? 'Gerando Excel...' : 'Baixar Excel'}
          </button>}
        </div>
      </div>
      {!stockFile && <p role="status">Adicione o STK SAP para investigar os depósitos.</p>}
      {error && <p role="alert">{error}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
      {result && <InvestigationKpiGrid label="Indicadores de Estoque" metrics={metrics}
        onSelect={openCategory} />}
      {selectedMetric && <InvestigationModal key={reportKey + ':' + category}
        modalKey={reportKey + ':' + category} title={selectedMetric.label}
        items={selectedMetric.items} onClose={() => { setCategory(''); setSelectedId('') }}>
        {visible => <>
          {visible.map(material => (
            <InvestigationRecord key={material.material} material={material}
              facts={[
                { label: 'Falta inicial', value: qty(material.negative_balance, material.unit) },
                { label: 'M221 / P277 encontrados', value: qty(material.candidate_quantity || 0, material.unit) },
                { label: 'SALDO do cenário', value: qty(material.balance ?? -material.negative_balance, material.unit) },
                { label: 'Cobertura potencial não validada', value: qty(material.theoretical_coverage_limit || 0, material.unit) },
                { label: 'Disponível aplicado', value: qty(material.recovered_quantity_applied || 0, material.unit) },
                { label: 'Indisponível justificada', value: qty(material.justified_unavailable_applied || 0, material.unit) },
                { label: 'Gap físico restante', value: qty(material.projected_gap_remaining ?? material.negative_balance, material.unit) },
                { label: 'Falta sem justificativa', value: qty(material.unexplained_quantity ?? material.negative_balance, material.unit) },
              ]}
              note={material.next_step || 'Não encontrado em M221/P277; encaminhado à Qualidade.'}
              status={material.routing_provisional ? 'Encaminhamento provisório; há decisões pendentes' : undefined}
              candidates={material.candidates || []}
              renderCandidate={candidate => <>
                <div>
                  <strong>{candidate.depot} · {qty(candidate.quantity, candidate.unit)} encontrados</strong>
                  <span>Centro {candidate.center || '—'} · STK ORIGINAL, linhas {(candidate.source_rows || []).join(', ')}</span>
                  <small>{status(candidate)}</small>
                  {candidate.validation?.evidence && <span>Justificativa: {candidate.validation.evidence}</span>}
                </div>
                <button type="button" className="secondary-button"
                  onClick={() => setSelectedId(candidate.candidate_id)}>
                  {candidate.validation ? 'Revisar validação' : 'Validar manualmente'}
                </button>
              </>}>
              {selected?.material.material === material.material && (
                <div ref={scrollRef} className="orion-stock-review-anchor">
                  <StockDepotReviewForm key={selected.candidate.candidate_id}
                    scenario={scenario} stockFile={stockFile} material={selected.material}
                    candidate={selected.candidate} apiUrl={apiUrl} onCancel={() => setSelectedId('')}
                    onSaved={payload => {
                      setStockInvestigation({ packageKey, reportKey, result: payload })
                      setSelectedId('')
                      setConfirmation('Validação registrada. SALDO oficial inalterado.')
                    }} />
                </div>
              )}
            </InvestigationRecord>
          ))}
        </>}
      </InvestigationModal>}
    </section>
  )
}

export default StockDivergenceInvestigation
