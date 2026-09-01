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

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function collectKeys(rows, preferred = []) {
  const keys = new Set()
  for (const row of rows || []) Object.keys(row || {}).forEach((key) => keys.add(key))
  const ordered = preferred.filter((key) => keys.delete(key))
  return [...ordered, ...Array.from(keys).sort((left, right) => left.localeCompare(right))]
}

function flattenObject(value, prefix = '', rows = [], source = '') {
  if (value === null || value === undefined || typeof value !== 'object') {
    rows.push({ path: prefix || 'valor', value: formatValue(value), source })
    return rows
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, rows, source))
    if (!value.length) rows.push({ path: prefix, value: '[]', source })
    return rows
  }
  const entries = Object.entries(value)
  if (!entries.length) rows.push({ path: prefix, value: '{}', source })
  entries.forEach(([key, item]) => flattenObject(item, prefix ? `${prefix}.${key}` : key, rows, source))
  return rows
}

const VIEW_META = {
  operational: {
    title: 'Conhecimento Operacional',
    description: 'Inventário do glossário, processo, casos aprovados e conhecimento usado para interpretar o trabalho do DPP.',
  },
  deterministic: {
    title: 'Regras Determinísticas',
    description: 'Inventário automático das regras documentadas e de cada função, método e constante encontrada no código Python do ORION.',
  },
  current: {
    title: 'Dados Atuais',
    description: 'Inventário do mesmo cenário mensal e DPP Final sincronizados com o Dashboard e o Agente ORION.',
  },
  tests: {
    title: 'Testes do RAG',
    description: 'Cobertura automática de cada regra, conceito, fórmula, documento, sinônimo e caso inventariado pelo ORION.',
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

function InventoryStrip({ inventory, report }) {
  if (!inventory) return null
  const coverage = report?.coverage_percent
  const retrieval = report?.retrieval_success_percent
  return (
    <dl className="knowledge-summary-strip knowledge-inventory-strip">
      <div><dt>Inventário</dt><dd>{formatNumber(inventory.total)}</dd></div>
      <div><dt>Regras</dt><dd>{formatNumber(inventory.by_kind?.regra || 0)}</dd></div>
      <div><dt>Conceitos</dt><dd>{formatNumber(inventory.by_kind?.conceito || 0)}</dd></div>
      <div><dt>Fórmulas</dt><dd>{formatNumber(inventory.by_kind?.['fórmula'] || 0)}</dd></div>
      <div><dt>Documentos</dt><dd>{formatNumber(inventory.by_kind?.documento || 0)}</dd></div>
      <div><dt>Sinônimos</dt><dd>{formatNumber(inventory.by_kind?.['sinônimo'] || 0)}</dd></div>
      <div><dt>Casos</dt><dd>{formatNumber(inventory.by_kind?.caso || 0)}</dd></div>
      <div><dt>Erros de varredura</dt><dd>{formatNumber(inventory.scan_error_count || 0)}</dd></div>
      {coverage !== undefined && <div><dt>Cobertura</dt><dd>{formatNumber(coverage)}%</dd></div>}
      {retrieval !== undefined && <div><dt>Recuperação aprovada</dt><dd>{formatNumber(retrieval)}%</dd></div>}
    </dl>
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
              <th>Tipo</th>
              <th>Origem / localização</th>
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
                <td>{item.kind || 'documentação'}</td>
                <td className="knowledge-source-cell">{item.location || item.source}</td>
                <td className="knowledge-number-cell">{item.score === null ? '—' : item.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="knowledge-empty">Nenhum item encontrado para esta consulta.</p>}
      </div>

      <aside className="knowledge-inspector" aria-label="Conteúdo selecionado">
        {selected ? (
          <>
            <div className="knowledge-inspector-head">
              <strong>{selected.heading}</strong>
              <span>{selected.kind || 'documentação'} · {selected.location || selected.source}</span>
            </div>
            <div className="knowledge-document-text">{selected.content}</div>
          </>
        ) : (
          <p className="knowledge-empty">Selecione um conhecimento para visualizar sua origem e conteúdo indexado.</p>
        )}
      </aside>
    </div>
  )
}

function DynamicRecordsTable({ title, rows, query, preferredKeys = [], sourceLabel }) {
  const q = normalize(query)
  const filtered = (rows || []).filter((row) => !q || normalize(JSON.stringify(row)).includes(q))
  const keys = collectKeys(rows, preferredKeys)
  if (!rows?.length) return null
  return (
    <section className="knowledge-data-section">
      <div className="knowledge-section-head">
        <strong>{title}</strong>
        <span>{filtered.length} exibido(s) de {rows.length} · {keys.length} campo(s)</span>
      </div>
      <div className="knowledge-table-wrap knowledge-data-table-wrap">
        <table className="knowledge-table knowledge-data-table">
          <thead>
            <tr>{keys.map((key) => <th key={key}>{key}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={`${sourceLabel}-${index}-${row.material || row.material_key || row.name || ''}`}>
                {keys.map((key) => (
                  <td key={key} className={typeof row[key] === 'number' ? 'knowledge-number-cell' : ''}>{formatValue(row[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CurrentDataView({ scenario, finalDppAnalysis, query, dppState }) {
  const materials = scenario?.materials || []
  const models = scenario?.models || []
  const finalMaterials = finalDppAnalysis?.material_details || []
  const columns = finalDppAnalysis?.column_comparison?.columns || []
  const critical = materials.filter((item) => normalize(item.um) === 'un' && Number(item.balance) < -1e-4)
  const divergentColumns = columns.filter((item) => (
    (item.mode || (item.supported ? 'compare' : 'unsupported')) === 'compare'
    && item.supported
    && (Math.abs(Number(item.delta) || 0) > 1e-4 || Number(item.difference_count) > 0)
  ))
  const month = dppState?.currentMonth || scenario?.reference_month || ''

  const scenarioMeta = { ...(scenario || {}) }
  delete scenarioMeta.materials
  delete scenarioMeta.models
  const finalMeta = { ...(finalDppAnalysis || {}) }
  delete finalMeta.material_details
  delete finalMeta.models
  if (finalMeta.column_comparison) {
    finalMeta.column_comparison = { ...finalMeta.column_comparison }
    delete finalMeta.column_comparison.columns
  }
  const metadataRows = [
    ...flattenObject(scenarioMeta, 'scenario', [], 'Cenário ORION'),
    ...flattenObject(finalMeta, 'final', [], 'DPP Final'),
  ].filter((row) => !query || normalize(`${row.path} ${row.value} ${row.source}`).includes(normalize(query)))

  return (
    <div className="knowledge-current-data">
      <dl className="knowledge-summary-strip">
        <div><dt>Mês</dt><dd>{formatMonth(month)}</dd></div>
        <div><dt>Materiais ORION</dt><dd>{formatNumber(materials.length)}</dd></div>
        <div><dt>Materiais Final</dt><dd>{formatNumber(finalMaterials.length)}</dd></div>
        <div><dt>Modelos</dt><dd>{formatNumber(models.length)}</dd></div>
        <div><dt>Críticos ORION</dt><dd>{formatNumber(critical.length)}</dd></div>
        <div><dt>Colunas comparadas</dt><dd>{formatNumber(columns.length)}</dd></div>
        <div><dt>Colunas divergentes</dt><dd>{formatNumber(divergentColumns.length)}</dd></div>
      </dl>

      <DynamicRecordsTable
        title="Materiais do Cenário ORION · todos os campos"
        rows={materials}
        query={query}
        preferredKeys={['material', 'material_key', 'description', 'um', 'origin_group', 'nec', 'stock', 'stock_sap_effective', 'explosion', 'stock_op', 'stock_total', 'balance', 'price', 'amount']}
        sourceLabel="scenario-material"
      />
      <DynamicRecordsTable
        title="Modelos do Cenário ORION · todos os campos"
        rows={models}
        query={query}
        preferredKeys={['name', 'kit_pgd', 'real']}
        sourceLabel="scenario-model"
      />
      <DynamicRecordsTable
        title="Materiais do DPP Final · todos os campos"
        rows={finalMaterials}
        query={query}
        preferredKeys={['material', 'description', 'um', 'nec', 'stock', 'explosion', 'stock_op', 'stock_total', 'balance', 'price', 'amount']}
        sourceLabel="final-material"
      />
      <DynamicRecordsTable
        title="Comparativo completo · todas as colunas"
        rows={columns}
        query={query}
        preferredKeys={['name', 'column', 'mode', 'supported', 'difference_count', 'delta']}
        sourceLabel="comparison-column"
      />

      <section className="knowledge-data-section">
        <div className="knowledge-section-head"><strong>Metadados completos do workspace</strong><span>{metadataRows.length} campo(s)</span></div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Caminho</th><th>Valor</th><th>Fonte</th></tr></thead>
            <tbody>
              {metadataRows.map((item, index) => (
                <tr key={`${item.source}-${item.path}-${index}`}>
                  <td className="knowledge-code-cell">{item.path}</td>
                  <td>{item.value}</td>
                  <td>{item.source}</td>
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
  if (loading) return <p className="knowledge-empty">Executando bateria completa de recuperação...</p>
  if (error) return <p className="knowledge-error">{error}</p>
  if (!report) return <p className="knowledge-empty">A bateria ainda não foi executada.</p>

  const q = normalize(query)
  const rows = (report.results || []).filter((item) => !q || normalize(`${item.kind} ${item.origin} ${item.question} ${item.title} ${item.answer} ${(item.sources || []).join(' ')}`).includes(q))
  const kinds = Object.entries(report.by_kind || {})

  return (
    <div className="knowledge-tests">
      <dl className="knowledge-summary-strip">
        <div><dt>Inventário testável</dt><dd>{formatNumber(report.inventory_total)}</dd></div>
        <div><dt>Inventário testado</dt><dd>{formatNumber(report.tested_inventory)}</dd></div>
        <div><dt>Cobertura</dt><dd>{formatNumber(report.coverage_percent)}%</dd></div>
        <div><dt>Recuperação aprovada</dt><dd>{formatNumber(report.retrieval_success_percent)}%</dd></div>
        <div><dt>Falhas</dt><dd>{formatNumber(report.failed)}</dd></div>
        <div><dt>Resultado</dt><dd>{report.success ? 'APROVADO' : 'REPROVADO'}</dd></div>
      </dl>

      <section className="knowledge-data-section">
        <div className="knowledge-section-head"><strong>Cobertura por tipo</strong><span>{kinds.length} tipo(s)</span></div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Tipo</th><th>Inventário</th><th>Testados</th><th>Aprovados</th><th>Falhas</th><th>Cobertura</th><th>Recuperação</th></tr></thead>
            <tbody>
              {kinds.map(([kind, stats]) => (
                <tr key={kind}>
                  <td>{kind}</td>
                  <td className="knowledge-number-cell">{stats.inventory}</td>
                  <td className="knowledge-number-cell">{stats.tested}</td>
                  <td className="knowledge-number-cell">{stats.passed}</td>
                  <td className="knowledge-number-cell">{stats.failed}</td>
                  <td className="knowledge-number-cell">{formatNumber(stats.coverage_percent)}%</td>
                  <td className="knowledge-number-cell">{formatNumber(stats.retrieval_success_percent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="knowledge-table-wrap knowledge-tests-table-wrap">
        <table className="knowledge-table">
          <thead>
            <tr><th>Tipo</th><th>Teste / item</th><th>Consulta</th><th>Resultado</th><th>Fonte esperada</th><th>Rank</th><th>Diagnóstico</th></tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>{item.kind}</td>
                <td className="knowledge-code-cell">{item.title || item.id}</td>
                <td>{item.question}</td>
                <td>{item.success ? 'APROVADO' : 'REPROVADO'}</td>
                <td className="knowledge-source-cell">{item.expected_source || 'Nenhuma'}</td>
                <td className="knowledge-number-cell">{item.rank || '—'}</td>
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
  const [inventory, setInventory] = useState(null)
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
    const controller = new AbortController()
    async function loadInventory() {
      try {
        const response = await fetch(`${apiUrl}/api/knowledge/inventory`, { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (response.ok) setInventory(payload)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message || 'Falha ao carregar o inventário.')
      }
    }
    loadInventory()
    return () => controller.abort()
  }, [apiUrl])

  useEffect(() => {
    if (!['operational', 'deterministic'].includes(view)) return undefined
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ category: view, q: query, limit: '2000' })
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
    if (view === 'current') return (generatedScenario?.materials?.length || 0) + (finalDppAnalysis?.material_details?.length || 0)
    if (view === 'tests') return ragReport?.total || 0
    return catalog?.items?.length || 0
  }, [catalog, finalDppAnalysis, generatedScenario, ragReport, view])

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
          <strong>{view === 'current' ? 'Workspace DPP' : view === 'tests' ? 'Auditoria do retrieval' : (indexStatus?.mode || 'SQLite')}</strong>
          <span>
            {view === 'current'
              ? 'Fonte de verdade mensal'
              : view === 'tests'
                ? `${ragReport?.tested_inventory || 0} item(ns) inventariado(s) testado(s)`
                : `${indexStatus?.markdown_document_count || 0} documento(s) · ${indexStatus?.python_rule_count || 0} regra(s) Python`}
          </span>
        </div>
      </header>

      <InventoryStrip inventory={inventory} report={ragReport} />

      <div className="knowledge-search-row">
        <label className="knowledge-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === 'current' ? 'Pesquisar em todos os dados atuais...' : view === 'tests' ? 'Pesquisar nos testes e itens inventariados...' : 'Pesquisar conhecimento indexado...'}
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
