import { useEffect, useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import './knowledge-base.css'

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function formatNumber(value) {
  const parsed = Number(value)
  return NUMBER_FORMAT.format(Number.isFinite(parsed) ? parsed : 0)
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const label = new Date(Number(year), Number(month) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const VIEW_META = {
  operational: {
    title: 'Conhecimento Operacional',
    description: 'Glossário, processo, casos aprovados e conhecimento utilizado para interpretar o trabalho do DPP.',
  },
  deterministic: {
    title: 'Regras Determinísticas',
    description: 'Regras documentadas do motor Python, fórmulas, guardrails e critérios de comparação.',
  },
  current: {
    title: 'Dados Atuais',
    description: 'Visualização do mesmo cenário mensal e DPP Final atualmente sincronizados com o Dashboard e o Agente ORION.',
  },
  tests: {
    title: 'Testes do RAG',
    description: 'Bateria de regressão do retrieval. Os mesmos casos são executados pelo CI a cada alteração de código.',
  },
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.5 15.5 4 4" />
    </svg>
  )
}

function CatalogView({ catalog, selectedId, onSelect }) {
  const items = catalog?.items || []
  const selected = items.find((item) => item.id === selectedId) || items[0] || null

  return (
    <div className="knowledge-catalog-layout">
      <div className="knowledge-table-wrap">
        <table className="knowledge-table">
          <thead>
            <tr>
              <th>Conhecimento</th>
              <th>Fonte</th>
              <th>Ranking</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                data-selected={selected?.id === item.id ? 'true' : 'false'}
                onClick={() => onSelect(item.id)}
              >
                <td>{item.heading}</td>
                <td className="knowledge-source-cell">{item.source}</td>
                <td className="knowledge-number-cell">{item.score === null ? '—' : item.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="knowledge-empty">Nenhum trecho encontrado para esta consulta.</p>}
      </div>

      <aside className="knowledge-inspector" aria-label="Conteúdo selecionado">
        {selected ? (
          <>
            <div className="knowledge-inspector-head">
              <strong>{selected.heading}</strong>
              <span>{selected.source}</span>
            </div>
            <div className="knowledge-document-text">{selected.content}</div>
          </>
        ) : (
          <p className="knowledge-empty">Selecione um conhecimento para visualizar o conteúdo indexado.</p>
        )}
      </aside>
    </div>
  )
}

function CurrentDataView({ scenario, finalDppAnalysis, query, dppState }) {
  const q = normalize(query)
  const materials = scenario?.materials || []
  const models = scenario?.models || []
  const critical = materials.filter((item) => normalize(item.um) === 'un' && Number(item.balance) < -1e-4)
  const columns = finalDppAnalysis?.column_comparison?.columns || []
  const divergentColumns = columns.filter((item) => (
    (item.mode || (item.supported ? 'compare' : 'unsupported')) === 'compare'
    && item.supported
    && (Math.abs(Number(item.delta) || 0) > 1e-4 || Number(item.difference_count) > 0)
  ))

  const matchingMaterials = materials.filter((item) => {
    if (!q) return true
    return normalize(`${item.material || item.material_key} ${item.description} ${item.um}`).includes(q)
  }).slice(0, 250)

  const matchingModels = models.filter((item) => {
    if (!q) return false
    return normalize(item.name).includes(q)
  }).slice(0, 100)

  const month = dppState?.currentMonth || scenario?.reference_month || ''

  return (
    <div className="knowledge-current-data">
      <dl className="knowledge-summary-strip">
        <div><dt>Mês</dt><dd>{formatMonth(month)}</dd></div>
        <div><dt>Materiais</dt><dd>{formatNumber(materials.length)}</dd></div>
        <div><dt>Modelos</dt><dd>{formatNumber(models.length)}</dd></div>
        <div><dt>Críticos ORION</dt><dd>{formatNumber(critical.length)}</dd></div>
        <div><dt>Colunas divergentes</dt><dd>{formatNumber(divergentColumns.length)}</dd></div>
      </dl>

      <section className="knowledge-data-section">
        <div className="knowledge-section-head">
          <strong>Materiais do Cenário ORION</strong>
          <span>{matchingMaterials.length} exibido(s) de {materials.length}</span>
        </div>
        <div className="knowledge-table-wrap knowledge-data-table-wrap">
          <table className="knowledge-table knowledge-data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Descrição</th>
                <th>UM</th>
                <th className="knowledge-number-cell">NEC</th>
                <th className="knowledge-number-cell">STK TTL</th>
                <th className="knowledge-number-cell">SALDO</th>
              </tr>
            </thead>
            <tbody>
              {matchingMaterials.map((item) => (
                <tr key={item.material || item.material_key}>
                  <td className="knowledge-code-cell">{item.material || item.material_key}</td>
                  <td>{item.description || '—'}</td>
                  <td>{item.um || '—'}</td>
                  <td className="knowledge-number-cell">{formatNumber(item.nec)}</td>
                  <td className="knowledge-number-cell">{formatNumber(item.stock_total)}</td>
                  <td className="knowledge-number-cell">{formatNumber(item.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {matchingModels.length > 0 && (
        <section className="knowledge-data-section">
          <div className="knowledge-section-head"><strong>Modelos encontrados</strong><span>{matchingModels.length}</span></div>
          <div className="knowledge-table-wrap">
            <table className="knowledge-table">
              <thead><tr><th>Modelo</th><th className="knowledge-number-cell">KIT PGD</th><th className="knowledge-number-cell">REAL ORION</th></tr></thead>
              <tbody>
                {matchingModels.map((item) => (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td className="knowledge-number-cell">{formatNumber(item.kit_pgd)}</td>
                    <td className="knowledge-number-cell">{formatNumber(item.real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="knowledge-data-section">
        <div className="knowledge-section-head"><strong>Comparativo DPP Final × Cenário ORION</strong><span>{divergentColumns.length} coluna(s) divergente(s)</span></div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Coluna</th><th className="knowledge-number-cell">Valores divergentes</th><th className="knowledge-number-cell">Diferença agregada</th></tr></thead>
            <tbody>
              {divergentColumns.map((item) => (
                <tr key={item.column || item.name}>
                  <td>{item.name}</td>
                  <td className="knowledge-number-cell">{formatNumber(item.difference_count)}</td>
                  <td className="knowledge-number-cell">{formatNumber(item.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function RagTestsView({ report, loading, error, query }) {
  if (loading) return <p className="knowledge-empty">Executando bateria de recuperação...</p>
  if (error) return <p className="knowledge-error">{error}</p>
  if (!report) return <p className="knowledge-empty">A bateria ainda não foi executada.</p>

  const q = normalize(query)
  const rows = (report.results || []).filter((item) => !q || normalize(`${item.question} ${item.answer} ${(item.sources || []).join(' ')}`).includes(q))

  return (
    <div className="knowledge-tests">
      <dl className="knowledge-summary-strip">
        <div><dt>Total</dt><dd>{report.total}</dd></div>
        <div><dt>Aprovados</dt><dd>{report.passed}</dd></div>
        <div><dt>Falhas</dt><dd>{report.failed}</dd></div>
        <div><dt>Resultado</dt><dd>{report.success ? 'APROVADO' : 'REPROVADO'}</dd></div>
      </dl>
      <div className="knowledge-table-wrap knowledge-tests-table-wrap">
        <table className="knowledge-table">
          <thead>
            <tr><th>Teste</th><th>Pergunta</th><th>Resultado</th><th>Fonte recuperada</th><th>Diagnóstico</th></tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td className="knowledge-code-cell">{item.id}</td>
                <td>{item.question}</td>
                <td>{item.success ? 'APROVADO' : 'REPROVADO'}</td>
                <td>{item.sources?.length ? item.sources.join(' · ') : 'Nenhuma'}</td>
                <td>{item.failures?.length ? item.failures.join(' · ') : 'Conforme esperado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KnowledgeBase({ apiUrl, view }) {
  const { generatedScenario, finalDppAnalysis, dppState } = useDppWorkspace()
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ragReport, setRagReport] = useState(null)

  const meta = VIEW_META[view] || VIEW_META.operational

  useEffect(() => {
    setQuery('')
    setSelectedId(null)
    setError('')
  }, [view])

  useEffect(() => {
    if (!['operational', 'deterministic'].includes(view)) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ category: view, q: query, limit: '300' })
        const response = await fetch(`${apiUrl}/api/knowledge/catalog?${params}`, { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || 'Não foi possível consultar o índice de conhecimento.')
        setCatalog(payload)
        setSelectedId((current) => payload.items?.some((item) => item.id === current) ? current : payload.items?.[0]?.id || null)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'Falha ao consultar a base.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [apiUrl, query, view])

  useEffect(() => {
    if (view !== 'tests') return undefined
    const controller = new AbortController()
    async function runTests() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`${apiUrl}/api/knowledge/tests/run`, { method: 'POST', signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || 'Não foi possível executar a bateria do RAG.')
        setRagReport(payload)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'Falha ao executar testes do RAG.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    runTests()
    return () => controller.abort()
  }, [apiUrl, view])

  const resultCount = useMemo(() => {
    if (view === 'current') return generatedScenario?.materials?.length || 0
    if (view === 'tests') return ragReport?.total || 0
    return catalog?.items?.length || 0
  }, [catalog, generatedScenario, ragReport, view])

  const indexStatus = catalog?.index

  return (
    <section className="knowledge-page" aria-labelledby="knowledge-title">
      <header className="knowledge-header">
        <div>
          <span className="knowledge-kicker">BASE DE CONHECIMENTO</span>
          <h2 id="knowledge-title">{meta.title}</h2>
          <p>{meta.description}</p>
        </div>
        <div className="knowledge-index-status">
          <strong>{view === 'current' ? 'Workspace DPP' : view === 'tests' ? 'Regressão do retrieval' : (indexStatus?.mode || 'SQLite')}</strong>
          <span>{view === 'current' ? 'Fonte de verdade mensal' : view === 'tests' ? 'Executado localmente' : `${indexStatus?.document_count || 0} documento(s) · ${indexStatus?.chunk_count || 0} chunk(s)`}</span>
        </div>
      </header>

      <div className="knowledge-search-row">
        <label className="knowledge-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === 'current' ? 'Pesquisar material, descrição ou modelo...' : view === 'tests' ? 'Pesquisar nos testes...' : 'Pesquisar conhecimento indexado...'}
          />
        </label>
        <span>{loading ? 'Consultando...' : `${resultCount} registro(s)`}</span>
      </div>

      <div className="knowledge-body">
        {error && <p className="knowledge-error">{error}</p>}
        {!error && ['operational', 'deterministic'].includes(view) && (
          <CatalogView catalog={catalog} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        {!error && view === 'current' && (
          <CurrentDataView scenario={generatedScenario} finalDppAnalysis={finalDppAnalysis} query={query} dppState={dppState} />
        )}
        {!error && view === 'tests' && (
          <RagTestsView report={ragReport} loading={loading} error={error} query={query} />
        )}
      </div>
    </section>
  )
}

export default KnowledgeBase
