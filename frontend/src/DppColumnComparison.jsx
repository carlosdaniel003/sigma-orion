import { useEffect, useMemo, useState } from 'react'
import InfoHint from './InfoHint'
import './dpp-column-comparison.css'
import './dpp-column-divergence-detail.css'

const PAGE_SIZE = 25
const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
})

const CONTEXTUAL_COLUMN_NAMES = new Set(['coments', 'comments', 'comentario', 'comentarios'])

function isZero(value) {
  return Math.abs(Number(value) || 0) <= 1e-4
}

function normalizeColumnName(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

function resolveColumnMode(column) {
  if (column?.mode) return column.mode

  const name = normalizeColumnName(column?.name)
  if (name === 'opc') return 'reference_final'
  if (CONTEXTUAL_COLUMN_NAMES.has(name)) return 'contextual'
  return column?.supported ? 'compare' : 'unsupported'
}

function normalizeColumn(column) {
  return {
    ...column,
    mode: resolveColumnMode(column),
  }
}

function formatAggregate(column, value) {
  if (value === null || value === undefined) return '—'
  if (column.kind === 'count') return `${NUMBER_FORMAT.format(value)} itens`
  return NUMBER_FORMAT.format(value)
}

function formatDelta(column) {
  if (!column.supported || column.mode !== 'compare' || column.delta === null || column.delta === undefined) return '—'
  const numeric = Number(column.delta) || 0
  if (isZero(numeric)) return column.kind === 'count' ? '0 itens' : '0'
  const sign = numeric > 0 ? '+' : '−'
  const value = NUMBER_FORMAT.format(Math.abs(numeric))
  return column.kind === 'count' ? `${sign}${value} itens` : `${sign}${value}`
}

function differenceLabel(count) {
  const numeric = Number(count) || 0
  return `${NUMBER_FORMAT.format(numeric)} ${numeric === 1 ? 'valor divergente' : 'valores divergentes'}`
}

function formatDetailValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return NUMBER_FORMAT.format(value)
  return String(value)
}

function formatDetailDelta(value) {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value) || 0
  if (isZero(numeric)) return '0'
  return `${numeric > 0 ? '+' : '−'}${NUMBER_FORMAT.format(Math.abs(numeric))}`
}

function DppColumnComparison({ finalDppAnalysis, apiUrl }) {
  const comparison = finalDppAnalysis?.column_comparison
  const analysisId = finalDppAnalysis?.analysis_id || comparison?.analysis_id
  const [selectedColumn, setSelectedColumn] = useState(null)
  const [detail, setDetail] = useState(null)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const columns = useMemo(
    () => (comparison?.columns || []).map(normalizeColumn),
    [comparison],
  )

  const legacyContract = useMemo(
    () => Boolean(comparison?.columns?.some((column) => !column?.mode)),
    [comparison],
  )

  const summary = useMemo(() => {
    let comparableColumns = 0
    let divergentColumns = 0
    let referenceColumns = 0
    let contextualColumns = 0
    let unsupportedColumns = 0

    columns.forEach((column) => {
      if (column.mode === 'reference_final') {
        referenceColumns += 1
        return
      }
      if (column.mode === 'contextual') {
        contextualColumns += 1
        return
      }
      if (column.mode !== 'compare' || !column.supported) {
        unsupportedColumns += 1
        return
      }

      comparableColumns += 1
      if (!isZero(column.delta) || Number(column.difference_count) > 0) {
        divergentColumns += 1
      }
    })

    return {
      comparableColumns,
      divergentColumns,
      referenceColumns,
      contextualColumns,
      unsupportedColumns,
    }
  }, [columns])

  useEffect(() => {
    setSelectedColumn(null)
    setDetail(null)
    setOffset(0)
    setError('')
  }, [analysisId])

  useEffect(() => {
    if (!selectedColumn || !analysisId || !apiUrl) return undefined
    const controller = new AbortController()

    async function loadDetails() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(
          `${apiUrl}/api/dpp/dashboard/final/${analysisId}/columns/${selectedColumn.column}/divergences?offset=${offset}&limit=${PAGE_SIZE}`,
          { signal: controller.signal },
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Os detalhes desta análise não estão mais em memória no backend. Execute novamente a análise do DPP Final para recriar o drill-down com as regras atuais.')
          }
          throw new Error(payload?.detail || 'Não foi possível carregar as divergências desta coluna.')
        }
        setDetail(payload)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setDetail(null)
          setError(requestError.message || 'Não foi possível carregar as divergências desta coluna.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadDetails()
    return () => controller.abort()
  }, [analysisId, apiUrl, offset, selectedColumn])

  if (!columns.length) return null

  function toggleColumn(column) {
    if (!analysisId || column.mode !== 'compare') return
    if (!column.drilldown_available && !legacyContract) return
    if (selectedColumn?.column === column.column) {
      setSelectedColumn(null)
      setDetail(null)
      setOffset(0)
      setError('')
      return
    }
    setSelectedColumn(column)
    setDetail(null)
    setOffset(0)
    setError('')
  }

  return (
    <section className="dpp-column-comparison" aria-labelledby="dpp-column-comparison-title">
      <div className="dpp-column-comparison-heading">
        <div>
          <div className="dpp-column-comparison-title-row">
            <h3 id="dpp-column-comparison-title">Comparativo completo das colunas do DPP</h3>
            <InfoHint
              title="Comparativo completo das colunas do DPP"
              what="Mostra as colunas da aba DPP respeitando a função de cada campo. Colunas calculadas são comparadas; OPC é tratado como consolidação mais recente do DPP Final; COMENTS é contexto mensal do analista; CHECK é comparado pelo conjunto de modelos, sem considerar a ordem do texto."
              source="DPP Final: valores e registros consolidados do mês. Cenário ORION: projeção canônica dos materiais, matriz Material × Modelo e campos calculados pelo motor Python."
              purpose="Separar divergências reais de diferenças esperadas do processo e investigar a causa das divergências calculadas sem classificar reordenação, atualização de OPC ou comentários mensais como erro."
              align="right"
            />
          </div>
          <p>
            Texto é resumido por quantidade de itens preenchidos; colunas numéricas são resumidas pela soma. Apenas campos com regra de comparação equivalente entram na contagem de divergências.
          </p>
          {legacyContract && (
            <p className="dpp-column-comparison-note">
              Este resultado foi criado por uma versão anterior da análise. O drill-down continua disponível enquanto os detalhes permanecerem em memória; para recalcular CHECK e as causas com as regras atuais, execute novamente a análise do DPP Final.
            </p>
          )}
        </div>
        <div className="dpp-column-comparison-summary" aria-label="Resumo do comparativo por coluna">
          <span>{columns.length} colunas</span>
          <span>{summary.comparableColumns} comparáveis</span>
          <span>{summary.divergentColumns} com divergência</span>
          {summary.referenceColumns > 0 && (
            <span>{summary.referenceColumns} de referência final</span>
          )}
          {summary.contextualColumns > 0 && (
            <span>{summary.contextualColumns} contextual</span>
          )}
          {summary.unsupportedColumns > 0 && (
            <span>{summary.unsupportedColumns} sem regra de comparação</span>
          )}
        </div>
      </div>

      <div
        className="dpp-column-comparison-scroll"
        role="region"
        aria-label="Tabela horizontal de comparação de todas as colunas do DPP"
        tabIndex="0"
      >
        <table className="dpp-column-comparison-table">
          <thead>
            <tr>
              <th className="dpp-column-scenario-column" scope="col">Cenário</th>
              {columns.map((column) => (
                <th scope="col" key={`${column.column}-${column.name}`}>
                  <span>{column.name}</span>
                  <small>{column.aggregation_label}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="dpp-column-scenario-column" scope="row">
                <strong>DPP Final</strong>
                <small>Arquivo consolidado</small>
              </th>
              {columns.map((column) => (
                <td className="number-cell" key={`final-${column.column}`}>
                  {formatAggregate(column, column.final_total)}
                </td>
              ))}
            </tr>

            <tr>
              <th className="dpp-column-scenario-column" scope="row">
                <strong>Cenário ORION</strong>
                <small>Motor Python</small>
              </th>
              {columns.map((column) => (
                <td className="number-cell" key={`orion-${column.column}`}>
                  {column.mode === 'contextual'
                    ? '—'
                    : column.supported
                      ? formatAggregate(column, column.orion_total)
                      : '—'}
                </td>
              ))}
            </tr>

            <tr className="dpp-column-difference-row">
              <th className="dpp-column-scenario-column" scope="row">
                <strong>Diferença</strong>
                <small>Final − ORION</small>
              </th>
              {columns.map((column) => {
                const comparable = column.mode === 'compare' && column.supported
                const divergent = comparable && (
                  !isZero(column.delta) || Number(column.difference_count) > 0
                )
                const state = divergent ? 'warning' : 'stable'
                const interactive = state === 'warning'
                  && Boolean(analysisId)
                  && (column.drilldown_available || legacyContract)
                const expanded = selectedColumn?.column === column.column

                let primary = formatDelta(column)
                let secondary = comparable ? differenceLabel(column.difference_count) : column.note
                if (column.mode === 'reference_final') {
                  primary = 'Referência: DPP Final'
                  secondary = column.note || 'Consolidação/correção realizada durante o processo mensal.'
                } else if (column.mode === 'contextual') {
                  primary = 'Anotação mensal'
                  secondary = column.note || 'Registro contextual do analista para este DPP; não participa da comparação.'
                } else if (!column.supported) {
                  primary = 'Sem comparação'
                  secondary = column.note || 'Não existe regra equivalente entre os dois cenários.'
                }

                const content = (
                  <>
                    <span className="dpp-column-state-marker" aria-hidden="true" />
                    <div>
                      <strong>{primary}</strong>
                      <small>{secondary}</small>
                    </div>
                    {interactive && <span className="dpp-column-detail-action">{expanded ? 'Ocultar' : 'Ver detalhes'}</span>}
                  </>
                )

                return (
                  <td
                    className="dpp-column-difference-cell"
                    data-state={state}
                    data-interactive={interactive ? 'true' : 'false'}
                    key={`diff-${column.column}`}
                  >
                    {interactive ? (
                      <button
                        type="button"
                        className="dpp-column-difference-button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Ocultar' : 'Ver'} divergências da coluna ${column.name}`}
                        onClick={() => toggleColumn(column)}
                      >
                        {content}
                      </button>
                    ) : content}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {selectedColumn && (
        <ColumnDivergenceDetail
          column={selectedColumn}
          detail={detail}
          loading={loading}
          error={error}
          offset={offset}
          onPrevious={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}
          onNext={() => setOffset((current) => current + PAGE_SIZE)}
        />
      )}

      <p className="dpp-column-comparison-note">
        CHECK ignora apenas a ordem dos mesmos modelos. OPC usa o DPP Final como registro consolidado mais recente. COMENTS é uma anotação contextual do mês e não participa da comparação de divergências.
      </p>
    </section>
  )
}

function ColumnDivergenceDetail({ column, detail, loading, error, offset, onPrevious, onNext }) {
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = detail?.total ? Math.ceil(detail.total / PAGE_SIZE) : 1

  return (
    <div className="dpp-column-detail" role="region" aria-label={`Divergências da coluna ${column.name}`}>
      <div className="dpp-column-detail-heading">
        <div>
          <strong>{column.name}</strong>
          <span>{differenceLabel(column.difference_count)}</span>
        </div>
        {detail && <small>Página {page} de {pages} · máximo de {PAGE_SIZE} linhas renderizadas por vez</small>}
      </div>

      {loading && <p className="dpp-column-detail-state">Carregando divergências desta página…</p>}
      {!loading && error && <p className="dpp-column-detail-state error">{error}</p>}

      {!loading && !error && detail && (
        <>
          <div className="dpp-column-detail-rule">
            <strong>O que o ORION considera divergente</strong>
            <p>{detail.rule?.definition} {detail.rule?.criterion}</p>
            <small>{detail.rule?.origin}</small>
          </div>

          <div className="dpp-column-detail-table-wrap">
            <table className="dpp-column-detail-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Cenário ORION</th>
                  <th>DPP Final</th>
                  <th>Diferença</th>
                  <th>Por que é divergente</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item, index) => (
                  <tr key={`${item.material}-${offset + index}`}>
                    <th scope="row">
                      <strong>{item.material}</strong>
                      {item.description && <small>{item.description}</small>}
                    </th>
                    <td>{formatDetailValue(item.orion_value)}</td>
                    <td>{formatDetailValue(item.final_value)}</td>
                    <td>{formatDetailDelta(item.delta)}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dpp-column-detail-pagination" aria-label="Paginação das divergências">
            <span>
              Mostrando {detail.returned ? detail.offset + 1 : 0}–{detail.offset + detail.returned} de {NUMBER_FORMAT.format(detail.total)} divergências
            </span>
            <div>
              <button type="button" disabled={!detail.has_previous} onClick={onPrevious}>Anterior</button>
              <button type="button" disabled={!detail.has_next} onClick={onNext}>Próxima</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DppColumnComparison
