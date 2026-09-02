import { Fragment, useEffect, useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import './final-model-plan.css'

const NUMERIC_TOLERANCE = 1e-4
const PAGE_SIZE = 25

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sameNumber(left, right) {
  return Math.abs(number(left) - number(right)) <= NUMERIC_TOLERANCE
}

function normalizeModelName(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR')
}

function formatNumber(value) {
  return number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function formatDelta(value) {
  const delta = number(value)
  if (sameNumber(delta, 0)) return '0'
  return `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))}`
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function rowState(row) {
  if (!row.orionPresent) return { label: 'Ausente no ORION', tone: 'missing' }
  if (!row.finalPresent) return { label: 'Ausente no DPP Final', tone: 'missing' }
  if (!row.divergent) return { label: 'Igual', tone: 'stable' }
  return { label: 'Divergente', tone: 'attention' }
}

function mappingStrategyLabel(strategy) {
  const labels = {
    EXACT_NAME: 'nome exato',
    PRODUCT_CODE: 'código do produto',
    MONTHLY_VARIANT_RULE: 'regra mensal de variante',
    HISTORICAL_VARIANT: 'histórico da variante',
  }
  return labels[strategy] || strategy || 'mapeamento não identificado'
}

function metricReason(model, metric) {
  if (!model.orionPresent) return 'O modelo existe no DPP Final, mas não existe no Cenário ORION.'
  if (!model.finalPresent) return 'O modelo existe no Cenário ORION, mas não existe no DPP Final.'

  const divergent = metric === 'pgd' ? model.pgdDivergent : model.realDivergent
  const delta = metric === 'pgd' ? model.pgdDelta : model.realDelta
  if (!divergent) return 'Sem divergência neste campo: os valores coincidem dentro da tolerância operacional.'

  if (metric === 'pgd') {
    return `O KIT disponível PGD do DPP Final difere do valor mapeado pelo ORION em ${formatDelta(delta)}. Como |Final − ORION| é maior que ${NUMERIC_TOLERANCE}, este campo é divergente.`
  }
  return `O REAL consolidado no DPP Final difere do REAL atual do Cenário ORION em ${formatDelta(delta)}. Como |Final − ORION| é maior que ${NUMERIC_TOLERANCE}, este campo é divergente.`
}

function ModelDivergenceDetail({ model, mapping }) {
  const mappedSource = mapping
    ? `PGD “${mapping.pgd_model || '—'}”${mapping.pgd_code ? ` (${mapping.pgd_code})` : ''} → modelo DPP “${mapping.dpp_model || model.name}”, por ${mappingStrategyLabel(mapping.strategy)}.`
    : 'Não há registro de mapeamento PGD associado a este modelo no diagnóstico atual.'

  return (
    <div className="final-model-detail" role="region" aria-label={`Explicação das divergências do modelo ${model.name}`}>
      <div className="final-model-detail-rule">
        <strong>O que o ORION considera divergente</strong>
        <p>
          O modelo é divergente quando está ausente em um dos lados ou quando pelo menos um dos campos comparados — KIT disponível PGD ou REAL — apresenta |DPP Final − ORION| maior que {NUMERIC_TOLERANCE}.
        </p>
      </div>

      <div className="final-model-detail-table-wrap">
        <table className="final-model-detail-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Cenário ORION</th>
              <th>DPP Final</th>
              <th>Diferença</th>
              <th>Regra ORION / por que é divergente</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">KIT disponível PGD</th>
              <td>{model.orionPresent ? formatNumber(model.orionPgd) : '—'}</td>
              <td>{model.finalPresent ? formatNumber(model.finalPgd) : '—'}</td>
              <td>{model.pgdDelta === null ? '—' : formatDelta(model.pgdDelta)}</td>
              <td>
                <strong>Regra:</strong> o ORION traz o KIT do PGD mensal para o modelo do DPP por mapeamento determinístico. {mappedSource} {metricReason(model, 'pgd')}
              </td>
            </tr>
            <tr>
              <th scope="row">REAL</th>
              <td>{model.orionPresent ? formatNumber(model.orionReal) : '—'}</td>
              <td>{model.finalPresent ? formatNumber(model.finalReal) : '—'}</td>
              <td>{model.realDelta === null ? '—' : formatDelta(model.realDelta)}</td>
              <td>
                <strong>Regra:</strong> ao criar o cenário, o REAL inicial do ORION é igual ao KIT PGD; depois, o REAL atual pode ser recalculado no cenário e esse valor passa a ser a referência. {metricReason(model, 'real')}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {mapping?.kit_pgd_before_rule !== null && mapping?.kit_pgd_before_rule !== undefined && (
        <p className="final-model-detail-note">
          Regra mensal aplicada ao KIT PGD: valor antes da regra {formatNumber(mapping.kit_pgd_before_rule)} → valor usado pelo ORION {formatNumber(mapping.kit_pgd)}.
        </p>
      )}
    </div>
  )
}

function FinalModelPlan({ finalDppAnalysis }) {
  const { generatedScenario } = useDppWorkspace()
  const finalModels = finalDppAnalysis?.models || []
  const orionModels = generatedScenario?.models || []
  const pgdMappings = generatedScenario?.pgd_mapping?.mapped || []
  const [filter, setFilter] = useState('divergent')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [selectedKey, setSelectedKey] = useState(null)

  const comparisonModels = useMemo(() => {
    const orionMap = new Map(
      orionModels
        .filter((model) => normalizeModelName(model.name))
        .map((model) => [normalizeModelName(model.name), model]),
    )
    const finalMap = new Map(
      finalModels
        .filter((model) => normalizeModelName(model.name))
        .map((model) => [normalizeModelName(model.name), model]),
    )
    const keys = new Set([...orionMap.keys(), ...finalMap.keys()])

    return [...keys].map((key) => {
      const orion = orionMap.get(key) || null
      const final = finalMap.get(key) || null
      const orionPgd = orion ? number(orion.kit_pgd) : null
      const orionReal = orion ? number(orion.real) : null
      const finalPgd = final ? number(final.pgd) : null
      const finalReal = final ? number(final.real) : null
      const pgdDivergent = !orion || !final || !sameNumber(orionPgd, finalPgd)
      const realDivergent = !orion || !final || !sameNumber(orionReal, finalReal)

      return {
        key,
        name: final?.name || orion?.name || key,
        orionPresent: Boolean(orion),
        finalPresent: Boolean(final),
        orionPgd,
        orionReal,
        finalPgd,
        finalReal,
        pgdDelta: orion && final ? finalPgd - orionPgd : null,
        realDelta: orion && final ? finalReal - orionReal : null,
        pgdDivergent,
        realDivergent,
        divergent: pgdDivergent || realDivergent,
        finalActive: Boolean(final) && finalReal > NUMERIC_TOLERANCE,
      }
    })
  }, [orionModels, finalModels])

  const summary = useMemo(() => {
    const divergent = comparisonModels.filter((model) => model.divergent)
    return {
      total: comparisonModels.length,
      divergent: divergent.length,
      pgdDivergent: comparisonModels.filter((model) => model.pgdDivergent).length,
      realDivergent: comparisonModels.filter((model) => model.realDivergent).length,
      equal: comparisonModels.filter((model) => !model.divergent).length,
    }
  }, [comparisonModels])

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')

    return [...comparisonModels]
      .filter((model) => {
        if (filter === 'divergent' && !model.divergent) return false
        if (filter === 'active' && !model.finalActive) return false
        if (normalizedQuery && !String(model.name || '').toLocaleLowerCase('pt-BR').includes(normalizedQuery)) return false
        return true
      })
      .sort((left, right) => {
        if (left.divergent !== right.divergent) return left.divergent ? -1 : 1
        const realDifference = Math.abs(number(right.realDelta)) - Math.abs(number(left.realDelta))
        if (!sameNumber(realDifference, 0)) return realDifference
        const pgdDifference = Math.abs(number(right.pgdDelta)) - Math.abs(number(left.pgdDelta))
        if (!sameNumber(pgdDifference, 0)) return pgdDifference
        return String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')
      })
  }, [comparisonModels, filter, query])

  useEffect(() => {
    setPage(0)
    setSelectedKey(null)
  }, [filter, query, finalDppAnalysis?.analysis_id, generatedScenario?.scenario_id])

  const pageCount = Math.max(Math.ceil(visibleModels.length / PAGE_SIZE), 1)
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * PAGE_SIZE
  const pagedModels = visibleModels.slice(pageStart, pageStart + PAGE_SIZE)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  if (!finalDppAnalysis || !finalModels.length) return null

  function mappingFor(model) {
    return pgdMappings.find((item) => normalizeModelName(item.dpp_model) === model.key) || null
  }

  function toggleDetails(model) {
    if (!model.divergent) return
    setSelectedKey((current) => current === model.key ? null : model.key)
  }

  return (
    <section className="final-model-plan" aria-label="Comparação do plano por modelo entre cenário ORION e DPP Final">
      <div className="final-model-plan-heading">
        <div>
          <span className="final-model-plan-eyebrow">ORION × DPP FINAL</span>
          <h3>Plano consolidado por modelo</h3>
          <p>Compara, modelo a modelo, o KIT disponível PGD e o REAL gerados pelo ORION com os valores efetivamente consolidados no DPP Final.</p>
        </div>

        <div className="final-model-plan-sources" aria-label="Origens dos dados comparados">
          <div className="final-model-plan-source orion-source">
            <span>CENÁRIO ORION</span>
            <strong>{formatMonth(generatedScenario?.reference_month)}</strong>
            <small>Valores calculados pelo motor Python</small>
          </div>
          <div className="final-model-plan-source final-source">
            <span>DPP FINAL</span>
            <strong>{finalDppAnalysis.filename || 'DPP final'}</strong>
            <small>Valores lidos do arquivo consolidado</small>
          </div>
        </div>
      </div>

      <div className="final-model-plan-summary" aria-label="Resumo da comparação por modelo">
        <div>
          <span>Modelos comparados</span>
          <strong>{formatNumber(summary.total)}</strong>
        </div>
        <div className={summary.divergent ? 'attention' : 'stable'}>
          <span>Modelos divergentes</span>
          <strong>{formatNumber(summary.divergent)}</strong>
        </div>
        <div className={summary.realDivergent ? 'attention' : 'stable'}>
          <span>REAL divergente</span>
          <strong>{formatNumber(summary.realDivergent)}</strong>
          <small>{formatNumber(summary.pgdDivergent)} com KIT PGD divergente</small>
        </div>
        <div className="stable">
          <span>Sem divergência</span>
          <strong>{formatNumber(summary.equal)}</strong>
        </div>
      </div>

      <div className="final-model-plan-toolbar">
        <div className="final-model-plan-filters" role="group" aria-label="Filtrar comparação de modelos">
          <button type="button" className={filter === 'divergent' ? 'active' : ''} onClick={() => setFilter('divergent')}>Divergentes</button>
          <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Com REAL final</button>
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos</button>
        </div>
        <label className="final-model-plan-search">
          <span className="sr-only">Buscar modelo</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar modelo" />
        </label>
      </div>

      <div className="final-model-plan-table-wrap">
        <table className="final-model-plan-table">
          <thead>
            <tr className="final-model-plan-group-head">
              <th rowSpan="2">Modelo</th>
              <th colSpan="2" className="orion-group">CENÁRIO ORION</th>
              <th colSpan="2" className="final-group">DPP FINAL</th>
              <th colSpan="2" className="difference-group">DIFERENÇA · FINAL − ORION</th>
              <th rowSpan="2">Resultado</th>
            </tr>
            <tr>
              <th className="orion-group">KIT disponível PGD</th>
              <th className="orion-group">REAL gerado</th>
              <th className="final-group">KIT disponível PGD</th>
              <th className="final-group">REAL consolidado</th>
              <th className="difference-group">Δ KIT PGD</th>
              <th className="difference-group">Δ REAL</th>
            </tr>
          </thead>
          <tbody>
            {pagedModels.map((model) => {
              const state = rowState(model)
              const expanded = selectedKey === model.key
              return (
                <Fragment key={model.key}>
                  <tr className={model.divergent ? 'divergent' : 'equal'}>
                    <td><strong>{model.name}</strong></td>
                    <td className="number-cell orion-value">{model.orionPresent ? formatNumber(model.orionPgd) : '—'}</td>
                    <td className="number-cell orion-value">{model.orionPresent ? formatNumber(model.orionReal) : '—'}</td>
                    <td className="number-cell final-value">{model.finalPresent ? formatNumber(model.finalPgd) : '—'}</td>
                    <td className="number-cell final-value">{model.finalPresent ? formatNumber(model.finalReal) : '—'}</td>
                    <td className={`number-cell delta-value ${model.pgdDivergent ? 'changed' : 'neutral'}`}>{model.pgdDelta === null ? '—' : formatDelta(model.pgdDelta)}</td>
                    <td className={`number-cell delta-value ${model.realDivergent ? 'changed' : 'neutral'}`}>{model.realDelta === null ? '—' : formatDelta(model.realDelta)}</td>
                    <td>
                      {model.divergent ? (
                        <button
                          type="button"
                          className="final-model-comparison-action"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Ocultar' : 'Ver'} detalhes da divergência do modelo ${model.name}`}
                          onClick={() => toggleDetails(model)}
                        >
                          <span className={`final-model-comparison-status ${state.tone}`}>{state.label}</span>
                          <small>{expanded ? 'Ocultar detalhes' : 'Ver detalhes'}</small>
                        </button>
                      ) : (
                        <span className={`final-model-comparison-status ${state.tone}`}>{state.label}</span>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="final-model-detail-row">
                      <td colSpan="8">
                        <ModelDivergenceDetail model={model} mapping={mappingFor(model)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {!visibleModels.length && <div className="final-model-plan-empty">Nenhum modelo encontrado para este filtro.</div>}
      </div>

      {visibleModels.length > 0 && (
        <div className="final-model-plan-pagination" aria-label="Paginação do plano consolidado por modelo">
          <span>
            Mostrando {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visibleModels.length)} de {formatNumber(visibleModels.length)} modelos · máximo de {PAGE_SIZE} linhas por página
          </span>
          <div>
            <button type="button" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(current - 1, 0))}>Anterior</button>
            <span>Página {safePage + 1} de {pageCount}</span>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}>Próxima</button>
          </div>
        </div>
      )}

      <div className="final-model-plan-footnote">
        <span><strong>Cenário ORION</strong> = KIT disponível PGD mapeado pelo motor Python e REAL atual do cenário.</span>
        <span><strong>DPP Final</strong> = KIT disponível PGD e REAL lidos diretamente do arquivo consolidado.</span>
        <span><strong>Diferença</strong> = DPP Final − Cenário ORION.</span>
      </div>
    </section>
  )
}

export default FinalModelPlan
