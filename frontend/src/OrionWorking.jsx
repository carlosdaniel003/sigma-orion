import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './orion-working.css'
import './orion-working-timing.css'

const STAGES = {
  generate: [
    'Identificando e validando as fontes',
    'Lendo a base histórica do DPP',
    'Atualizando WIU e materiais do mês',
    'Cruzando STK, Explosão e OPCs',
    'Extraindo KIT disponível do PGD',
    'Calculando NEC, STK TTL e SALDO',
    'Consolidando o cenário e preparando o Dashboard',
  ],
  test: [
    'Identificando e validando as fontes',
    'Reconstruindo o mês a partir da base anterior',
    'Aplicando o REAL de referência do gabarito',
    'Comparando o cenário com o DPP final',
    'Classificando humano, legado e ORION',
    'Consolidando o relatório de validação',
  ],
  dashboard: [
    'Lendo o DPP final consolidado',
    'Extraindo PGD e REAL',
    'Calculando os indicadores do DPP final',
    'Preparando a comparação Inicial × Final',
  ],
}

const TITLES = {
  generate: 'Construindo o cenário inicial',
  test: 'Reconstruindo e validando o DPP',
  dashboard: 'Analisando o DPP final',
}

const CONSTELLATION_NODES = [
  { x: 38, y: 126, start: 0 },
  { x: 92, y: 54, start: 10 },
  { x: 157, y: 88, start: 31 },
  { x: 214, y: 38, start: 60 },
  { x: 300, y: 88, start: 72 },
  { x: 252, y: 160, start: 88 },
  { x: 142, y: 174, start: 97 },
]

function getMeasuredNodeIndex(progress) {
  let index = 0
  CONSTELLATION_NODES.forEach((node, nodeIndex) => {
    if (progress >= node.start) index = nodeIndex
  })
  return index
}

function OrionConstellation({ measured, progress, stageIndex }) {
  const activeIndex = measured
    ? getMeasuredNodeIndex(progress)
    : Math.min(stageIndex, CONSTELLATION_NODES.length - 1)

  function nodeState(index) {
    if (measured && progress >= 100) return 'done'
    if (index < activeIndex) return 'done'
    if (index === activeIndex) return 'active'
    return 'future'
  }

  function segmentState(index) {
    if (measured && progress >= 100) return 'done'
    if (index < activeIndex) return 'done'
    if (index === activeIndex) return 'active'
    return 'future'
  }

  return (
    <div className="orion-constellation" aria-hidden="true">
      <svg viewBox="0 0 340 214" role="presentation">
        <g className="orion-constellation-structure">
          <line x1="38" y1="126" x2="176" y2="116" />
          <line x1="157" y1="88" x2="176" y2="116" />
          <line x1="214" y1="38" x2="176" y2="116" />
          <line x1="300" y1="88" x2="176" y2="116" />
          <line x1="252" y1="160" x2="176" y2="116" />
          <line x1="142" y1="174" x2="176" y2="116" />
        </g>

        <g className="orion-constellation-path">
          {CONSTELLATION_NODES.slice(0, -1).map((node, index) => {
            const next = CONSTELLATION_NODES[index + 1]
            return (
              <line
                key={`segment-${index}`}
                className={`orion-constellation-segment ${segmentState(index)}`}
                x1={node.x}
                y1={node.y}
                x2={next.x}
                y2={next.y}
              />
            )
          })}
        </g>

        <g className="orion-constellation-core">
          <circle className="orion-core-aura" cx="176" cy="116" r="27" />
          <circle className="orion-core-disc" cx="176" cy="116" r="18" />
          <path className="orion-core-mark" d="M168 116h16M176 108v16" />
          <circle className="orion-core-point" cx="176" cy="116" r="3.5" />
        </g>

        <g className="orion-constellation-nodes">
          {CONSTELLATION_NODES.map((node, index) => {
            const state = nodeState(index)
            return (
              <g key={`node-${index}`} className={`orion-constellation-node ${state}`}>
                <circle className="node-halo" cx={node.x} cy={node.y} r="10" />
                <circle className="node-dot" cx={node.x} cy={node.y} r="4.5" />
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function OrionWorking({ active, mode = 'generate', compact = false, progress = null, activity = '' }) {
  const stages = STAGES[mode] || STAGES.generate
  const [stageIndex, setStageIndex] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const dialogRef = useRef(null)
  const blocking = mode !== 'dashboard'
  const numericProgress = Number(progress)
  const measured = progress !== null && progress !== undefined && Number.isFinite(numericProgress)
  const progressValue = measured ? Math.min(Math.max(numericProgress, 0), 100) : null

  useEffect(() => {
    if (!active) return undefined

    setStageIndex(0)
    setElapsedSeconds(0)

    const elapsedTimer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1)
    }, 1000)

    let stageTimer = null
    if (!measured) {
      stageTimer = window.setInterval(() => {
        setStageIndex((current) => Math.min(current + 1, stages.length - 1))
      }, 2200)
    }

    return () => {
      if (stageTimer) window.clearInterval(stageTimer)
      window.clearInterval(elapsedTimer)
    }
  }, [active, mode, stages.length, measured])

  useEffect(() => {
    if (!active || !blocking || typeof document === 'undefined') return undefined

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
  }, [active, blocking])

  if (!active || typeof document === 'undefined') return null

  const currentActivity = activity || stages[stageIndex]

  if (!blocking) {
    return (
      <div className="orion-inline-working" role="status" aria-live="polite">
        <span className="orion-working-status-dot" aria-hidden="true" />
        <div>
          <strong>{TITLES[mode]}</strong>
          <small>{currentActivity} · {elapsedSeconds}s</small>
        </div>
      </div>
    )
  }

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
          <span>ORION</span>
          <small>ANALISANDO DADOS</small>
        </div>

        <OrionConstellation
          measured={measured}
          progress={progressValue ?? 0}
          stageIndex={stageIndex}
        />

        <div className="orion-working-copy">
          <h3 id="orion-working-title">{TITLES[mode] || TITLES.generate}</h3>
          <p className="orion-working-subtitle">
            Analisando, conectando e consolidando dados reais para montar o cenário operacional.
          </p>

          <div className="orion-current-stage" id="orion-working-description">
            <div>
              <small className="orion-stage-label">{measured ? 'ETAPA REAL DO PROCESSAMENTO' : 'ATIVIDADE EM ANDAMENTO'}</small>
              <span>{currentActivity}</span>
            </div>
            <div className="orion-stage-measures">
              {measured && <strong className="orion-progress-percent">{Math.round(progressValue)}%</strong>}
              <small className="orion-elapsed-time">{elapsedSeconds}s</small>
            </div>
          </div>

          <div
            className={`orion-working-progress ${measured ? 'measured' : ''}`}
            aria-label={measured ? `Processamento ${Math.round(progressValue)}% concluído` : 'Processamento em andamento'}
            role="progressbar"
            {...(measured ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progressValue) } : {})}
          >
            <span style={measured ? { width: `${progressValue}%` } : undefined} />
          </div>

          <div className="orion-working-footer">
            {measured
              ? 'A constelação e a barra avançam somente quando o backend registra um checkpoint real.'
              : 'O tempo varia conforme o tamanho e a complexidade das planilhas.'}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default OrionWorking
