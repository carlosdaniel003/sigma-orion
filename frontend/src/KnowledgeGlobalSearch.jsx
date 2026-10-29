import { useEffect, useMemo, useState } from 'react'
import './knowledge-global-search.css'

const AREA_META = [
  { key: 'operational', label: 'Conhecimento Operacional' },
  { key: 'deterministic', label: 'Regras Determinísticas' },
  { key: 'current', label: 'Dados Atuais' },
  { key: 'tests', label: 'Testes do RAG' },
]

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function compactText(value, query, maxLength = 360) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return '—'
  if (text.length <= maxLength) return text

  const rawQuery = String(query || '').trim().toLowerCase()
  const lowerText = text.toLowerCase()
  const matchIndex = rawQuery ? lowerText.indexOf(rawQuery) : -1
  const start = matchIndex >= 0 ? Math.max(0, matchIndex - 120) : 0
  const end = Math.min(text.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightedText({ value, query }) {
  const text = String(value ?? '—')
  const search = String(query || '').trim()
  if (!search) return text

  const terms = search
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)

  if (!terms.length) return text

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(matcher)
  const normalizedTerms = new Set(terms.map((term) => term.toLowerCase()))

  return parts.map((part, index) => (
    normalizedTerms.has(part.toLowerCase())
      ? <mark className="knowledge-search-highlight" key={`${part}-${index}`}>{part}</mark>
      : part
  ))
}

function stringifyRecord(row) {
  try {
    return JSON.stringify(row)
  } catch {
    return String(row || '')
  }
}

function catalogResults(area, items, query) {
  return (items || []).map((item) => ({
    id: `${area}-${item.id}`,
    area,
    title: item.heading || item.source || 'Conhecimento indexado',
    kind: item.kind || 'documentação',
    source: item.location || item.source || 'Índice de conhecimento',
    detail: compactText(item.content || `${item.heading || ''} ${item.source || ''}`, query),
  }))
}

function currentDataResults(query, scenario, finalDppAnalysis) {
  const q = normalize(query)
  if (!q) return []

  const result = []
  const addCollection = (rows, kind, source, getTitle) => {
    for (let index = 0; index < (rows || []).length; index += 1) {
      const row = rows[index]
      const serialized = stringifyRecord(row)
      if (!normalize(serialized).includes(q)) continue
      result.push({
        id: `current-${source}-${index}`,
        area: 'current',
        title: getTitle(row, index),
        kind,
        source,
        detail: compactText(serialized, query),
      })
    }
  }

  addCollection(
    scenario?.materials,
    'material',
    'Cenário ORION · materiais',
    (row, index) => row?.material || row?.material_key || `Material ${index + 1}`,
  )
  addCollection(
    scenario?.models,
    'modelo',
    'Cenário ORION · modelos',
    (row, index) => row?.name || `Modelo ${index + 1}`,
  )
  addCollection(
    finalDppAnalysis?.material_details,
    'material',
    'DPP Final · materiais',
    (row, index) => row?.material || row?.material_key || `Material ${index + 1}`,
  )
  addCollection(
    finalDppAnalysis?.column_comparison?.columns,
    'comparação',
    'DPP Final · comparativo de colunas',
    (row, index) => row?.name || row?.column || `Coluna ${index + 1}`,
  )

  const scenarioMeta = { ...(scenario || {}) }
  delete scenarioMeta.materials
  delete scenarioMeta.models
  const finalMeta = { ...(finalDppAnalysis || {}) }
  delete finalMeta.material_details
  delete finalMeta.models
  const metadata = [
    ['Cenário ORION · metadados', scenarioMeta],
    ['DPP Final · metadados', finalMeta],
  ]

  for (const [source, value] of metadata) {
    const serialized = stringifyRecord(value)
    if (!normalize(serialized).includes(q)) continue
    result.push({
      id: `current-${source}`,
      area: 'current',
      title: source,
      kind: 'metadado',
      source,
      detail: compactText(serialized, query),
    })
  }

  return result.slice(0, 500)
}

function ragTestResults(query, inventory, ragReport) {
  const q = normalize(query)
  if (!q) return []

  const executed = ragReport?.results || []
  if (executed.length) {
    return executed
      .filter((item) => normalize([
        item.id,
        item.kind,
        item.origin,
        item.question,
        item.title,
        item.answer,
        item.expected_source,
        ...(item.expected_terms || []),
        ...(item.sources || []),
        ...(item.failures || []),
      ].join(' ')).includes(q))
      .slice(0, 500)
      .map((item) => ({
        id: `tests-${item.id}`,
        area: 'tests',
        title: item.title || item.id,
        kind: item.kind || 'teste',
        source: item.expected_source || item.origin || 'Bateria do RAG',
        detail: compactText([
          item.question,
          item.answer,
          item.failures?.length ? item.failures.join(' · ') : 'Conforme esperado',
        ].filter(Boolean).join(' · '), query),
      }))
  }

  return (inventory?.items || [])
    .filter((item) => normalize([
      item.id,
      item.kind,
      item.title,
      item.query,
      item.expected_source,
      item.origin,
      ...(item.expected_terms || []),
    ].join(' ')).includes(q))
    .slice(0, 500)
    .map((item) => ({
      id: `tests-${item.id}`,
      area: 'tests',
      title: item.title || item.id,
      kind: item.kind || 'teste',
      source: item.expected_source || item.origin || 'Inventário do RAG',
      detail: compactText(`${item.query || ''} · termos esperados: ${(item.expected_terms || []).join(', ') || '—'}`, query),
    }))
}

function KnowledgeGlobalSearch({ apiUrl, query, inventory, scenario, finalDppAnalysis, ragReport }) {
  const [catalogs, setCatalogs] = useState({ operational: [], deterministic: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const search = String(query || '').trim()
    if (!search) {
      setCatalogs({ operational: [], deterministic: [] })
      setError('')
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        async function loadCategory(category) {
          const params = new URLSearchParams({ category, q: search, limit: '2000' })
          const response = await fetch(`${apiUrl}/api/knowledge/catalog?${params}`, {
            signal: controller.signal,
            cache: 'no-store',
          })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.detail || `Falha ao pesquisar ${category}.`)
          return payload.items || []
        }

        const [operational, deterministic] = await Promise.all([
          loadCategory('operational'),
          loadCategory('deterministic'),
        ])
        setCatalogs({ operational, deterministic })
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message || 'Falha ao pesquisar a Base de conhecimento.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [apiUrl, query])

  const groups = useMemo(() => ({
    operational: catalogResults('operational', catalogs.operational, query),
    deterministic: catalogResults('deterministic', catalogs.deterministic, query),
    current: currentDataResults(query, scenario, finalDppAnalysis),
    tests: ragTestResults(query, inventory, ragReport),
  }), [catalogs, finalDppAnalysis, inventory, query, ragReport, scenario])

  const rows = useMemo(
    () => AREA_META.flatMap(({ key }) => groups[key] || []),
    [groups],
  )

  return (
    <div className="knowledge-global-search">
      <dl className="knowledge-global-summary" aria-label="Resultados da pesquisa por área">
        {AREA_META.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{(groups[key] || []).length}</dd>
          </div>
        ))}
      </dl>

      {loading && <p className="knowledge-global-state">Pesquisando simultaneamente nas quatro áreas...</p>}
      {error && <p className="knowledge-error">{error}</p>}
      {!loading && !error && !rows.length && (
        <p className="knowledge-empty">Nenhum resultado encontrado nas quatro áreas da Base de conhecimento.</p>
      )}

      {!error && rows.length > 0 && (
        <div className="knowledge-table-wrap knowledge-global-results-wrap">
          <table className="knowledge-table knowledge-global-results">
            <thead>
              <tr>
                <th>Área</th>
                <th>Resultado</th>
                <th>Tipo</th>
                <th>Origem</th>
                <th>Correspondência</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const areaLabel = AREA_META.find((item) => item.key === row.area)?.label || row.area
                return (
                  <tr key={row.id}>
                    <td className="knowledge-global-area-cell"><HighlightedText value={areaLabel} query={query} /></td>
                    <td className="knowledge-global-title-cell"><HighlightedText value={row.title} query={query} /></td>
                    <td><HighlightedText value={row.kind} query={query} /></td>
                    <td className="knowledge-source-cell"><HighlightedText value={row.source} query={query} /></td>
                    <td className="knowledge-global-match-cell"><HighlightedText value={row.detail} query={query} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default KnowledgeGlobalSearch