import { useEffect, useRef, useState } from 'react'
import './investigation-kpi-panel.css'

/** Five operational indicators, each opening its own complete PN cohort. */
export function InvestigationKpiGrid({ metrics, onSelect, label }) {
  return (
    <div className="orion-kpi-grid" role="group" aria-label={label}>
      {metrics.map(metric => (
        <button key={metric.key} type="button" className="orion-kpi-tile"
          aria-haspopup="dialog" onClick={() => onSelect(metric.key)}>
          <span>{metric.label}</span>
          <strong>{Number(metric.items.length).toLocaleString('pt-BR')}</strong>
          <small>Ver itens e detalhes</small>
        </button>
      ))}
    </div>
  )
}

/** Native modal: focus trap/Escape are handled by the browser, not by custom overlays. */
export function InvestigationModal({ title, items, onClose, children, modalKey }) {
  const ref = useRef(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [modalKey])

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [modalKey])

  const normalized = query.trim().toLocaleLowerCase('pt-BR')
  const visible = normalized
    ? items.filter(item => [item.material, item.description, item.active_depot,
      ...(item.candidates || []).map(candidate => candidate.depot)]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized)))
    : items

  return (
    <dialog ref={ref} className="orion-investigation-dialog"
      aria-label={title} onClose={onClose}
      onClick={event => {
        if (event.target !== ref.current) return
        const rect = ref.current.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) ref.current.close()
      }}>
      <header className="orion-investigation-dialog-heading">
        <div>
          <h3>{title}</h3>
          <p>{items.length.toLocaleString('pt-BR')} PN(s) nesta categoria. Quantidades encontradas não representam validação humana.</p>
        </div>
        <button type="button" className="secondary-button"
          onClick={() => ref.current?.close()}>Fechar</button>
      </header>
      <div className="orion-investigation-dialog-search">
        <input type="search" value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label="Filtrar PNs deste modal"
          placeholder="Filtrar por PN, descrição ou depósito" />
        <span>{visible.length.toLocaleString('pt-BR')} exibido(s)</span>
      </div>
      <div className="orion-investigation-dialog-content">
        {!visible.length && <p>Nenhum PN corresponde à pesquisa ou a categoria está vazia.</p>}
        {children(visible)}
      </div>
    </dialog>
  )
}

export function InvestigationRecord({ material, facts, candidates, renderCandidate, note, status, noRecordsMessage = 'Sem registros nos depósitos investigados; não há confirmação a realizar para este PN.' }) {
  return (
    <article className={'orion-investigation-record ' + (candidates?.length
      ? candidates.some(candidate => !candidate.validation)
        ? 'orion-investigation-record--pending' : 'orion-investigation-record--reviewed'
      : 'orion-investigation-record--unlocated')}>
      <header>
        <strong>PN {material.material}</strong>
        <span>{material.description || 'Descrição não informada'} · {material.unit || 'UM não informada'}</span>
        {candidates?.length > 0 && <small>{candidates.some(candidate => !candidate.validation)
          ? 'Validação humana pendente' : 'Validado manualmente'}</small>}
        {status && <small>{status}</small>}
      </header>
      <dl className="orion-investigation-record-facts">
        {facts.map(fact => (
          <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
        ))}
      </dl>
      {note && <p className="orion-investigation-record-note">{note}</p>}
      {candidates?.length > 0 ? <div className="orion-investigation-record-depots">
        {candidates.map(candidate => (
          <div key={candidate.candidate_id || candidate.depot} className={
            'orion-investigation-record-depot ' +
            (candidate.validation ? 'orion-investigation-record-depot--reviewed' : 'orion-investigation-record-depot--pending')
          }>
            {renderCandidate(candidate)}
          </div>
        ))}
      </div> : noRecordsMessage ? <p className="orion-investigation-record-note">{noRecordsMessage}</p> : null}
    </article>
  )
}
