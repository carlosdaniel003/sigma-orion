import { useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import OrionWorking from './OrionWorking'
import './dashboard.css'
import './dashboard-state.css'

const AUTO_RUN_DELAY = 450

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value, digits = 0) {
  return number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function formatPercent(value) {
  return `${number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function activeModelsForMaterial(material, realLookup) {
  return Object.entries(material.consumption_by_model || {})
    .filter(([modelName, usage]) => number(usage) > 0 && number(realLookup[modelName]) > 0)
    .map(([modelName]) => modelName)
}

function buildDashboardData(scenario) {
  const models = scenario?.models || []
  const materials = scenario?.materials || []
  const summary = scenario?.summary || {}
  const realLookup = Object.fromEntries(models.map((model) => [model.name, number(model.real)]))

  const pgdTotal = number(summary.kit_pgd_total ?? models.reduce((total, model) => total + number(model.kit_pgd), 0))
  const realTotal = number(summary.real_total ?? models.reduce((total, model) => total + number(model.real), 0))
  const gap = pgdTotal - realTotal
  const realVsPgd = pgdTotal > 0 ? (realTotal / pgdTotal) * 100 : 0

  const activeModels = models.filter((model) => number(model.real) > 0)
  const criticalMaterials = materials.filter((material) => material.status === 'INVESTIGAR')
  const riskModelNames = new Set()

  criticalMaterials.forEach((material) => {
    activeModelsForMaterial(material, realLookup).forEach((modelName) => riskModelNames.add(modelName))
  })

  const riskModels = activeModels.filter((model) => riskModelNames.has(model.name))
  const safeModels = Math.max(activeModels.length - riskModels.length, 0)
  const materialCoverage = activeModels.length ? (safeModels / activeModels.length) * 100 : 0
  const pgdExposed = riskModels.reduce((total, model) => total + number(model.kit_pgd), 0)

  const sharedCritical = criticalMaterials.filter(
    (material) => activeModelsForMaterial(material, realLookup).length > 1,
  )

  const requiredSources = (scenario?.sources || []).filter((source) => source.id !== 'open')
  const loadedRequiredSources = requiredSources.filter((source) => source.loaded).length
  const pgdPending = number(summary.pgd_unresolved_positive)

  return {
    models,
    materials,
    summary,
    pgdTotal,
    realTotal,
    gap,
    realVsPgd,
    activeModels,
    riskModels,
    safeModels,
    materialCoverage,
    pgdExposed,
    criticalMaterials,
    sharedCritical,
    requiredSources,
    loadedRequiredSources,
    pgdPending,
  }
}

function Dashboard({ apiUrl, scenario, onNavigate, finalDppAnalysis, onFinalDppAnalysis }) {
  const data = useMemo(() => buildDashboardData(scenario), [scenario])
  const [finalFile, setFinalFile] = useState(null)
  const [finalLoading, setFinalLoading] = useState(false)
  const [finalError, setFinalError] = useState('')
  const [bundleMeta, setBundleMeta] = useState({ ready: false, signature: '', total: 0 })
  const lastAutoSignatureRef = useRef('')
  const autoRunTimerRef = useRef(null)
  const finalAbortRef = useRef(null)

  const initialState = scenario ? {
    pgd: data.pgdTotal,
    real: data.realTotal,
    critical: data.criticalMaterials.length,
    opc: number(data.summary.inherited_optional_materials),
    activeModels: data.activeModels.length,
  } : null

  const finalSummary = finalDppAnalysis?.summary || null
  const finalState = finalSummary ? {
    pgd: number(finalSummary.pgd_total),
    real: number(finalSummary.real_total),
    critical: number(finalSummary.critical_materials),
    opc: number(finalSummary.opc_count),
    activeModels: number(finalSummary.active_models),
  } : null

  useEffect(() => {
    if (!scenario || !bundleMeta.ready || !bundleMeta.signature || !finalFile || finalLoading) return undefined
    if (lastAutoSignatureRef.current === bundleMeta.signature) return undefined

    window.clearTimeout(autoRunTimerRef.current)
    autoRunTimerRef.current = window.setTimeout(() => {
      lastAutoSignatureRef.current = bundleMeta.signature
      loadFinalDpp()
    }, AUTO_RUN_DELAY)

    return () => window.clearTimeout(autoRunTimerRef.current)
  }, [scenario, bundleMeta.ready, bundleMeta.signature, finalFile, finalLoading])

  function applyDashboardBundle(bundle) {
    setFinalFile(bundle.expectedDpp || null)
    setBundleMeta({ ready: bundle.ready, signature: bundle.signature || '', total: bundle.total || 0 })
    if (!bundle.total) {
      lastAutoSignatureRef.current = ''
      onFinalDppAnalysis?.(null)
    }
    setFinalError('')
  }

  async function loadFinalDpp() {
    if (!finalFile || finalLoading) return

    const controller = new AbortController()
    finalAbortRef.current = controller
    setFinalLoading(true)
    setFinalError('')
    const form = new FormData()
    form.append('file', finalFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/dashboard/final`, { method: 'POST', body: form, signal: controller.signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível carregar o DPP final.')
      onFinalDppAnalysis?.(payload)
    } catch (requestError) {
      if (requestError.name === 'AbortError') setFinalError('Análise cancelada. Use “Reanalisar DPP final” quando quiser executar novamente.')
      else setFinalError(requestError.message || 'Falha ao resumir o DPP final.')
    } finally {
      finalAbortRef.current = null
      setFinalLoading(false)
    }
  }

  function cancelFinalLoad() {
    finalAbortRef.current?.abort()
  }

  function rerunFinalDpp() {
    if (bundleMeta.signature) lastAutoSignatureRef.current = bundleMeta.signature
    loadFinalDpp()
  }

  return (
    <>
      <header className="page-header dashboard-header">
        <div>
          <span className="eyebrow">VISÃO OPERACIONAL</span>
          <h2>Visão Geral do cenário inicial gerado pelo ORION</h2>
          <p>Esta visão mostra o DPP criado pelo motor Python antes dos ajustes, investigações e decisões manuais do analista.</p>
        </div>
        <span className="status">{scenario ? formatMonth(scenario.reference_month) : 'Aguardando cenário'}</span>
      </header>

      {!scenario ? (
        <EmptyDashboard onNavigate={onNavigate} />
      ) : (
        <>
          <section className="dashboard-context-strip">
            <div>
              <span className="dashboard-context-label">Cenário atual</span>
              <strong>{formatMonth(scenario.reference_month)}</strong>
              <small>Cenário inicial ORION · antes dos ajustes do analista</small>
            </div>
            <div className="dashboard-context-actions">
              <span className="engine-badge"><span className="status-dot" />Motor Python ativo</span>
              <button className="secondary-button" type="button" onClick={() => onNavigate?.('consolidation')}>Ajustar REAL / Ver DPP</button>
            </div>
          </section>

          <EvolutionPanel
            referenceMonth={scenario.reference_month}
            initial={initialState}
            finalState={finalState}
            finalFilename={finalDppAnalysis?.filename}
            finalFile={finalFile}
            onBundle={applyDashboardBundle}
            loadFinalDpp={rerunFinalDpp}
            finalLoading={finalLoading}
            finalError={finalError}
            cancelFinalLoad={cancelFinalLoad}
          />

          <AiBridge initial={initialState} finalState={finalState} />

          <section className="dashboard-kpi-grid dashboard-kpi-primary">
            <KpiCard label="PGD do mês" value={formatNumber(data.pgdTotal)} unit="un." detail="Referência de produção do PGD" />
            <KpiCard label="REAL planejado" value={formatNumber(data.realTotal)} unit="un." detail={`${formatPercent(data.realVsPgd)} do PGD`} tone="good" />
            <KpiCard
              label="Gap PGD × REAL"
              value={formatNumber(Math.abs(data.gap))}
              unit="un."
              detail={data.gap > 0 ? 'Ainda não cobertas pelo REAL' : data.gap < 0 ? 'REAL acima do PGD' : 'REAL alinhado ao PGD'}
              tone={data.gap > 0 ? 'attention' : 'good'}
            />
            <KpiCard
              label="Cobertura material do REAL"
              value={formatPercent(data.materialCoverage)}
              detail={`${data.safeModels} de ${data.activeModels.length} modelos ativos sem material UN negativo`}
              tone={data.riskModels.length ? 'attention' : 'good'}
            />
          </section>

          <section className="dashboard-kpi-grid dashboard-kpi-secondary">
            <MiniKpi label="Modelos em risco" value={`${data.riskModels.length}/${data.activeModels.length}`} detail={`${data.models.length} modelos na base`} tone={data.riskModels.length ? 'attention' : 'good'} />
            <MiniKpi label="Materiais críticos" value={formatNumber(data.criticalMaterials.length)} detail={`${formatNumber(data.materials.length)} analisados`} tone={data.criticalMaterials.length ? 'critical' : 'good'} />
            <MiniKpi label="PGD exposto" value={formatNumber(data.pgdExposed)} detail="PGD ligado a modelos com material crítico" tone={data.pgdExposed ? 'attention' : 'good'} />
            <MiniKpi label="Críticos compartilhados" value={formatNumber(data.sharedCritical.length)} detail="Afetam mais de um modelo ativo" tone={data.sharedCritical.length ? 'attention' : 'good'} />
          </section>

          <PlanningPanel data={data} />

          <section className="dashboard-grid-main dashboard-footer-grid">
            <QualityPanel data={data} />
            <DecisionGuide />
          </section>
        </>
      )}
    </>
  )
}

function EvolutionPanel({ referenceMonth, initial, finalState, finalFilename, finalFile, onBundle, loadFinalDpp, finalLoading, finalError, cancelFinalLoad }) {
  const criticalDelta = finalState ? number(finalState.critical) - number(initial.critical) : 0
  const opcDelta = finalState ? number(finalState.opc) - number(initial.opc) : 0
  const realDelta = finalState ? number(finalState.real) - number(initial.real) : 0
  const activeDelta = finalState ? number(finalState.activeModels) - number(initial.activeModels) : 0

  return (
    <section className="panel dpp-evolution-panel">
      <div className="panel-header">
        <div>
          <h3>Evolução do DPP</h3>
          <p>O que mudou entre o cenário inicial calculado pelo ORION e o DPP consolidado após a análise.</p>
        </div>
        <span className="status">{finalState ? 'ANTES → DEPOIS' : 'Aguardando DPP final'}</span>
      </div>

      <div className="dpp-evolution-source">
        <BulkDppFilePicker
          mode="dashboard"
          referenceMonth={referenceMonth}
          onBundle={onBundle}
          processing={finalLoading}
          compact
          title="Adicionar pacote e localizar DPP final"
        />

        <OrionWorking active={finalLoading} mode="dashboard" onCancel={cancelFinalLoad} compact />

        <div className="dpp-final-upload">
          <span>{finalFile ? `DPP final detectado: ${finalFile.name}` : finalFilename ? `Último DPP final: ${finalFilename}` : 'Nenhum DPP final reconhecido no pacote'}</span>
          <button className="secondary-button" type="button" disabled={!finalFile || finalLoading} onClick={loadFinalDpp}>
            {finalLoading ? 'Processando...' : finalState ? 'Reanalisar DPP final' : 'Analisar agora'}
          </button>
        </div>
        {finalError && <div className="dpp-final-error">{finalError}</div>}
      </div>

      {finalState ? (
        <div className="dpp-evolution-list">
          <EvolutionRow label="Materiais críticos" before={initial.critical} after={finalState.critical} delta={criticalDelta} lowerIsBetter />
          <EvolutionRow label="OPCs" before={initial.opc} after={finalState.opc} delta={opcDelta} />
          <EvolutionRow label="REAL" before={initial.real} after={finalState.real} delta={realDelta} />
          <EvolutionRow label="Modelos ativos" before={initial.activeModels} after={finalState.activeModels} delta={activeDelta} />
        </div>
      ) : (
        <p className="dashboard-method-note">Adicione o pacote do mês para localizar o DPP final. Assim que a leitura terminar, as diferenças aparecem aqui.</p>
      )}
    </section>
  )
}

function EvolutionRow({ label, before, after, delta, lowerIsBetter = false }) {
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  const neutral = Math.abs(delta) < 1e-9
  return (
    <div className="dpp-evolution-row">
      <strong>{label}</strong>
      <span className="evolution-value before">{formatNumber(before)}</span>
      <span className="evolution-arrow">→</span>
      <span className="evolution-value after">{formatNumber(after)}</span>
      <small className={neutral ? 'neutral' : improved ? 'good' : 'attention'}>
        {neutral ? 'sem alteração' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}
      </small>
    </div>
  )
}

function AiBridge({ initial, finalState }) {
  const resolved = finalState ? Math.max(number(initial.critical) - number(finalState.critical), 0) : null
  return (
    <section className="panel dpp-ai-bridge">
      <div className="panel-header">
        <div>
          <h3>Onde entra o Agente ORION</h3>
          <p>O intervalo entre o cenário inicial e o DPP final representa o trabalho de investigação e decisão que a próxima camada de IA deve apoiar.</p>
        </div>
        <span className="status">Próxima camada</span>
      </div>

      <div className="ai-flow-grid">
        <div className="ai-flow-stage current">
          <span>HOJE</span>
          <strong>Python gera o cenário inicial</strong>
          <p>{formatNumber(initial.critical)} materiais críticos entram para investigação.</p>
        </div>
        <div className="ai-flow-arrow">→</div>
        <div className="ai-flow-stage human">
          <span>HOJE</span>
          <strong>Humano investiga e decide</strong>
          <p>Ajusta REAL, localiza OPC, consulta evidências e consolida o DPP.</p>
        </div>
        <div className="ai-flow-arrow">→</div>
        <div className="ai-flow-stage future">
          <span>FUTURO</span>
          <strong>Agente ORION apoia a investigação</strong>
          <p>Sugere prioridade, causa, OPC, OPEN e possíveis ajustes; o humano continua validando.</p>
        </div>
      </div>

      {finalState && (
        <div className="ai-gap-summary">
          <strong>{formatNumber(initial.critical)} → {formatNumber(finalState.critical)} materiais críticos</strong>
          <span>{resolved > 0 ? `${formatNumber(resolved)} situações deixaram de permanecer críticas entre o cenário inicial e o DPP final.` : 'O DPP final permite medir o efeito real das decisões tomadas durante a análise.'}</span>
        </div>
      )}
    </section>
  )
}

function EmptyDashboard({ onNavigate }) {
  return (
    <>
      <section className="panel dashboard-empty">
        <div>
          <span className="eyebrow">SEM DPP CARREGADO</span>
          <h3>Gere o DPP do mês para alimentar a visão operacional.</h3>
          <p>No Gerar novo DPP você pode selecionar todo o pacote mensal de uma vez; quando estiver completo, o processamento começa automaticamente.</p>
          <button className="primary-button" type="button" onClick={() => onNavigate?.('consolidation')}>Adicionar pacote e gerar DPP</button>
        </div>
        <div className="dashboard-readiness">
          <Readiness label="Construção mensal do DPP" status="Disponível" />
          <Readiness label="Cálculos NEC / STK TTL / SALDO" status="Disponível" />
          <Readiness label="Validação histórica" status="Aprovada" />
          <Readiness label="Solver automático de REAL" status="Próxima etapa" pending />
        </div>
      </section>

      <section className="dashboard-empty-kpis">
        <EmptyKpi label="PGD" text="O que precisamos produzir" />
        <EmptyKpi label="REAL" text="O que planejamos produzir" />
        <EmptyKpi label="Cobertura" text="Se o REAL está suportado pelos materiais" />
        <EmptyKpi label="Gargalos" text="O que impede o plano de avançar" />
      </section>
    </>
  )
}

function KpiCard({ label, value, unit, detail, tone = '' }) {
  return (
    <article className={`dashboard-kpi ${tone}`}>
      <span>{label}</span>
      <div><strong>{value}</strong>{unit && <small className="dashboard-kpi-unit">{unit}</small>}</div>
      <p>{detail}</p>
    </article>
  )
}

function MiniKpi({ label, value, detail, tone = '' }) {
  return (
    <article className={`dashboard-mini-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function PlanningPanel({ data }) {
  const max = Math.max(data.pgdTotal, data.realTotal, 1)
  const pgdWidth = Math.max((data.pgdTotal / max) * 100, data.pgdTotal > 0 ? 3 : 0)
  const realWidth = Math.max((data.realTotal / max) * 100, data.realTotal > 0 ? 3 : 0)

  return (
    <section className="panel dashboard-planning-panel">
      <div className="panel-header">
        <div><h3>PGD × REAL</h3><p>Compare a referência do PGD com o volume definido no REAL do cenário inicial.</p></div>
        <span className="status">{formatPercent(data.realVsPgd)}</span>
      </div>
      <div className="planning-bars">
        <PlanningBar label="PGD" value={data.pgdTotal} width={pgdWidth} />
        <PlanningBar label="REAL" value={data.realTotal} width={realWidth} real />
      </div>
      <div className="dashboard-explanation-row">
        <div><small>PGD</small><strong>Referência do plano</strong></div>
        <div><small>REAL</small><strong>Decisão inicial</strong></div>
        <div><small>GAP</small><strong>{data.gap > 0 ? `${formatNumber(data.gap)} un.` : data.gap < 0 ? `${formatNumber(Math.abs(data.gap))} un. acima` : 'Alinhado ao PGD'}</strong></div>
      </div>
    </section>
  )
}

function PlanningBar({ label, value, width, real = false }) {
  return (
    <div className="planning-bar-row">
      <div><strong>{label}</strong><span>{formatNumber(value)} un.</span></div>
      <div className="planning-bar-track"><div className={real ? 'planning-bar-fill real' : 'planning-bar-fill'} style={{ width: `${Math.min(width, 100)}%` }} /></div>
    </div>
  )
}

function QualityPanel({ data }) {
  const sourceOk = data.requiredSources.length > 0 && data.loadedRequiredSources === data.requiredSources.length
  return (
    <section className="panel dashboard-quality-panel">
      <div className="panel-header"><div><h3>Qualidade dos dados</h3><p>Condições básicas para confiar no cenário inicial exibido.</p></div></div>
      <div className="quality-list">
        <QualityRow label="Fontes obrigatórias" value={`${data.loadedRequiredSources}/${data.requiredSources.length}`} ok={sourceOk} />
        <QualityRow label="Mapeamentos PGD pendentes" value={formatNumber(data.pgdPending)} ok={data.pgdPending === 0} />
        <QualityRow label="Motor determinístico" value="Ativo" ok />
        <QualityRow label="Cálculo NEC / SALDO" value="Python" ok />
      </div>
    </section>
  )
}

function QualityRow({ label, value, ok }) {
  return <div className="quality-row"><div><span className={ok ? 'quality-dot ok' : 'quality-dot attention'} /><strong>{label}</strong></div><span>{value}</span></div>
}

function DecisionGuide() {
  return (
    <section className="panel dashboard-guide-panel">
      <div className="panel-header"><div><h3>Como ler o cenário inicial</h3><p>Três perguntas orientam a análise operacional.</p></div></div>
      <div className="decision-guide">
        <div><span>01</span><strong>Quanto precisamos produzir?</strong><p>PGD define a referência do mês.</p></div>
        <div><span>02</span><strong>Quanto o cenário inicial planeja?</strong><p>REAL começa pela referência disponível no PGD.</p></div>
        <div><span>03</span><strong>O que limita o plano?</strong><p>Materiais críticos mostram onde o analista precisa investigar.</p></div>
      </div>
      <div className="dashboard-method-note strong-note">A capacidade agregada máxima ainda não é apresentada como um número único porque materiais compartilhados exigem uma regra de alocação/solver. Esta versão exibe apenas indicadores sustentados pelo motor atual.</div>
    </section>
  )
}

function Readiness({ label, status, pending = false }) {
  return <div className="readiness-row"><span className={pending ? 'readiness-marker pending' : 'readiness-marker'} /><strong>{label}</strong><small>{status}</small></div>
}

function EmptyKpi({ label, text }) {
  return <article><span>{label}</span><strong>—</strong><p>{text}</p></article>
}

export default Dashboard
