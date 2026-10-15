import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import QualityReviewForm from './QualityReviewForm'
import { useDppWorkspace } from './DppWorkspaceContext'
import { fileIdentity } from './dpp-workspace-state'
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
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const controllerRef = useRef(null)
  const attemptedRef = useRef('')
  const formRef = useRef(null)

  const packageKey = workspaceReady && stockFile
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile)
    : ''
  const stockReady = Boolean(
    packageKey && scenario?.scenario_id
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
    ? stockInvestigation.reportKey + '|quality-4.2-v1|' + reviewRevision
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

  const selected = (report?.materials || []).flatMap((material) =>
    material.candidates.map((candidate) => ({ material, candidate })),
  ).find(({ candidate }) => candidate.candidate_id === selectedId)

  return (
    <section className="orion-stock-investigation orion-quality-investigation" aria-label="Análise de Qualidade">
      <div className="orion-stock-investigation-header">
        <div>
          <div className="module-heading-with-info">
            <h3>Análise de Qualidade</h3>
            <ModuleInfoHint moduleKey="dashboard.quality_investigation" />
          </div>
          <p>Consultar Q239 (em análise no CQ) e, se não houver registro em Q239, Q273 (refugo).</p>
          <small>Apenas PNs encaminhados por Divergência de Estoque. Não altera SALDO, NEC ou REAL.</small>
        </div>
        {canRun && (
          <button type="button" className="secondary-button" disabled={loading} aria-busy={loading}
            onClick={() => { attemptedRef.current = reportKey; fetchReport() }}>
            {loading ? 'Consultando Qualidade...' : report ? 'Consultar novamente' : 'Consultar Qualidade'}
          </button>
        )}
      </div>

      {!stockReady && <p role="status">Execute primeiro a investigação de Divergência de Estoque para identificar os PNs encaminhados.</p>}
      {stockReady && !canRun && <p role="status">Nenhum PN foi encaminhado à Qualidade pela etapa anterior.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {report && (
        <>
          <div className="orion-stock-investigation-summary" aria-live="polite">
            <span>PNs recebidos: <strong>{report.summary.items_received_from_41}</strong></span>
            <span>PNs em Q239: <strong>{report.summary.materials_with_q239}</strong></span>
            <span>PNs em Q273: <strong>{report.summary.materials_with_q273}</strong></span>
            <span>Sem registros: <strong>{report.summary.materials_without_quality_records}</strong></span>
            <span>Finalizados: <strong>{report.summary.items_finished}</strong></span>
            <span>Encaminhar a Scrap: <strong>{report.summary.items_to_scrap}</strong></span>
            <span>Aguardando CQ: <strong>{report.summary.items_awaiting_quality}</strong></span>
          </div>
          {report.materials.some((item) => item.candidates.length > 0) && (
            <div className="orion-stock-investigation-scroll">
              <table>
                <thead><tr>
                  <th>PN</th><th>Descrição</th><th>Depósito</th><th>Centro</th><th>Qtd. sob verificação</th>
                  <th>Origem</th><th>Resultado</th><th>Ação</th>
                </tr></thead>
                <tbody>
                  {report.materials.filter((item) => item.candidates.length > 0).flatMap((material) =>
                    material.candidates.map((candidate) => (
                      <tr key={candidate.candidate_id}>
                        <td>{material.material}</td>
                        <td>{material.description || '—'}</td>
                        <td>{candidate.depot}</td>
                        <td>{candidate.center || '—'}</td>
                        <td className="orion-stock-number">{fmt(candidate.quantity)} {candidate.unit}</td>
                        <td>ORIGINAL · linhas {candidate.source_rows.join(', ')}</td>
                        <td>{candidate.validation
                          ? candidate.validation.decision === 'RELEASED'
                            ? (candidate.validation.accounting === 'NOT_INCLUDED'
                              ? 'Liberado · adicional ao DPP' : 'Liberado · adicional não comprovado')
                            : candidate.validation.decision === 'REJECTED' ? 'Reprovado'
                              : candidate.validation.decision === 'SCRAP_CONFIRMED' ? 'Refugo confirmado'
                                : 'Sem confirmação'
                          : 'Aguardando CQ'}</td>
                        <td><button type="button" className="secondary-button"
                          onClick={() => setSelectedId(candidate.candidate_id)}>
                          {candidate.validation ? 'Revisar' : 'Validar'}
                        </button></td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
          {selected && (
            <div ref={formRef} className="orion-stock-review-anchor">
              <QualityReviewForm key={selected.candidate.candidate_id} scenario={scenario}
                stockFile={stockFile} candidate={selected.candidate} material={selected.material}
                apiUrl={apiUrl} onCancel={() => setSelectedId('')}
                onSaved={(updated) => {
                  setQualityInvestigation({ reportKey, result: updated })
                  setSelectedId('')
                  setMessage('Validação da Qualidade registrada. O SALDO oficial permanece inalterado.')
                }}
              />
            </div>
          )}
          <section className="orion-stock-projection">
            <h4>Consolidação e próxima etapa</h4>
            <p>Justificativas explicam causas; somente liberação adicional reduz o gap físico projetado. O encaminhamento a Scrap 4.3 ainda não executa essa análise.</p>
            <div className="orion-stock-investigation-scroll">
              <table>
                <thead><tr>
                  <th>PN</th><th>Falta recebida de 4.1</th><th>Liberado adicional</th>
                  <th>Reprovado justificado</th><th>Refugo justificado</th>
                  <th>Gap físico após Qualidade</th><th>Sem explicação</th><th>Próxima etapa</th>
                </tr></thead>
                <tbody>
                  {report.materials.map((material) => (
                    <tr key={material.material}>
                      <td>{material.material}</td>
                      <td className="orion-stock-number">{fmt(material.gap_from_41)} {material.unit}</td>
                      <td className="orion-stock-number">{fmt(material.quality_released)} {material.unit}</td>
                      <td className="orion-stock-number">{fmt(material.quality_rejected_justified)} {material.unit}</td>
                      <td className="orion-stock-number">{fmt(material.quality_scrap_justified)} {material.unit}</td>
                      <td className="orion-stock-number">{fmt(material.physical_gap_after_quality)} {material.unit}</td>
                      <td className="orion-stock-number">{fmt(material.unexplained_after_quality)} {material.unit}</td>
                      <td>{material.next_step}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="orion-stock-investigation-note">{report.note}</p>
        </>
      )}
    </section>
  )
}

export default QualityInvestigation
