import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import { downloadInvestigationExcel } from './investigation-excel'
import StockDepotReviewForm from './StockDepotReviewForm'
import InvestigationPagination, { useInvestigationPagination } from './InvestigationPagination'
import { useDppWorkspace } from './DppWorkspaceContext'
import { fileIdentity, scenarioValidationIdentity } from './dpp-workspace-state'
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
    () => packageKey && scenario?.scenario_id
      ? `${packageKey}|${scenarioValidationIdentity(scenario)}|stock-routing-v3`
      : '',
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

  const rows = useMemo(() => (result?.materials || []).flatMap((material) =>
    material.candidates.map((candidate) => ({ material, candidate })),
  ), [result])
  const summaryRows = useMemo(() => result?.workflow
    ? [...result.workflow.finished, ...result.workflow.forward_to_quality,
      ...result.workflow.awaiting_validation]
      .sort((a, b) => b.initial_deficit - a.initial_deficit || a.material.localeCompare(b.material))
    : [], [result])
  const detailPagination = useInvestigationPagination(rows, reportKey)
  const summaryPagination = useInvestigationPagination(summaryRows, reportKey)
  const selected = rows.find(({ candidate }) => candidate.candidate_id === selectedId)

  return (
    <section className="orion-stock-investigation" aria-label="Divergência de Estoque">
      <div className="orion-stock-investigation-header">
        <div>
          <div className="module-heading-with-info">
            <h3>Divergência de Estoque</h3>
            <ModuleInfoHint moduleKey="dashboard.stock_divergence" />
          </div>
          <p>Conferir PNs críticos nos depósitos M221, P277 e G702 da aba ORIGINAL do STK SAP.</p>
          <small>Consulta para validação do PCM com Almoxarifado. Não altera estoque, REAL ou SALDO.</small>
        </div>
        <div className="orion-investigation-actions">
          <button type="button" className="secondary-button" onClick={investigate}
            disabled={!scenario?.scenario_id || !stockFile || loading || exporting} aria-busy={loading}>
            {loading ? 'Consultando depósitos...' : result ? 'Consultar novamente' : 'Investigar depósitos'}
          </button>
          {result && (
            <button type="button" className="secondary-button" onClick={exportExcel}
              disabled={loading || exporting || !stockFile} aria-busy={exporting}>
              {exporting ? 'Gerando Excel...' : 'Baixar Excel'}
            </button>
          )}
        </div>
      </div>

      {!stockFile && <p role="status">Adicione o arquivo STK SAP ao pacote para consultar os depósitos.</p>}
      {error && <p role="alert">{error}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
      {result && (
        <>
          <div className="orion-stock-investigation-summary" aria-live="polite">
            <span>PNs críticos: <strong>{result.summary.critical_materials}</strong></span>
            <span>PNs com registros: <strong>{result.summary.materials_with_candidates}</strong></span>
            <span>Depósitos validados: <strong>{result.summary.candidates_reviewed}</strong></span>
            <span>Itens finalizados: <strong>{result.summary.items_finished ?? 0}</strong></span>
            <span>Encaminhar à Qualidade: <strong>{result.summary.items_to_quality ?? 0}</strong></span>
            <span>Encaminhamentos provisórios: <strong>{result.summary.provisional_handoffs ?? 0}</strong></span>
            <span>Aguardando validação: <strong>{result.summary.items_awaiting_validation ?? 0}</strong></span>
            <span>Sem registros para esses PNs: <strong>{result.summary.materials_without_candidates}</strong></span>
            <span>Depósitos sem registros no arquivo: <strong>{result.summary.depots_without_records.join(', ') || 'nenhum'}</strong></span>
          </div>
          {rows.length ? (
            <div className="orion-stock-investigation-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Descrição</th><th>SALDO Cenário ORION</th><th>Depósito</th><th>Centro</th>
                    <th>Qtd. sob verificação</th><th>Origem no Excel</th><th>Situação</th><th>Próxima etapa</th><th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {detailPagination.rows.map(({ material, candidate }) => (
                    <tr key={[material.material, candidate.depot, candidate.center || '', candidate.unit].join('|')}>
                      <td>{material.material}</td>
                      <td>{material.description || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(material.balance)} {material.unit}</td>
                      <td>{candidate.depot}</td>
                      <td>{candidate.center || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(candidate.quantity)} {candidate.unit}</td>
                      <td>ORIGINAL · linhas {candidate.source_rows.join(', ')}</td>
                      <td>{candidate.validation
                        ? candidate.validation.decision === 'UNAVAILABLE'
                          ? `Indisponível · ${formatQuantity(candidate.justified_unavailable_quantity)} ${candidate.unit} justificada(s)`
                          : candidate.validation.accounting === 'NOT_INCLUDED' ? 'Disponível · fora do DPP'
                            : candidate.validation.accounting === 'INCLUDED' ? 'Disponível · já contabilizado'
                              : 'Disponível · contabilização pendente'
                        : 'Aguardando PCM/Almoxarifado'}</td>
                      <td>{material.next_step || 'Aguardando validação'}</td>
                      <td><button className="secondary-button" type="button" onClick={() => setSelectedId(candidate.candidate_id)}>
                        {candidate.validation ? 'Revisar' : 'Validar'}
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <InvestigationPagination value={detailPagination} label="Registros por depósito — Estoque"
                onNavigate={() => setSelectedId('')} />
            </div>
          ) : <p>Nenhum PN crítico foi encontrado nos depósitos da investigação. O fluxo indica encaminhamento dos itens à análise de Qualidade 4.2.</p>}
          {selected && (
            <div ref={scrollRef} className="orion-stock-review-anchor">
            <StockDepotReviewForm
              key={selected.candidate.candidate_id}
              scenario={scenario}
              stockFile={stockFile}
              material={selected.material}
              candidate={selected.candidate}
              apiUrl={apiUrl}
              onCancel={() => setSelectedId('')}
              onSaved={(payload) => {
                setStockInvestigation({ packageKey, reportKey, result: payload })
                setSelectedId('')
                setConfirmation('Validação registrada no SQLite local. Nenhum SALDO oficial foi alterado.')
              }}
            />
            </div>
          )}
          {result.workflow && (
            <div className="orion-stock-projection">
              <h4>Resultado da investigação de estoque</h4>
              <p>A quantidade encontrada é evidência, não estoque liberado. A cobertura potencial limita-se ao déficit de cada PN; apenas a quantidade validada e atribuída reduz o gap. Encaminhamentos podem ser provisórios quando restam validações.</p>
              <div className="orion-stock-investigation-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PN</th><th>Falta inicial</th><th>Potencial teórico</th>
                      <th>Disponível aplicado</th><th>Gap após recuperação</th>
                      <th>Indisponível aplicada</th><th>Sem justificativa</th><th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryPagination.rows.map((item) => (
                        <tr key={item.material}>
                          <td>{item.material}</td>
                          <td className="orion-stock-number">{formatQuantity(item.initial_deficit)} {item.unit}</td>
                          <td className="orion-stock-number">{formatQuantity(
                            Math.min(item.initial_deficit,
                              (result.materials.find((m) => m.material === item.material)?.candidate_quantity) || 0),
                          )} {item.unit}</td>
                          <td className="orion-stock-number">{formatQuantity(item.recovered_quantity)} {item.unit}</td>
                          <td className="orion-stock-number">{formatQuantity(item.remaining_gap_after_recovery)} {item.unit}</td>
                          <td className="orion-stock-number">{formatQuantity(item.justified_unavailable_quantity)} {item.unit}</td>
                          <td className="orion-stock-number">{formatQuantity(item.unexplained_quantity)} {item.unit}</td>
                          <td>
                            {item.next_step}
                            {item.pending_reviews > 0 && (
                              <small> · {item.pending_reviews} registro(s) ainda sem validação</small>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                <InvestigationPagination value={summaryPagination} label="Resultado por PN — Estoque" />
              </div>
            </div>
          )}
          {Object.values(result.summary.ignored_records || {}).some((count) => count > 0) && (
            <p>Registros não somados por quantidade inválida, não positiva ou unidade divergente: {Object.entries(result.summary.ignored_records).map(([reason, count]) => reason.replaceAll('_', ' ') + ': ' + count).join(' · ')}.</p>
          )}
          <p className="orion-stock-investigation-note">{result.note}</p>
        </>
      )}
    </section>
  )
}

export default StockDivergenceInvestigation
