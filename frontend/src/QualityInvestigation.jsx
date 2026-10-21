import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import QualityReviewForm from './QualityReviewForm'
import { InvestigationKpiGrid, InvestigationModal, InvestigationRecord } from './InvestigationKpiPanel'
import { qualityCohorts } from './investigation-view-model'
import './investigation-cards.css'
import { downloadInvestigationExcel } from './investigation-excel'
import { useDppWorkspace } from './DppWorkspaceContext'
import { fileIdentity, buildStockInvestigationReportKey } from './dpp-workspace-state'
import './stock-divergence-investigation.css'

function fmt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'
}

function QualityInvestigation({ scenario, stockFile, apiUrl = '', ensureScenarioAvailable }) {
  const {
    dppState, workspaceReady, stockInvestigation,
    qualityInvestigation, setQualityInvestigation,
  } = useDppWorkspace()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [category, setCategory] = useState('')
  const [retryTick, setRetryTick] = useState(0)
  const [opening, setOpening] = useState(false)
  const controllerRef = useRef(null)
  const attemptedRef = useRef('')
  const formRef = useRef(null)

  const packageKey = workspaceReady && stockFile
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile)
    : ''
  const stockReady = Boolean(
    packageKey && scenario?.scenario_id
    && stockInvestigation?.reportKey === buildStockInvestigationReportKey(packageKey, scenario)
    && stockInvestigation?.packageKey === packageKey
    && stockInvestigation?.result?.scenario_id === scenario.scenario_id
    && stockInvestigation.result.workflow,
  )
  const stockReport = stockReady ? stockInvestigation.result : null
  const reviewRevision = useMemo(() => stockReport
    ? (stockReport.materials || []).flatMap((material) =>
      material.candidates.map((candidate) => candidate.candidate_id + ':' + (candidate.validation?.id || 0)),
    ).join(';')
    : '', [stockReport])
  const reportKey = stockReady
    ? stockInvestigation.reportKey + '|quality-4.2-v2|' + reviewRevision
    : ''
  const report = reportKey && qualityInvestigation?.reportKey === reportKey
    ? qualityInvestigation.result
    : null
  const canRun = Boolean(
    stockReady && scenario?.scenario_id && stockFile
    && stockReport?.workflow?.forward_to_quality?.length > 0,
  )

  const fetchReport = useCallback(async () => {
    if (!canRun || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)
    try {
      const response = await fetch(apiUrl + '/api/dpp/investigations/quality', {
        method: 'POST', body: form, signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Falha na análise de Qualidade.')
      if (!controller.signal.aborted) setQualityInvestigation({ reportKey, result: payload })
    } catch (failure) {
      if (failure.name !== 'AbortError' && !controller.signal.aborted) {
        setError(failure.message || 'Falha ao investigar a Qualidade.')
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setLoading(false)
      }
    }
  }, [canRun, scenario, stockFile, apiUrl, reportKey, setQualityInvestigation])

  useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    attemptedRef.current = ''
    setSelectedId('')
    setCategory('')
    setError('')
    setMessage('')
    setLoading(false)
    setExporting(false)
  }, [reportKey])

  // Consulta automaticamente quando a etapa 4.1 encaminha PNs ao CQ.
  useEffect(() => {
    if (!canRun || report || loading || attemptedRef.current === reportKey) return
    attemptedRef.current = reportKey
    fetchReport()
  }, [canRun, report, loading, reportKey, retryTick, fetchReport])

  useEffect(() => {
    const retry = () => {
      if (!document.hidden && canRun && !report && !loading) {
        attemptedRef.current = ''
        setRetryTick(tick => tick + 1)
      }
    }
    document.addEventListener('visibilitychange', retry)
    window.addEventListener('focus', retry)
    return () => {
      document.removeEventListener('visibilitychange', retry)
      window.removeEventListener('focus', retry)
    }
  }, [canRun, report, loading])

  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (!selectedId || !formRef.current) return
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    formRef.current.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }, [selectedId])

  async function exportExcel() {
    if (!report || exporting) return
    setExporting(true)
    setError('')
    try {
      await downloadInvestigationExcel({
        apiUrl, endpoint: '/api/dpp/investigations/quality/export',
        scenario, stockFile,
      })
    } catch (failure) {
      setError(failure.message || 'Não foi possível exportar a análise de Qualidade.')
    } finally {
      setExporting(false)
    }
  }

  const metrics = useMemo(() => qualityCohorts(report), [report])
  const selectedMetric = metrics.find(metric => metric.key === category)
  const selected = (report?.materials || []).flatMap(material => (material.candidates || [])
    .map(candidate => ({ material, candidate })))
    .find(({ candidate }) => candidate.candidate_id === selectedId)
  const qty = (value, unit) => fmt(value) + (unit ? ' ' + unit : '')
  const validationStatus = candidate => {
    if (!candidate.validation) return 'Pendente de validação humana'
    const decision = candidate.validation.decision
    if (decision === 'RELEASED') return candidate.validation.accounting === 'NOT_INCLUDED'
      ? 'Validado: liberação adicional ao DPP' : 'Validado: liberação sem adicional comprovado'
    if (decision === 'REJECTED') return 'Validado: reprovado pelo CQ'
    if (decision === 'SCRAP_CONFIRMED') return 'Validado: refugo comprovado'
    return 'Validado: sem comprovação'
  }
  async function openCategory(key) {
    if (opening) return
    setOpening(true)
    try {
      if (ensureScenarioAvailable && !(await ensureScenarioAvailable())) return
      setSelectedId('')
      setCategory(key)
    } finally {
      setOpening(false)
    }
  }

  return (
    <section className="orion-stock-investigation orion-quality-investigation orion-investigation-ui"
      id="orion-quality-investigation" aria-label="Análise de Qualidade">
      <div className="orion-stock-investigation-header">
        <div>
          <div className="module-heading-with-info">
            <h3>Análise de Qualidade</h3>
            <ModuleInfoHint moduleKey="dashboard.quality_investigation" />
          </div>
        </div>
        {canRun && <div className="orion-investigation-actions">
          {report && <button type="button" className="secondary-button" onClick={exportExcel}
            disabled={loading || exporting} aria-busy={exporting}>
            {exporting ? 'Gerando Excel...' : 'Baixar Excel'}
          </button>}
        </div>}
      </div>
      {!stockReady && <p role="status">Execute primeiro Divergência de Estoque para identificar os PNs encaminhados.</p>}
      {stockReady && !canRun && <p role="status">Nenhum PN foi encaminhado à Qualidade.</p>}
      {loading && <p role="status">Analisando automaticamente Q239 e Q273...</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {report && <InvestigationKpiGrid label="Indicadores da Qualidade" metrics={metrics}
        onSelect={openCategory} />}
      {selectedMetric && <InvestigationModal key={reportKey + ':' + category}
        modalKey={reportKey + ':' + category} title={selectedMetric.label}
        items={selectedMetric.items} onClose={() => { setCategory(''); setSelectedId('') }}>
        {visible => <>
          {visible.map(material => (
            <InvestigationRecord key={material.material} material={material}
              facts={[
                { label: 'Falta recebida de Estoque', value: qty(material.gap_from_41, material.unit) },
                { label: 'Depósito CQ ativo', value: material.active_depot || 'Sem Q239/Q273' },
                { label: 'Encontrado no CQ', value: qty((material.candidates || []).reduce((sum, c) => sum + Number(c.quantity || 0), 0), material.unit) },
                { label: 'Cobertura potencial não validada', value: qty(material.theoretical_coverage_limit || 0, material.unit) },
                { label: 'Liberado aplicado', value: qty(material.quality_released_applied || 0, material.unit) },
                { label: 'Reprovado justificado', value: qty(material.quality_rejected_applied || 0, material.unit) },
                { label: 'Refugo justificado', value: qty(material.quality_scrap_applied || 0, material.unit) },
                { label: 'Gap físico após CQ', value: qty(material.physical_gap_after_quality, material.unit) },
                { label: 'Falta sem explicação', value: qty(material.unexplained_after_quality, material.unit) },
              ]}
              note={[material.next_step,
                ...(material.additional_q273_evidence || []).map(candidate =>
                  'Q273 informativo: ' + qty(candidate.quantity, candidate.unit) +
                  ' · Centro ' + (candidate.center || '—') +
                  ' · STK ORIGINAL, linhas ' + (candidate.source_rows || []).join(', ') +
                  ' (Q239 prioritário, não somar nem validar nesta etapa).'),
              ].filter(Boolean).join(' | ')}
              status={material.routing_provisional ? 'Conclusão provisória; há revisões pendentes' : undefined}
              candidates={material.candidates || []}
              renderCandidate={candidate => <>
                <div>
                  <strong>{candidate.depot} · {qty(candidate.quantity, candidate.unit)} encontrados</strong>
                  <span>Centro {candidate.center || '—'} · STK ORIGINAL, linhas {(candidate.source_rows || []).join(', ')}</span>
                  <small>{validationStatus(candidate)}</small>
                  {candidate.validation?.justification && <span>Justificativa: {candidate.validation.justification}</span>}
                </div>
                <button type="button" className="secondary-button"
                  onClick={() => setSelectedId(candidate.candidate_id)}>
                  {candidate.validation ? 'Revisar validação' : 'Validar manualmente'}
                </button>
              </>}>
              {selected?.material.material === material.material && (
                <div ref={formRef} className="orion-stock-review-anchor">
                  <QualityReviewForm key={selected.candidate.candidate_id}
                    scenario={scenario} stockFile={stockFile} candidate={selected.candidate}
                    material={selected.material} apiUrl={apiUrl} onCancel={() => setSelectedId('')}
                    onSaved={updated => {
                      setQualityInvestigation({ reportKey, result: updated })
                      setSelectedId('')
                      setMessage('Validação da Qualidade registrada. SALDO oficial inalterado.')
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

export default QualityInvestigation
