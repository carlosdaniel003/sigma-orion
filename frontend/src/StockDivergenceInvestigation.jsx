import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import StockDepotReviewForm from './StockDepotReviewForm'
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
      ? `${packageKey}|${scenarioValidationIdentity(scenario)}`
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

  const rows = (result?.materials || []).flatMap((material) =>
    material.candidates.map((candidate) => ({ material, candidate })),
  )

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
        <button type="button" className="secondary-button" onClick={investigate}
          disabled={!scenario?.scenario_id || !stockFile || loading} aria-busy={loading}>
          {loading ? 'Consultando depósitos...' : result ? 'Consultar novamente' : 'Investigar depósitos'}
        </button>
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
            <span>Sem registros para esses PNs: <strong>{result.summary.materials_without_candidates}</strong></span>
            <span>Depósitos sem registros no arquivo: <strong>{result.summary.depots_without_records.join(', ') || 'nenhum'}</strong></span>
          </div>
          {rows.length ? (
            <div className="orion-stock-investigation-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Descrição</th><th>SALDO</th><th>Depósito</th><th>Centro</th>
                    <th>Qtd. sob verificação</th><th>Origem no Excel</th><th>Situação</th><th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ material, candidate }) => (
                    <tr key={[material.material, candidate.depot, candidate.center || '', candidate.unit].join('|')}>
                      <td>{material.material}</td>
                      <td>{material.description || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(material.balance)} {material.unit}</td>
                      <td>{candidate.depot}</td>
                      <td>{candidate.center || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(candidate.quantity)} {candidate.unit}</td>
                      <td>ORIGINAL · linhas {candidate.source_rows.join(', ')}</td>
                      <td>{candidate.validation
                        ? candidate.validation.decision === 'UNAVAILABLE' ? 'Indisponível'
                          : candidate.validation.accounting === 'NOT_INCLUDED' ? 'Disponível · fora do DPP'
                            : candidate.validation.accounting === 'INCLUDED' ? 'Disponível · já contabilizado'
                              : 'Disponível · contabilização pendente'
                        : 'Aguardando PCM/Almoxarifado'}</td>
                      <td><button className="secondary-button" type="button" onClick={() => setSelectedId(candidate.candidate_id)}>
                        {candidate.validation ? 'Revisar' : 'Validar'}
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>Nenhum PN crítico foi encontrado nos depósitos da investigação.</p>}
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
          {result.materials.some((material) => material.candidates.some((candidate) => candidate.validation)) && (
            <div className="orion-stock-projection">
              <h4>Projeção do gap após validações</h4>
              <p>Somente quantidade declarada disponível e não contabilizada no DPP. Não modifica o cenário oficial.</p>
              <div className="orion-stock-investigation-scroll">
                <table>
                  <thead><tr><th>PN</th><th>Gap inicial</th><th>Quantidade adicional</th><th>Gap projetado restante</th></tr></thead>
                  <tbody>{result.materials.filter((material) => material.candidates.some((candidate) => candidate.validation)).map((material) => (
                    <tr key={material.material}>
                      <td>{material.material}</td>
                      <td className="orion-stock-number">{formatQuantity(material.negative_balance)} {material.unit}</td>
                      <td className="orion-stock-number">{formatQuantity(material.confirmed_increment_outside_dpp)} {material.unit}</td>
                      <td className="orion-stock-number">{formatQuantity(material.projected_gap_remaining)} {material.unit}</td>
                    </tr>
                  ))}</tbody>
                </table>
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
