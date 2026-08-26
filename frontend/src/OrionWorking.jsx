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
  generate: 'Construindo o cenário inicial',
  test: 'Reconstruindo e validando o DPP',
  dashboard: 'Analisando o DPP final',
}

function OrionAgentVisual() {
  return (
    <div className="orion-agent-visual" aria-hidden="true">
      <svg className="orion-agent-core" viewBox="0 0 220 220" role="presentation">
        <defs>
          <radialGradient id="orion-core-fill" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="72%" stopColor="#f4f5f6" />
            <stop offset="100%" stopColor="#e8eaec" />
          </radialGradient>
          <linearGradient id="orion-accent" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#27f29a" />
            <stop offset="100%" stopColor="#46d9ff" />
          </linearGradient>
        </defs>

        <circle className="orion-agent-halo halo-outer" cx="110" cy="110" r="88" />
        <circle className="orion-agent-halo halo-inner" cx="110" cy="110" r="67" />

        <g className="orion-agent-orbit orbit-one">
          <circle className="orion-agent-orbit-line" cx="110" cy="110" r="80" />
          <circle className="orion-agent-node accent" cx="110" cy="30" r="5" />
          <circle className="orion-agent-node" cx="179" cy="150" r="3.5" />
        </g>

        <g className="orion-agent-orbit orbit-two">
          <circle className="orion-agent-orbit-line secondary" cx="110" cy="110" r="59" />
          <circle className="orion-agent-node" cx="51" cy="110" r="4" />
          <circle className="orion-agent-node accent" cx="145" cy="158" r="3.5" />
        </g>

        <g className="orion-agent-center">
          <circle className="orion-agent-core-shadow" cx="110" cy="110" r="43" />
          <circle className="orion-agent-core-surface" cx="110" cy="110" r="39" fill="url(#orion-core-fill)" />
          <circle className="orion-agent-core-ring" cx="110" cy="110" r="31" />
          <path className="orion-agent-wave" d="M88 112c7-17 14 17 22 0s15 17 23 0" />
          <circle className="orion-agent-spark" cx="110" cy="110" r="4.5" fill="url(#orion-accent)" />
        </g>
      </svg>
      <span className="orion-agent-glow" />
    </div>
  )
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
    }, 1200)

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
        <div className="orion-working-status">
          <span className="orion-working-status-dot" />
          <span>AGENTE ORION</span>
          <small>PROCESSANDO</small>
        </div>

        <OrionAgentVisual />

        <div className="orion-working-copy">
          <h3 id="orion-working-title">{TITLES[mode] || TITLES.generate}</h3>
          <p className="orion-working-subtitle">O ORION está cruzando e validando os dados do processo.</p>

          <div className="orion-current-stage" id="orion-working-description">
            <span>{stages[stageIndex]}</span>
            <small>Etapa {stageIndex + 1} de {stages.length}</small>
          </div>

          <div className="orion-working-progress" aria-hidden="true"><span /></div>

          <div className="orion-stage-dots" aria-hidden="true">
            {stages.map((stage, index) => (
              <span className={index <= stageIndex ? 'done' : ''} key={stage} />
            ))}
          </div>

          <div className="orion-working-footer">
            Aguarde. A interface será liberada automaticamente quando a análise terminar.
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default OrionWorking
