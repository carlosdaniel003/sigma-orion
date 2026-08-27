function BrandMark({ compact = false }) {
  const size = compact ? 42 : 42
  return (
    <g className="orion-brand-mark" aria-hidden="true">
      <circle className="orion-brand-ring" cx="21" cy="21" r="13.2" />
      <path className="orion-brand-orbit" d="M4.7 26.8C8.5 18.4 18.5 11.7 30 11.1c5.4-.3 8.3 1.1 8.9 3.2.7 2.6-2.5 6.1-8.5 9.2-7.2 3.8-15.6 6-21.6 5.7-3.7-.2-5.2-1.1-4.1-2.4Z" />
      <circle className="orion-brand-star orion-brand-star-blue" cx="29.8" cy="11.4" r="2.25" />
      <circle className="orion-brand-star orion-brand-star-core" cx="19.7" cy="21.8" r="2.85" />
      <circle className="orion-brand-star orion-brand-star-green" cx="7.2" cy="28" r="2.15" />
      <path className="orion-brand-constellation" d="M7.2 28 19.7 21.8 29.8 11.4" />
      <circle className="orion-brand-nucleus" cx="21" cy="21" r="3.7" />
    </g>
  )
}

function CompactMark() {
  return (
    <svg className="brand-logo brand-logo-compact" viewBox="0 0 42 42" role="img" aria-label="SIGMA-S ORION">
      <BrandMark compact />
    </svg>
  )
}

function BrandLogo() {
  return (
    <span className="brand-logo-wrap" aria-label="SIGMA-S ORION">
      <svg className="brand-logo brand-logo-full" viewBox="0 0 258 42" role="img" aria-hidden="true">
        <BrandMark />
        <g className="brand-logo-wordmark">
          <text className="brand-logo-word brand-logo-sigma" x="49" y="27.2">SIGMA-S</text>
          <g className="brand-logo-mini-mark" transform="translate(170 12) scale(.43)">
            <circle className="orion-brand-ring" cx="21" cy="21" r="13.2" />
            <path className="orion-brand-orbit" d="M4.7 26.8C8.5 18.4 18.5 11.7 30 11.1c5.4-.3 8.3 1.1 8.9 3.2.7 2.6-2.5 6.1-8.5 9.2-7.2 3.8-15.6 6-21.6 5.7-3.7-.2-5.2-1.1-4.1-2.4Z" />
            <circle className="orion-brand-star orion-brand-star-blue" cx="29.8" cy="11.4" r="2.25" />
            <circle className="orion-brand-star orion-brand-star-core" cx="19.7" cy="21.8" r="2.85" />
            <circle className="orion-brand-star orion-brand-star-green" cx="7.2" cy="28" r="2.15" />
            <path className="orion-brand-constellation" d="M7.2 28 19.7 21.8 29.8 11.4" />
          </g>
          <text className="brand-logo-word brand-logo-rion" x="194" y="27.2">RION</text>
        </g>
      </svg>
      <CompactMark />
    </span>
  )
}

export default BrandLogo
