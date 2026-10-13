import { useState } from 'react'

const options = {
  decision: 'AVAILABLE',
  accounting: 'UNKNOWN',
  quantity: '',
}

function StockDepotReviewForm({ scenario, stockFile, candidate, material, onSaved, onCancel, apiUrl = '' }) {
  const previous = candidate.validation
  const [values, setValues] = useState(previous ? {
    decision: previous.decision,
    accounting: previous.accounting,
    quantity: previous.decision === 'AVAILABLE' ? String(previous.confirmed_quantity) : '',
  } : options)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(key, value) {
    setValues((old) => ({ ...old, [key]: value }))
  }

  async function save(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)
    form.append('candidate_id', candidate.candidate_id)
    form.append('decision', values.decision)
    form.append('accounting', values.decision === 'UNAVAILABLE' ? 'UNKNOWN' : values.accounting)
    form.append('confirmed_quantity', values.decision === 'UNAVAILABLE' ? '0' : values.quantity)
    try {
      const response = await fetch(apiUrl + '/api/dpp/investigations/stock-divergence/review', {
        method: 'POST',
        body: form,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível registrar a confirmação.')
      onSaved(payload)
    } catch (failure) {
      setError(failure.message || 'Não foi possível salvar a confirmação.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="orion-stock-review-form" onSubmit={save}>
      <div className="orion-stock-review-heading">
        <strong>Validação: PN {material.material} · {candidate.depot} · centro {candidate.center || '—'}</strong>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
      <p>Registro manual de validação, sem alteração no estoque oficial do DPP.</p>
      <div className="orion-stock-review-fields">
        <label>Resultado
          <select value={values.decision} onChange={(e) => update('decision', e.target.value)} disabled={saving}>
            <option value="AVAILABLE">Localizado e disponível</option>
            <option value="UNAVAILABLE">Indisponível / baixa</option>
          </select>
        </label>
        {values.decision === 'AVAILABLE' && (
          <>
            <label>Quantidade disponível (máx. {candidate.quantity} {candidate.unit})
              <input required type="number" min="0" max={candidate.quantity} step="any" value={values.quantity}
                onChange={(e) => update('quantity', e.target.value)} disabled={saving} />
            </label>
            <label>Quantidade já contabilizada no DPP?
              <select value={values.accounting} onChange={(e) => update('accounting', e.target.value)} disabled={saving}>
                <option value="UNKNOWN">Não foi possível confirmar</option>
                <option value="INCLUDED">Sim · já contabilizada</option>
                <option value="NOT_INCLUDED">Não · fora do DPP</option>
              </select>
            </label>
          </>
        )}

      </div>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={saving}>
        {saving ? 'Salvando...' : 'Registrar confirmação'}
      </button>
      {(candidate.validation_history || []).length > 0 && (
        <details>
          <summary>Histórico de revisões ({candidate.validation_history.length})</summary>
          <ul>{candidate.validation_history.map((entry) => (
            <li key={entry.id}>
              {entry.created_at || 'Sem data'} · {entry.decision === 'AVAILABLE' ? 'Disponível' : 'Indisponível'}
              · {entry.confirmed_quantity} {candidate.unit} · {entry.accounting}.
              {entry.evidence && <div>{entry.evidence}</div>}
            </li>
          ))}</ul>
        </details>
      )}
    </form>
  )
}

export default StockDepotReviewForm
