import { useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import './final-model-plan.css'

const NUMERIC_TOLERANCE = 1e-4

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
  return number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
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

function FinalModelPlan({ finalDppAnalysis }) {
  const { generatedScenario } = useDppWorkspace()
  const finalModels = finalDppAnalysis?.models || []
  const orionModels = generatedScenario?.models || []
  const [filter, setFilter] = useState('divergent')
  const [query, setQuery] = useState('')

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

  if (!finalDppAnalysis || !finalModels.length) return null

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
            {visibleModels.map((model) => {
              const state = rowState(model)
              return (
                <tr key={model.key} className={model.divergent ? 'divergent' : 'equal'}>
                  <td><strong>{model.name}</strong></td>
                  <td className="number-cell orion-value">{model.orionPresent ? formatNumber(model.orionPgd) : '—'}</td>
                  <td className="number-cell orion-value">{model.orionPresent ? formatNumber(model.orionReal) : '—'}</td>
                  <td className="number-cell final-value">{model.finalPresent ? formatNumber(model.finalPgd) : '—'}</td>
                  <td className="number-cell final-value">{model.finalPresent ? formatNumber(model.finalReal) : '—'}</td>
                  <td className={`number-cell delta-value ${model.pgdDivergent ? 'changed' : 'neutral'}`}>{model.pgdDelta === null ? '—' : formatDelta(model.pgdDelta)}</td>
                  <td className={`number-cell delta-value ${model.realDivergent ? 'changed' : 'neutral'}`}>{model.realDelta === null ? '—' : formatDelta(model.realDelta)}</td>
                  <td><span className={`final-model-comparison-status ${state.tone}`}>{state.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visibleModels.length && <div className="final-model-plan-empty">Nenhum modelo encontrado para este filtro.</div>}
      </div>

      <div className="final-model-plan-footnote">
        <span><strong>Cenário ORION</strong> = KIT disponível PGD e REAL calculados pelo motor Python.</span>
        <span><strong>DPP Final</strong> = KIT disponível PGD e REAL lidos diretamente do arquivo consolidado.</span>
        <span><strong>Diferença</strong> = DPP Final − Cenário ORION.</span>
      </div>
    </section>
  )
}

export default FinalModelPlan
