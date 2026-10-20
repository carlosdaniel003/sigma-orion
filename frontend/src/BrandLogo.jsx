function OrionStar() {
  return (
    <path
      className="orion-brand-star-symbol"
      d="M21 3.5 24.7 17.3 38.5 21l-13.8 3.7L21 38.5l-3.7-13.8L3.5 21l13.8-3.7Z"
    />
  )
}

/** The actual ORION star, not an overlapping invisible logo/toggle surface. */
function BrandLogo({ collapsed, onToggle }) {
  const action = collapsed ? 'Expandir navegação' : 'Recolher navegação'

  return (
    <span className="brand-logo-wrap">
      <svg className="brand-logo brand-logo-full" viewBox="0 0 174 42" role="img" aria-label="SIGMA-S ORION">
        <g className="brand-logo-wordmark">
          <text className="brand-logo-word brand-logo-sigma" x="3" y="27.2">SIGMA-S</text>
          <text className="brand-logo-word brand-logo-rion" x="118" y="27.2">RION</text>
        </g>
      </svg>
      <button type="button" className="brand-star-toggle" aria-label={action}
        title={action} aria-controls="workspace-navigation" aria-expanded={!collapsed}
        onClick={onToggle}>
        <svg className="brand-logo-star" viewBox="0 0 42 42" focusable="false" aria-hidden="true">
          <OrionStar />
        </svg>
      </button>
    </span>
  )
}

export default BrandLogo
