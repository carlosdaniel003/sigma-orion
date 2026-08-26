import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import robotWorkingImage from './assets/orion-working-robot.webp'
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
          <div className="orion-robot-stage">
            <img
              className="orion-robot-image"
              src={robotWorkingImage}
              alt=""
              width="480"
              height="480"
              decoding="async"
            />

            <svg className="orion-robot-overlay" viewBox="0 0 480 480" role="presentation">
              <g className="orion-typing-hand typing-left">
                <path d="M157 263C166 253 179 247 192 247H218" />
                <path d="M214 247C223 247 230 254 230 263V275" />
                <ellipse cx="228" cy="285" rx="18" ry="11" />
                <path d="M218 286h22" />
                <path d="M221 280h17" />
              </g>

              <g className="orion-typing-hand typing-right">
                <path d="M206 272h54c13 0 24 10 27 23" />
                <path d="M283 295c8 2 13 9 13 17v10" />
                <ellipse cx="298" cy="323" rx="19" ry="12" />
                <path d="M287 323h24" />
                <path d="M290 317h18" />
              </g>

              <g className="orion-key-taps">
                <circle className="tap tap-one" cx="239" cy="311" r="3" />
                <circle className="tap tap-two" cx="258" cy="306" r="3" />
                <circle className="tap tap-three" cx="278" cy="314" r="3" />
              </g>
            </svg>
          </div>
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
