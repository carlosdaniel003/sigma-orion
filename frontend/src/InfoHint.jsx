import { useId } from 'react'
import './info-hint.css'

function InfoHint({ title, what, source, purpose, align = 'left' }) {
  const tooltipId = useId()

  return (
    <span className={`info-hint info-hint-${align}`}>
      <button
        className="info-hint-trigger"
        type="button"
        aria-label={`Informações sobre ${title}`}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span className="info-hint-tooltip" id={tooltipId} role="tooltip">
        <strong>{title}</strong>
        <span className="info-hint-section">
          <b>O que mostra</b>
          <span>{what}</span>
        </span>
        <span className="info-hint-section">
          <b>Origem</b>
          <span>{source}</span>
        </span>
        <span className="info-hint-section">
          <b>Finalidade</b>
          <span>{purpose}</span>
        </span>
      </span>
    </span>
  )
}

export default InfoHint
