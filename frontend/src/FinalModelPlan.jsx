import { useMemo, useState } from 'react'
import './final-model-plan.css'

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value) {
  return number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

function formatDelta(value) {
  const delta = number(value)
  if (Math.abs(delta) < 1e-9) return '0'
  return `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))}`
}

function modelState(model) {
  const pgd = number(model.pgd)
  const real = number(model.real)
  const delta = number(model.delta)

  if (pgd <= 0 && real <= 0) return { label: 'Sem produção', tone: 'neutral' }
  if (Math.abs(delta) < 1e-9) return { label: 'Mantido', tone: 'stable' }
  if (delta < 0) return { label: real <= 0 ? 'Zerado no final' : 'Reduzido', tone: 'reduced' }
  return { label: 'Acima do PGD', tone: 'increased' }
}

function FinalModelPlan({ finalDppAnalysis }) {
  const models = finalDppAnalysis?.models || []
  const summary = finalDppAnalysis?.summary || {}
  const [filter, setFilter] = useState('changed')
  const [query, setQuery] = useState('')

  const insights = useMemo(() => {
    const changed = models.filter((model) => Math.abs(number(model.delta)) > 1e-9)
    const reduced = changed.filter((model) => number(model.delta) < 0)
    const increased = changed.filter((model) => number(model.delta) > 0)
    const largestReduction = [...reduced].sort((left, right) => number(left.delta) - number(right.delta))[0] || null
    const largestIncrease = [...increased].sort((left, right) => number(right.delta) - number(left.delta))[0] || null

    return {
      changed: changed.length,
      reduced: reduced.length,
      increased: increased.length,
      largestReduction,
      largestIncrease,
    }
  }, [models])

  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')

    return [...models]
      .filter((model) => {
        if (filter === 'changed' && !model.changed) return false
        if (filter === 'active' && !model.active) return false
        if (normalizedQuery && !String(model.name || '').toLocaleLowerCase('pt-BR').includes(normalizedQuery)) return false
        return true
      })
      .sort((left, right) => {
        const leftChanged = left.changed ? 1 : 0
        const rightChanged = right.changed ? 1 : 0
        if (leftChanged !== rightChanged) return rightChanged - leftChanged
        const deltaDifference = Math.abs(number(right.delta)) - Math.abs(number(left.delta))
        if (Math.abs(deltaDifference) > 1e-9) return deltaDifference
        return String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')
      })
  }, [models, filter, query])

  if (!finalDppAnalysis || !models.length) return null

  return (
    <section className="final-model-plan" aria-label="Plano consolidado por modelo do DPP final">
      <div className="final-model-plan-heading">
        <div>
          <span className="final-model-plan-eyebrow">DPP FINAL CONSOLIDADO</span>
          <h3>Plano consolidado por modelo</h3>
          <p>Mostra, modelo a modelo, quanto o PGD disponibilizou e qual REAL permaneceu no DPP depois da análise do analista.</p>
        </div>
        <div className="final-model-plan-source">
          <span>Fonte</span>
          <strong>{finalDppAnalysis.filename || 'DPP final'}</strong>
        </div>
      </div>

      <div className="final-model-plan-insights">
        <article>
          <span>Modelos no DPP</span>
          <strong>{formatNumber(summary.model_count ?? models.length)}</strong>
          <small>{formatNumber(summary.active_models)} com REAL ativo</small>
        </article>
        <article className="attention">
          <span>Ajustados pelo analista</span>
          <strong>{formatNumber(insights.changed)}</strong>
          <small>{formatNumber(insights.reduced)} reduzidos · {formatNumber(insights.increased)} aumentados</small>
        </article>
        <article className="reduced">
          <span>Maior redução</span>
          <strong>{insights.largestReduction ? formatDelta(insights.largestReduction.delta) : '—'}</strong>
          <small>{insights.largestReduction?.name || 'Nenhuma redução'}</small>
        </article>
        <article className="increased">
          <span>Maior aumento</span>
          <strong>{insights.largestIncrease ? formatDelta(insights.largestIncrease.delta) : '—'}</strong>
          <small>{insights.largestIncrease?.name || 'Nenhum aumento'}</small>
        </article>
      </div>

      <div className="final-model-plan-toolbar">
        <div className="final-model-plan-filters" role="group" aria-label="Filtrar modelos">
          <button type="button" className={filter === 'changed' ? 'active' : ''} onClick={() => setFilter('changed')}>Ajustados</button>
          <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>Com REAL</button>
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
            <tr>
              <th>Modelo</th>
              <th>KIT disponível PGD</th>
              <th>REAL final</th>
              <th>Ajuste REAL − PGD</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {visibleModels.map((model) => {
              const state = modelState(model)
              const delta = number(model.delta)
              return (
                <tr key={model.name} className={model.changed ? 'changed' : ''}>
                  <td><strong>{model.name}</strong></td>
                  <td className="number-cell">{formatNumber(model.pgd)}</td>
                  <td className="number-cell real-value">{formatNumber(model.real)}</td>
                  <td className={`number-cell delta-value ${delta < 0 ? 'negative' : delta > 0 ? 'positive' : 'neutral'}`}>{formatDelta(delta)}</td>
                  <td><span className={`final-model-status ${state.tone}`}>{state.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visibleModels.length && <div className="final-model-plan-empty">Nenhum modelo encontrado para este filtro.</div>}
      </div>

      <div className="final-model-plan-footnote">
        <span><strong>KIT disponível PGD</strong> = referência recebida do PGD.</span>
        <span><strong>REAL final</strong> = quantidade consolidada após a análise humana.</span>
        <span><strong>Ajuste</strong> = REAL final − KIT disponível PGD.</span>
      </div>
    </section>
  )
}

export default FinalModelPlan
