import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import OrionVisualIcon from './OrionVisualIcon'
import { downloadInvestigationExcel } from './investigation-excel'
import StockDepotReviewForm from './StockDepotReviewForm'
import InvestigationPagination, { useInvestigationPagination } from './InvestigationPagination'
import { stockFound, pendingRecords, filterFound } from './investigation-view-model'
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
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')
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

  const found = useMemo(() => stockFound(result), [result])
  const pending = useMemo(() => pendingRecords(found), [found])
  const visible = useMemo(() => filterFound(found, search, view), [found, search, view])
  const listPage = useInvestigationPagination(visible, reportKey + '|' + view + '|' + search)
  const queuePage = useInvestigationPagination(pending, reportKey + '|queue')
  const selected = found.flatMap(material => material.candidates.map(candidate => ({ material, candidate })))
    .find(({ candidate }) => candidate.candidate_id === selectedId)
  const pnPending = new Set(pending.map(item => item.material.material)).size
  const qty = (value, unit) => formatQuantity(value) + (unit ? ' ' + unit : '')
  const status = candidate => {
    if (!candidate.validation) return 'Aguardando PCM / Almoxarifado'
    if (candidate.validation.decision === 'UNAVAILABLE') return 'Indisponível · justificado'
    if (candidate.validation.accounting === 'NOT_INCLUDED') return 'Disponível · fora do DPP'
    if (candidate.validation.accounting === 'INCLUDED') return 'Disponível · já contabilizado'
    return 'Disponível · contabilização não confirmada'
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
          <p>Localização de PNs críticos em M221 e P277 na aba ORIGINAL do STK SAP.</p>
          <small>PCM e Almoxarifado devem confirmar cada quantidade. O SALDO oficial não é alterado.</small>
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
      {result && (
        <>
          <div className="orion-investigation-local-summary" aria-label="Indicadores de Estoque">
            <div><span>PNs críticos</span><strong>{formatQuantity(result.summary.critical_materials)}</strong></div>
            <div><span>PNs encontrados</span><strong>{formatQuantity(result.summary.materials_with_candidates)}</strong></div>
            <div><span>Aguardando Almoxarifado</span><strong>{formatQuantity(pnPending)}</strong></div>
            <div><span>Sem registros</span><strong>{formatQuantity(result.summary.materials_without_candidates)}</strong></div>
            <div><span>Encaminhados à Qualidade</span><strong>{formatQuantity(result.summary.items_to_quality)}</strong></div>
          </div>
          <section className="orion-investigation-queue" id="orion-stock-actions">
            <h4>Confirmar com Almoxarifado</h4>
            <p className="orion-investigation-section-description">
              {pending.length ? 'O analista deve confirmar os registros encontrados com PCM / Almoxarifado antes de considerar disponibilidade ou justificar baixa.'
                : 'Nenhum registro encontrado aguarda confirmação.'}
            </p>
            {pending.length > 0 && <>
              <ul className="orion-investigation-queue-list">
                {queuePage.rows.map(({ material, candidate }) => (
                  <li key={candidate.candidate_id}>
                    <div className="orion-investigation-queue-description">
                      <strong>PN {material.material} · {candidate.depot}</strong>
                      <span>{material.description || 'Sem descrição'}</span>
                      <span>Encontrado: {qty(candidate.quantity, candidate.unit)} · Falta inicial: {qty(material.negative_balance, material.unit)} · Gap: {qty(material.projected_gap_remaining, material.unit)}</span>
                    </div>
                    <button type="button" className="secondary-button" onClick={() => setSelectedId(candidate.candidate_id)}>Confirmar com área</button>
                  </li>
                ))}
              </ul>
              <InvestigationPagination value={queuePage} label="Pendências do Almoxarifado" />
            </>}
          </section>

          {selected && <div ref={scrollRef} className="orion-stock-review-anchor">
            <StockDepotReviewForm key={selected.candidate.candidate_id}
              scenario={scenario} stockFile={stockFile} material={selected.material}
              candidate={selected.candidate} apiUrl={apiUrl} onCancel={() => setSelectedId('')}
              onSaved={payload => {
                setStockInvestigation({ packageKey, reportKey, result: payload })
                setSelectedId('')
                setConfirmation('Validação registrada. SALDO oficial inalterado.')
              }} />
          </div>}

          <section className="orion-investigation-card-section" aria-label="PNs encontrados no Estoque">
            <h4>PNs encontrados nos depósitos</h4>
            <p className="orion-investigation-section-description">
              {found.length} PN(s) encontrados em M221/P277. Os {result.summary.materials_without_candidates} PNs sem registros permanecem no resumo e no Excel.
            </p>
            {found.length ? <>
              <div className="orion-investigation-found-tools">
                <input type="search" aria-label="Buscar PN encontrado em Estoque"
                  placeholder="Buscar PN, descrição ou depósito" value={search}
                  onChange={event => setSearch(event.target.value)} />
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
                  <details className="orion-investigation-pn-card" key={material.material}>
                    <summary>
                      <div className="orion-investigation-pn-heading">
                        <strong>PN {material.material}</strong>
                        <span>{[...new Set(material.candidates.map(c => c.depot))].join(' / ')}</span>
                      </div>
                      <span className="orion-investigation-pn-description">{material.description || 'Sem descrição'}</span>
                      <dl className="orion-investigation-pn-facts">
                        <div><dt>Falta inicial</dt><dd>{qty(material.negative_balance, material.unit)}</dd></div>
                        <div><dt>Encontrado</dt><dd>{qty(material.candidate_quantity, material.unit)}</dd></div>
                        <div><dt>Gap recalculado</dt><dd>{qty(material.projected_gap_remaining, material.unit)}</dd></div>
                      </dl>
                    </summary>
                    <div className="orion-investigation-card-body">
                      <dl className="orion-investigation-detail-facts">
                        <div><dt>SALDO do cenário</dt><dd>{qty(material.balance, material.unit)}</dd></div>
                        <div><dt>Cobertura potencial (não validada)</dt><dd>{qty(material.theoretical_coverage_limit, material.unit)}</dd></div>
                        <div><dt>Disponível aplicado ao gap</dt><dd>{qty(material.recovered_quantity_applied, material.unit)}</dd></div>
                        <div><dt>Indisponível justificada</dt><dd>{qty(material.justified_unavailable_applied, material.unit)}</dd></div>
                        <div><dt>Falta sem justificativa</dt><dd>{qty(material.unexplained_quantity, material.unit)}</dd></div>
                      </dl>
                      <p className="orion-investigation-card-next">{material.next_step}</p>
                      <div className="orion-investigation-depot-list">
                        {material.candidates.map(candidate => (
                          <div className="orion-investigation-depot" key={candidate.candidate_id}>
                            <div>
                              <strong>{candidate.depot} · {qty(candidate.quantity, candidate.unit)} encontrados</strong>
                              <span>Centro {candidate.center || '—'} · ORIGINAL, linhas {(candidate.source_rows || []).join(', ')}</span>
                              <small>{status(candidate)}</small>
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
              <InvestigationPagination value={listPage} label="PNs encontrados em Estoque" />
            </> : <p>Nenhum PN encontrado nos depósitos investigados. Consulte o Excel para as faltas sem registro.</p>}
          </section>
          <p className="orion-stock-investigation-note">Encontrado não significa disponível. Só a validação registrada pode alterar o gap projetado.</p>
          <a className="orion-visual-backlink" href="#orion-investigation-overview">
            <OrionVisualIcon name="up" size={16} /> Voltar ao resumo operacional
          </a>
        </>
      )}
    </section>
  )
}

export default StockDivergenceInvestigation
