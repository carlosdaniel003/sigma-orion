function OrionStar() {
  return (
    <path
      className="orion-brand-star-symbol"
      d="M21 3.5 24.7 17.3 38.5 21l-13.8 3.7L21 38.5l-3.7-13.8L3.5 21l13.8-3.7Z"
    />
  )
}

function CompactMark() {
  return (
    <svg className="brand-logo brand-logo-compact" viewBox="0 0 42 42" role="img" aria-label="SIGMA-S ORION">
      <OrionStar />
    </svg>
  )
}

function BrandLogo() {
  return (
    <span className="brand-logo-wrap" aria-label="SIGMA-S ORION">
      <svg className="brand-logo brand-logo-full" viewBox="0 0 174 42" role="img" aria-hidden="true">
        <g className="brand-logo-wordmark">
          <text className="brand-logo-word brand-logo-sigma" x="3" y="27.2">SIGMA-S</text>
          <g className="brand-logo-orion-star" transform="translate(92 10) scale(.52)">
            <OrionStar />
          </g>
          <text className="brand-logo-word brand-logo-rion" x="118" y="27.2">RION</text>
        </g>
      </svg>
      <CompactMark />
    </span>
  )
}

export default BrandLogo
