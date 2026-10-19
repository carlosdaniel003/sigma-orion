import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import QualityReviewForm from './QualityReviewForm'
import InvestigationPagination, { useInvestigationPagination } from './InvestigationPagination'
import { qualityFound, pendingRecords, filterFound } from './investigation-view-model'
import './investigation-cards.css'
import { downloadInvestigationExcel } from './investigation-excel'
import { useDppWorkspace } from './DppWorkspaceContext'
import { fileIdentity, buildStockInvestigationReportKey } from './dpp-workspace-state'
import './stock-divergence-investigation.css'
import './quality-investigation.css'

function fmt(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'
}

function QualityInvestigation({ scenario, stockFile, apiUrl = '' }) {
  const {
    dppState, workspaceReady, stockInvestigation,
    qualityInvestigation, setQualityInvestigation,
  } = useDppWorkspace()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
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
  }, [canRun, report, loading, reportKey, fetchReport])

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

  const found = useMemo(() => qualityFound(report), [report])
  const pending = useMemo(() => pendingRecords(found), [found])
  const filtered = useMemo(() => filterFound(found, search, view), [found, search, view])
  const listPage = useInvestigationPagination(filtered, reportKey + '|' + view + '|' + search)
  const queuePage = useInvestigationPagination(pending, reportKey + '|queue')
  const selected = found.flatMap(material => material.candidates.map(candidate => ({ material, candidate })))
    .find(({ candidate }) => candidate.candidate_id === selectedId)
  const pnPending = new Set(pending.map(item => item.material.material)).size
  const qty = (value, unit) => fmt(value) + (unit ? ' ' + unit : '')
  const validationStatus = candidate => {
    if (!candidate.validation) return 'Aguardando Qualidade / CQ'
    const decision = candidate.validation.decision
    if (decision === 'RELEASED') return candidate.validation.accounting === 'NOT_INCLUDED'
      ? 'Liberado · adicional ao cenário' : 'Liberado · adicional não comprovado'
    if (decision === 'REJECTED') return 'Reprovado pelo CQ'
    if (decision === 'SCRAP_CONFIRMED') return 'Refugo confirmado'
    return 'Sem confirmação'
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
          <p>PNs encaminhados pelo Estoque, encontrados em Q239 ou Q273 do STK ORIGINAL.</p>
          <small>A confirmação da Qualidade/CQ não altera SALDO, NEC ou REAL.</small>
        </div>
        {canRun && <div className="orion-investigation-actions">
          <button type="button" className="secondary-button" disabled={loading || exporting} aria-busy={loading}
            onClick={() => { attemptedRef.current = reportKey; fetchReport() }}>
            {loading ? 'Consultando...' : report ? 'Consultar novamente' : 'Consultar Qualidade'}
          </button>
          {report && <button type="button" className="secondary-button" onClick={exportExcel}
            disabled={loading || exporting} aria-busy={exporting}>
            {exporting ? 'Gerando Excel...' : 'Baixar Excel'}
          </button>}
        </div>}
      </div>
      {!stockReady && <p role="status">Execute primeiro Divergência de Estoque para identificar os PNs encaminhados.</p>}
      {stockReady && !canRun && <p role="status">Nenhum PN foi encaminhado à Qualidade.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {report && <>
        <div className="orion-investigation-local-summary" aria-label="Indicadores da Qualidade">
          <div><span>PNs recebidos</span><strong>{fmt(report.summary.items_received_from_41)}</strong></div>
          <div><span>Encontrados Q239</span><strong>{fmt(report.summary.materials_with_q239)}</strong></div>
          <div><span>Encontrados Q273</span><strong>{fmt(report.summary.materials_with_q273)}</strong></div>
          <div><span>Aguardando CQ</span><strong>{fmt(pnPending)}</strong></div>
          <div><span>Sem registros nesses depósitos</span><strong>{fmt(report.summary.materials_without_quality_records)}</strong></div>
        </div>
        <section className="orion-investigation-queue" id="orion-quality-actions">
          <h4>Confirmar com Qualidade / CQ</h4>
          <p className="orion-investigation-section-description">
            {pending.length ? 'O analista deve solicitar a decisão do CQ para cada registro e confirmar a quantidade efetiva antes de justificar a falta ou recalcular o gap.'
              : 'Nenhum registro encontrado aguarda confirmação da Qualidade.'}
          </p>
          {pending.length > 0 && <>
            <ul className="orion-investigation-queue-list">
              {queuePage.rows.map(({ material, candidate }) => (
                <li key={candidate.candidate_id}>
                  <div className="orion-investigation-queue-description">
                    <strong>PN {material.material} · {candidate.depot}</strong>
                    <span>{material.description || 'Sem descrição'}</span>
                    <span>Encontrado: {qty(candidate.quantity, candidate.unit)} · Falta recebida: {qty(material.gap_from_41, material.unit)} · Gap físico: {qty(material.physical_gap_after_quality, material.unit)}</span>
                  </div>
                  <button type="button" className="secondary-button"
                    onClick={() => setSelectedId(candidate.candidate_id)}>Confirmar com área</button>
                </li>
              ))}
            </ul>
            <InvestigationPagination value={queuePage} label="Pendências da Qualidade" />
          </>}
        </section>

        {selected && <div ref={formRef} className="orion-stock-review-anchor">
          <QualityReviewForm key={selected.candidate.candidate_id}
            scenario={scenario} stockFile={stockFile} candidate={selected.candidate}
            material={selected.material} apiUrl={apiUrl} onCancel={() => setSelectedId('')}
            onSaved={updated => {
              setQualityInvestigation({ reportKey, result: updated })
              setSelectedId('')
              setMessage('Validação da Qualidade registrada. SALDO oficial inalterado.')
            }} />
        </div>}

        <section className="orion-investigation-card-section" aria-label="PNs encontrados no CQ">
          <h4>PNs encontrados em Qualidade</h4>
          <p className="orion-investigation-section-description">
            {found.length} PN(s) encontrados em Q239/Q273. Os {report.summary.materials_without_quality_records} PNs sem registros permanecem no resumo e no Excel, sem serem classificados como refugo confirmado.
          </p>
          {found.length ? <>
            <div className="orion-investigation-found-tools">
              <input type="search" aria-label="Buscar PN encontrado em Qualidade"
                placeholder="Buscar PN, descrição ou depósito"
                value={search} onChange={event => setSearch(event.target.value)} />
              <label>Mostrar
                <select value={view} onChange={event => setView(event.target.value)}>
                  <option value="all">Todos os encontrados</option>
                  <option value="pending">Validações pendentes</option>
                  <option value="reviewed">Sem pendências</option>
                </select>
              </label>
            </div>
            <div className="orion-investigation-found-grid">
              {listPage.rows.map(material => (
                <details key={material.material} className="orion-investigation-pn-card">
                  <summary>
                    <div className="orion-investigation-pn-heading">
                      <strong>PN {material.material}</strong>
                      <span>{material.active_depot || 'Depósito CQ'}</span>
                    </div>
                    <span className="orion-investigation-pn-description">{material.description || 'Sem descrição'}</span>
                    <dl className="orion-investigation-pn-facts">
                      <div><dt>Falta recebida</dt><dd>{qty(material.gap_from_41, material.unit)}</dd></div>
                      <div><dt>Encontrado no CQ</dt><dd>{qty(material.candidates.reduce((acc,c) => acc + Number(c.quantity || 0),0), material.unit)}</dd></div>
                      <div><dt>Gap após CQ</dt><dd>{qty(material.physical_gap_after_quality, material.unit)}</dd></div>
                    </dl>
                  </summary>
                  <div className="orion-investigation-card-body">
                    <dl className="orion-investigation-detail-facts">
                      <div><dt>Potencial teórico (não validado)</dt><dd>{qty(material.theoretical_coverage_limit, material.unit)}</dd></div>
                      <div><dt>Liberação aplicada ao gap</dt><dd>{qty(material.quality_released_applied, material.unit)}</dd></div>
                      <div><dt>Reprovação justificada</dt><dd>{qty(material.quality_rejected_applied, material.unit)}</dd></div>
                      <div><dt>Refugo justificado</dt><dd>{qty(material.quality_scrap_applied, material.unit)}</dd></div>
                      <div><dt>Falta sem explicação</dt><dd>{qty(material.unexplained_after_quality, material.unit)}</dd></div>
                    </dl>
                    <p className="orion-investigation-card-next">{material.next_step}</p>
                    <div className="orion-investigation-depot-list">
                      {material.candidates.map(candidate => (
                        <div key={candidate.candidate_id} className="orion-investigation-depot">
                          <div>
                            <strong>{candidate.depot} · {qty(candidate.quantity, candidate.unit)} encontrados</strong>
                            <span>Centro {candidate.center || '—'} · ORIGINAL, linhas {(candidate.source_rows || []).join(', ')}</span>
                            <small>{validationStatus(candidate)}</small>
                          </div>
                          <button type="button" className="secondary-button"
                            onClick={() => setSelectedId(candidate.candidate_id)}>
                            {candidate.validation ? 'Revisar' : 'Confirmar com área'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              ))}
            </div>
            {!listPage.rows.length && <p>Nenhum PN corresponde à busca ou ao filtro.</p>}
            <InvestigationPagination value={listPage} label="PNs encontrados em Qualidade" />
          </> : <p>Nenhum PN encontrado em Q239/Q273. Consulte o Excel para as faltas sem registro.</p>}
        </section>
        <p className="orion-stock-investigation-note">Reprovação/refugo não recupera estoque. Encaminhamento não comprova scrap e não executa outra análise.</p>
      </>}
    </section>
  )
}

export default QualityInvestigation
