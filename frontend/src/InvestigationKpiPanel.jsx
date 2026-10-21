import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { acquirePageScrollLock } from './modal-scroll-lock'
import './investigation-kpi-panel.css'

/** Five operational indicators, each opening its own complete PN cohort. */
export function InvestigationKpiGrid({ metrics, onSelect, label }) {
  return (
    <div className="orion-kpi-grid" role="group" aria-label={label}>
      {metrics.map(metric => (
        <button key={metric.key} type="button" className="orion-kpi-tile"
          aria-haspopup="dialog"
          aria-label={`${metric.label}: ${metric.items.length} PN(s). Ver itens e detalhes`}
          onClick={() => onSelect(metric.key)}>
          <span>{metric.label}</span>
          <strong>{Number(metric.items.length).toLocaleString('pt-BR')}</strong>
        </button>
      ))}
    </div>
  )
}

/** Native modal: focus trap/Escape are handled by the browser, not by custom overlays. */
export function InvestigationModal({ title, items, onClose, children, modalKey, subtitle = 'Amarelo: registro pendente. Azul: validação humana registrada. Quantidade encontrada não significa liberação.' }) {
  const ref = useRef(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [modalKey])

  // StrictMode replays effect cleanup during development. Native close events
  // from that cleanup must never clear the user's selected KPI.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return undefined

    const releaseScrollLock = acquirePageScrollLock()
    try {
      if (!dialog.open) dialog.showModal()
    } catch (error) {
      releaseScrollLock()
      throw error
    }

    // The native dialog maintains the focus trap and restores focus on close.
    // StrictMode cleanup must release the page lock without changing KPI selection.
    return () => {
      if (dialog?.open) dialog.close()
      releaseScrollLock()
    }
  }, [modalKey])

  const normalized = query.trim().toLocaleLowerCase('pt-BR')
  const visible = normalized
    ? items.filter(item => [item.material, item.description, item.active_depot,
      ...(item.candidates || []).map(candidate => candidate.depot)]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalized)))
    : items

  return createPortal(
    <dialog ref={ref} className="orion-investigation-dialog"
      aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => {
        if (event.target !== ref.current) return
        const rect = ref.current.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}>
      <header className="orion-investigation-dialog-heading">
        <div>
          <h3>{title}</h3>
          <p>{items.length.toLocaleString('pt-BR')} PN(s) nesta categoria. {subtitle}</p>
        </div>
        <button type="button" className="secondary-button"
          onClick={onClose}>Fechar</button>
      </header>
      <div className="orion-investigation-dialog-search">
        <input type="search" value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label="Filtrar PNs deste modal"
          placeholder="Filtrar por PN, descrição ou depósito" />
        <span>{visible.length.toLocaleString('pt-BR')} exibido(s)</span>
      </div>
      <div className="orion-investigation-dialog-content" role="region"
        tabIndex={0} aria-label={`Lista de PNs: ${title}`}>
        {!visible.length && <p>Nenhum PN corresponde à pesquisa ou a categoria está vazia.</p>}
        {children(visible)}
      </div>
    </dialog>,
    document.body,
  )
}

export function InvestigationRecord({ material, facts, candidates, renderCandidate, note, status, children, noRecordsMessage = 'Sem registros nos depósitos investigados; não há confirmação a realizar para este PN.' }) {
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
      {children}
    </article>
  )
}
