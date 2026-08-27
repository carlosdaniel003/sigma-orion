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

// Geometria simplificada da constelação de Órion:
// cabeça, ombros, Três Marias e dois pés principais.
const CONSTELLATION_NODES = [
  { id: 'meissa', x: 170, y: 20, start: 0 },
  { id: 'betelgeuse', x: 103, y: 61, start: 10 },
  { id: 'bellatrix', x: 235, y: 62, start: 31 },
  { id: 'mintaka', x: 132, y: 104, start: 42 },
  { id: 'alnilam', x: 170, y: 111, start: 60 },
  { id: 'alnitak', x: 210, y: 118, start: 72 },
  { id: 'saiph', x: 103, y: 193, start: 88 },
  { id: 'rigel', x: 246, y: 188, start: 97 },
]

const CONSTELLATION_EDGES = [
  { from: 'meissa', to: 'betelgeuse', start: 10 },
  { from: 'meissa', to: 'bellatrix', start: 31 },
  { from: 'betelgeuse', to: 'mintaka', start: 42 },
  { from: 'mintaka', to: 'alnilam', start: 60 },
  { from: 'alnilam', to: 'alnitak', start: 72 },
  { from: 'bellatrix', to: 'alnitak', start: 72 },
  { from: 'mintaka', to: 'saiph', start: 88 },
  { from: 'alnitak', to: 'rigel', start: 97 },
]

const COMPLETION_HOLD_MS = 620
const CONSTELLATION_CLOSE_MS = 460
const PANEL_CLOSE_MS = 240

function getMeasuredNodeIndex(progress) {
  let index = 0
  CONSTELLATION_NODES.forEach((node, nodeIndex) => {
    if (progress >= node.start) index = nodeIndex
  })
  return index
}

function OrionConstellation({ measured, progress, stageIndex, complete = false }) {
  const activeIndex = measured
    ? getMeasuredNodeIndex(progress)
    : Math.min(stageIndex, CONSTELLATION_NODES.length - 1)

  const nodesById = Object.fromEntries(CONSTELLATION_NODES.map((node) => [node.id, node]))

  function nodeState(index) {
    if (complete || (measured && progress >= 100)) return 'done'
    if (index < activeIndex) return 'done'
    if (index === activeIndex) return 'active'
    return 'future'
  }

  function edgeState(edge) {
    if (complete || (measured && progress >= 100)) return 'done'
    if (measured) {
      if (progress > edge.start) return 'done'
      if (progress >= edge.start - 1) return 'active'
      return 'future'
    }

    const targetIndex = CONSTELLATION_NODES.findIndex((node) => node.id === edge.to)
    if (targetIndex < activeIndex) return 'done'
    if (targetIndex === activeIndex) return 'active'
    return 'future'
  }

  return (
    <div className="orion-constellation" aria-hidden="true">
      <svg viewBox="0 0 340 218" role="presentation">
        <g className="orion-constellation-structure">
          {CONSTELLATION_EDGES.map((edge) => {
            const from = nodesById[edge.from]
            const to = nodesById[edge.to]
            return <line key={`structure-${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          })}
        </g>

        <g className="orion-constellation-path">
          {CONSTELLATION_EDGES.map((edge) => {
            const from = nodesById[edge.from]
            const to = nodesById[edge.to]
            return (
              <line
                key={`${edge.from}-${edge.to}`}
                className={`orion-constellation-segment ${edgeState(edge)}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            )
          })}
        </g>

        <g className="orion-constellation-nodes">
          {CONSTELLATION_NODES.map((node, index) => {
            const state = nodeState(index)
            return (
              <g key={node.id} className={`orion-constellation-node ${state}`}>
                <circle className="node-halo" cx={node.x} cy={node.y} r="9" />
                <circle className="node-dot" cx={node.x} cy={node.y} r={node.id === 'alnilam' ? 4.8 : 4.2} />
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
  const [visible, setVisible] = useState(active)
  const [exitPhase, setExitPhase] = useState('running')
  const dialogRef = useRef(null)
  const completionTimersRef = useRef([])
  const wasActiveRef = useRef(active)
  const blocking = mode !== 'dashboard'
  const numericProgress = Number(progress)
  const measured = progress !== null && progress !== undefined && Number.isFinite(numericProgress)
  const progressValue = measured ? Math.min(Math.max(numericProgress, 0), 100) : null

  useEffect(() => {
    completionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    completionTimersRef.current = []

    if (active) {
      wasActiveRef.current = true
      setVisible(true)
      setExitPhase('running')
      return undefined
    }

    if (!wasActiveRef.current) {
      if (!blocking) setVisible(false)
      return undefined
    }

    wasActiveRef.current = false

    if (!blocking) {
      setVisible(false)
      return undefined
    }

    setVisible(true)
    setExitPhase('complete')

    const constellationTimer = window.setTimeout(() => {
      setExitPhase('constellation-closing')
    }, COMPLETION_HOLD_MS)

    const panelTimer = window.setTimeout(() => {
      setExitPhase('panel-closing')
    }, COMPLETION_HOLD_MS + CONSTELLATION_CLOSE_MS)

    const hideTimer = window.setTimeout(() => {
      setVisible(false)
      setExitPhase('running')
    }, COMPLETION_HOLD_MS + CONSTELLATION_CLOSE_MS + PANEL_CLOSE_MS)

    completionTimersRef.current = [constellationTimer, panelTimer, hideTimer]

    return () => {
      completionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      completionTimersRef.current = []
    }
  }, [active, blocking])

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
    if (!visible || !blocking || typeof document === 'undefined') return undefined

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
  }, [visible, blocking])

  if (!visible || typeof document === 'undefined') return null

  const finishing = exitPhase !== 'running'
  const displayedProgress = finishing && measured ? 100 : progressValue
  const currentActivity = finishing ? 'Concluído' : (activity || stages[stageIndex])

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
    <div className={`orion-working-overlay ${exitPhase === 'panel-closing' ? 'closing' : ''}`} aria-hidden="false">
      <section
        className={`orion-working ${compact ? 'compact' : ''} ${exitPhase}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="orion-working-title"
        aria-describedby="orion-working-description"
        tabIndex={-1}
        ref={dialogRef}
      >
        <OrionConstellation
          measured={measured}
          progress={displayedProgress ?? 0}
          stageIndex={stageIndex}
          complete={finishing}
        />

        <div className="orion-working-copy">
          <h3 id="orion-working-title">{finishing ? 'Processamento concluído' : (TITLES[mode] || TITLES.generate)}</h3>
          <p className="orion-working-subtitle">
            {finishing
              ? 'Cenário consolidado. A constelação de Órion está completa.'
              : 'Analisando, conectando e consolidando dados reais para montar o cenário operacional.'}
          </p>

          <div className="orion-current-stage" id="orion-working-description">
            <div>
              <small className="orion-stage-label">{measured ? 'ETAPA REAL DO PROCESSAMENTO' : 'ATIVIDADE EM ANDAMENTO'}</small>
              <span>{currentActivity}</span>
            </div>
            <div className="orion-stage-measures">
              {measured && <strong className="orion-progress-percent">{Math.round(displayedProgress)}%</strong>}
              <small className="orion-elapsed-time">{elapsedSeconds}s</small>
            </div>
          </div>

          <div
            className={`orion-working-progress ${measured ? 'measured' : ''}`}
            aria-label={measured ? `Processamento ${Math.round(displayedProgress)}% concluído` : 'Processamento em andamento'}
            role="progressbar"
            {...(measured ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(displayedProgress) } : {})}
          >
            <span style={measured ? { width: `${displayedProgress}%` } : undefined} />
          </div>

          <div className="orion-working-footer">
            {finishing
              ? 'Concluído. Preparando a visualização do Dashboard.'
              : measured
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
