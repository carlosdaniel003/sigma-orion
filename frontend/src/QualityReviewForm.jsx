import { useState } from 'react'

function QualityReviewForm({ scenario, stockFile, material, candidate, onSaved, onCancel, apiUrl = '' }) {
  const previous = candidate.validation
  const [values, setValues] = useState(previous ? {
    decision: previous.decision,
    accounting: previous.accounting,
    quantity: previous.confirmed_quantity > 0 ? String(previous.confirmed_quantity) : '',
    justification: previous.justification || '',
  } : {
    decision: candidate.depot === 'Q239' ? 'RELEASED' : 'SCRAP_CONFIRMED',
    accounting: 'UNKNOWN',
    quantity: '',
    justification: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const needsQuantity = values.decision !== 'NO_EVIDENCE'
  const needsJustification = values.decision === 'REJECTED' || values.decision === 'SCRAP_CONFIRMED'
  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
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
    form.append('accounting', values.decision === 'RELEASED' ? values.accounting : 'UNKNOWN')
    form.append('confirmed_quantity', needsQuantity ? values.quantity : '0')
    form.append('justification', values.justification)

    try {
      const response = await fetch(apiUrl + '/api/dpp/investigations/quality/review', {
        method: 'POST', body: form,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível salvar a validação da Qualidade.')
      onSaved(payload)
    } catch (failure) {
      setError(failure.message || 'Falha na validação de Qualidade.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="orion-stock-review-form" onSubmit={save}>
      <div className="orion-stock-review-heading">
        <strong>Validar PN {material.material} · {candidate.depot} · centro {candidate.center || '—'}</strong>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
      <p>O registro em depósito é evidência, não liberação automática. Confirme a decisão do CQ antes de informar a quantidade.</p>
      <div className="orion-stock-review-fields">
        <label>Decisão da Qualidade
          <select value={values.decision} onChange={(event) => update('decision', event.target.value)} disabled={saving}>
            {candidate.depot === 'Q239' ? (
              <>
                <option value="RELEASED">Material liberado pelo CQ</option>
                <option value="REJECTED">Material reprovado pelo CQ</option>
              </>
            ) : <option value="SCRAP_CONFIRMED">Refugo comprovado em Q273</option>}
            <option value="NO_EVIDENCE">Sem confirmação / não encontrado</option>
          </select>
        </label>
        {needsQuantity && (
          <label>Quantidade confirmada ({candidate.unit}; máximo {candidate.quantity})
            <input required type="number" min="0.000001" max={candidate.quantity} step="any"
              value={values.quantity} onChange={(event) => update('quantity', event.target.value)} disabled={saving} />
          </label>
        )}
        {values.decision === 'RELEASED' && (
          <label>Quantidade já contabilizada no DPP?
            <select value={values.accounting} onChange={(event) => update('accounting', event.target.value)} disabled={saving}>
              <option value="UNKNOWN">Não foi possível confirmar</option>
              <option value="INCLUDED">Sim · já contabilizada</option>
              <option value="NOT_INCLUDED">Não · adicional ao DPP</option>
            </select>
          </label>
        )}
      </div>
      <label className="orion-stock-review-justification">
        {needsJustification ? 'Justificativa da reprovação/refugo (obrigatória)' : 'Justificativa (opcional)'}
        <textarea rows={3} maxLength={4000} required={needsJustification}
          value={values.justification} onChange={(event) => update('justification', event.target.value)}
          placeholder="Descreva o que foi confirmado com o CQ e a quantidade envolvida." disabled={saving} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={saving}>
        {saving ? 'Registrando...' : 'Registrar validação da Qualidade'}
      </button>
      {(candidate.validation_history || []).length > 0 && (
        <details>
          <summary>Histórico de revisões ({candidate.validation_history.length})</summary>
          <ul>
            {candidate.validation_history.map((entry) => (
              <li key={entry.id}>
                {entry.created_at || 'Sem data'} · {entry.decision} · {entry.confirmed_quantity} {candidate.unit}
                {entry.accounting !== 'UNKNOWN' ? ' · ' + entry.accounting : ''}
                {entry.justification && <div>Justificativa: {entry.justification}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  )
}

export default QualityReviewForm
