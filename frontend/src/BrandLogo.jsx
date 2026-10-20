function OrionStar() {
  return (
    <path
      className="orion-brand-star-symbol"
      d="M21 3.5 24.7 17.3 38.5 21l-13.8 3.7L21 38.5l-3.7-13.8L3.5 21l13.8-3.7Z"
    />
  )
}

/** Expanded: the whole wordmark toggles. Collapsed: only the star is visible. */
function BrandLogo({ collapsed, onToggle }) {
  const action = collapsed ? 'Expandir navegação' : 'Recolher navegação'

  return (
    <button type="button" className="brand-logo-wrap brand-wordmark-toggle"
      aria-label={action} title={action}
      aria-controls="workspace-navigation" aria-expanded={!collapsed}
      onClick={onToggle}>
      <svg className="brand-logo brand-logo-full" viewBox="0 0 174 42"
        aria-hidden="true" focusable="false">
        <g className="brand-logo-wordmark">
          <text className="brand-logo-word brand-logo-sigma" x="3" y="27.2">SIGMA-S</text>
          <text className="brand-logo-word brand-logo-rion" x="118" y="27.2">RION</text>
        </g>
      </svg>
      <svg className="brand-logo-star" viewBox="0 0 42 42"
        aria-hidden="true" focusable="false">
        <OrionStar />
      </svg>
    </button>
  )
}

export default BrandLogo
