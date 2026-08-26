import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './orion-working.css'

const STAGES = {
  generate: [
    'Identificando e validando as fontes',
    'Lendo a base histórica do DPP',
    'Atualizando WIU e materiais do mês',
    'Cruzando STK, Explosão e OPCs',
    'Extraindo KIT disponível do PGD',
    'Calculando NEC, STK TTL e SALDO',
    'Finalizando o cenário inicial',
  ],
  test: [
    'Identificando e validando as fontes',
    'Reconstruindo o mês a partir da base anterior',
    'Aplicando o REAL de referência do gabarito',
    'Comparando o cenário com o DPP final',
    'Classificando humano, legado e ORION',
    'Montando o relatório de validação',
  ],
  dashboard: [
    'Lendo o DPP final consolidado',
    'Extraindo PGD e REAL',
    'Identificando materiais críticos e OPCs',
    'Preparando a comparação Inicial × Final',
  ],
}

const TITLES = {
  generate: 'ORION está construindo o cenário inicial',
  test: 'ORION está reconstruindo e validando o DPP',
  dashboard: 'ORION está analisando o DPP final',
}

function OrionWorking({ active, mode = 'generate', compact = false }) {
  const stages = STAGES[mode] || STAGES.generate
  const [stageIndex, setStageIndex] = useState(0)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined

    setStageIndex(0)
    const timer = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, stages.length - 1))
    }, 1050)

    return () => window.clearInterval(timer)
  }, [active, mode, stages.length])

  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined

    const root = document.getElementById('root')
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const previousAriaHidden = root?.getAttribute('aria-hidden')
    const previousInert = root?.inert
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`

    if (root) {
      root.inert = true
      root.setAttribute('aria-hidden', 'true')
    }

    window.requestAnimationFrame(() => dialogRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight

      if (root) {
        root.inert = previousInert || false
        if (previousAriaHidden === null) root.removeAttribute('aria-hidden')
        else root.setAttribute('aria-hidden', previousAriaHidden)
      }
    }
  }, [active])

  if (!active || typeof document === 'undefined') return null

  return createPortal(
    <div className="orion-working-overlay" aria-hidden="false">
      <section
        className={`orion-working ${compact ? 'compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="orion-working-title"
        aria-describedby="orion-working-description"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="orion-robot-wrap" aria-hidden="true">
          <svg className="orion-robot" viewBox="0 0 180 150" role="img">
            <rect className="orion-monitor" x="76" y="36" width="78" height="54" rx="9" />
            <path className="orion-screen-line line-one" d="M90 53h44" />
            <path className="orion-screen-line line-two" d="M90 66h31" />
            <path className="orion-screen-line line-three" d="M90 79h38" />
            <path className="orion-monitor-stand" d="M115 91v16m-20 0h40" />
            <g className="orion-robot-head">
              <rect x="23" y="24" width="51" height="42" rx="15" />
              <circle cx="39" cy="45" r="4" />
              <circle cx="58" cy="45" r="4" />
              <path d="M42 57h13" />
              <path d="M48 24V14" />
              <circle cx="48" cy="11" r="3" />
            </g>
            <path className="orion-robot-body" d="M31 71h36c9 0 16 7 16 16v34H18V87c0-9 5-16 13-16Z" />
            <path className="orion-robot-arm arm-left" d="M24 85 8 105l20 8" />
            <path className="orion-robot-arm arm-right" d="m70 85 20 22 18-8" />
            <path className="orion-keyboard" d="M86 112h61l9 17H80Z" />
            <circle className="orion-status-light" cx="50" cy="88" r="4" />
          </svg>
        </div>

        <div className="orion-working-copy">
          <span className="orion-working-eyebrow">PROCESSAMENTO AUTOMÁTICO</span>
          <h3 id="orion-working-title">{TITLES[mode] || TITLES.generate}</h3>
          <p id="orion-working-description">{stages[stageIndex]}</p>
          <div className="orion-working-progress" aria-hidden="true"><span /></div>
          <div className="orion-working-stages" aria-label="Etapas do processamento">
            {stages.map((stage, index) => (
              <span className={index === stageIndex ? 'active' : ''} key={stage}>{stage}</span>
            ))}
          </div>
          <div className="orion-working-footer">
            <span>Aguarde. A interface será liberada automaticamente quando a análise terminar.</span>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default OrionWorking
