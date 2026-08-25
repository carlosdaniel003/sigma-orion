import { useMemo } from 'react'
import './dashboard.css'

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
  const modelLookup = Object.fromEntries(models.map((model) => [model.name, model]))

  const pgdTotal = number(summary.kit_pgd_total ?? models.reduce((total, model) => total + number(model.kit_pgd), 0))
  const realTotal = number(summary.real_total ?? models.reduce((total, model) => total + number(model.real), 0))
  const gap = pgdTotal - realTotal
  const realVsPgd = pgdTotal > 0 ? (realTotal / pgdTotal) * 100 : 0

  const activeModels = models.filter((model) => number(model.real) > 0 || number(model.kit_pgd) > 0)
  const criticalMaterials = materials.filter((material) => material.status === 'INVESTIGAR')
  const riskMap = new Map()

  criticalMaterials.forEach((material) => {
    activeModelsForMaterial(material, realLookup).forEach((modelName) => {
      if (!riskMap.has(modelName)) riskMap.set(modelName, [])
      riskMap.get(modelName).push(material)
    })
  })

  const riskModels = activeModels
    .filter((model) => riskMap.has(model.name))
    .map((model) => {
      const risks = riskMap.get(model.name) || []
      const worst = risks.reduce((selected, material) => {
        if (!selected || number(material.balance) < number(selected.balance)) return material
        return selected
      }, null)
      return {
        ...model,
        criticalCount: risks.length,
        worstDeficit: worst ? Math.abs(Math.min(number(worst.balance), 0)) : 0,
        worstMaterial: worst?.material || '—',
      }
    })
    .sort((left, right) => right.criticalCount - left.criticalCount || right.worstDeficit - left.worstDeficit)

  const safeModels = Math.max(activeModels.length - riskModels.length, 0)
  const materialCoverage = activeModels.length ? (safeModels / activeModels.length) * 100 : 0
  const pgdExposed = riskModels.reduce((total, model) => total + number(model.kit_pgd), 0)

  const sharedCritical = criticalMaterials.filter(
    (material) => activeModelsForMaterial(material, realLookup).length > 1,
  )

  const topBottlenecks = [...criticalMaterials]
    .sort((left, right) => number(left.balance) - number(right.balance))
    .slice(0, 8)
    .map((material) => ({
      ...material,
      affectedModels: activeModelsForMaterial(material, realLookup),
      deficit: Math.abs(Math.min(number(material.balance), 0)),
    }))

  const opcPreventedRupture = materials.filter((material) => {
    const stockOp = number(material.stock_op)
    if (stockOp <= 0) return false
    const currentBalance = number(material.balance)
    const balanceWithoutOpc = currentBalance - stockOp
    return currentBalance >= 0 && balanceWithoutOpc < 0
  }).length

  const requiredSources = (scenario?.sources || []).filter((source) => source.id !== 'open')
  const loadedRequiredSources = requiredSources.filter((source) => source.loaded).length
  const pgdPending = number(summary.pgd_unresolved_positive)

  return {
    models,
    materials,
    summary,
    modelLookup,
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
    topBottlenecks,
    opcPreventedRupture,
    requiredSources,
    loadedRequiredSources,
    pgdPending,
  }
}

function Dashboard({ scenario, onNavigate }) {
  const data = useMemo(() => buildDashboardData(scenario), [scenario])

  return (
    <>
      <header className="page-header dashboard-header">
        <div>
          <span className="eyebrow">VISÃO OPERACIONAL</span>
          <h2>Visão Geral do DPP</h2>
          <p>PGD, REAL, cobertura material e gargalos em uma única leitura para apoiar o planejamento do mês.</p>
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
              <small>{scenario.status === 'PRONTO_PARA_AJUSTE_REAL' ? 'DPP construído e disponível para ajuste do REAL' : scenario.status}</small>
            </div>
            <div className="dashboard-context-actions">
              <span className="engine-badge"><span className="status-dot" />Motor Python ativo</span>
              <button className="secondary-button" type="button" onClick={() => onNavigate?.('consolidation')}>Ajustar REAL / Ver DPP</button>
            </div>
          </section>

          <section className="dashboard-kpi-grid dashboard-kpi-primary">
            <KpiCard label="PGD do mês" value={formatNumber(data.pgdTotal)} unit="un." detail="Referência de produção do PGD" />
            <KpiCard label="REAL planejado" value={formatNumber(data.realTotal)} unit="un." detail={`${formatPercent(data.realVsPgd)} do PGD`} tone="good" />
            <KpiCard
              label="Gap PGD × REAL"
              value={formatNumber(Math.abs(data.gap))}
              unit="un."
              detail={data.gap >= 0 ? 'Ainda não cobertas pelo REAL' : 'REAL acima do PGD'}
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

          <section className="dashboard-grid-main">
            <PlanningPanel data={data} />
            <ModelHealthPanel data={data} />
          </section>

          <section className="dashboard-grid-main dashboard-risk-grid">
            <BottleneckPanel items={data.topBottlenecks} />
            <RiskModelsPanel items={data.riskModels.slice(0, 8)} />
          </section>

          <section className="panel dashboard-operational-panel">
            <div className="panel-header">
              <div>
                <h3>Estado da construção do DPP</h3>
                <p>Indicadores de consolidação e rastreabilidade do cenário carregado.</p>
              </div>
              <span className="status">Base atualizada</span>
            </div>
            <div className="dashboard-fact-grid">
              <Fact label="Materiais" value={formatNumber(data.summary.materials ?? data.materials.length)} detail="base consolidada" />
              <Fact label="Modelos" value={formatNumber(data.summary.models ?? data.models.length)} detail="estrutura do mês" />
              <Fact label="Novos no WIU" value={formatNumber(data.summary.new_materials_from_wiu)} detail="incluídos neste mês" />
              <Fact label="Históricos fora WIU" value={formatNumber(data.summary.historical_outside_wiu)} detail="preservados na base" />
              <Fact label="OPCs herdados" value={formatNumber(data.summary.inherited_optional_materials)} detail="relações históricas" />
              <Fact label="OPCs com estoque" value={formatNumber(data.summary.optional_materials_with_stock)} detail={`${data.opcPreventedRupture} evitaram ruptura no cenário`} />
            </div>
          </section>

          <section className="dashboard-grid-main dashboard-footer-grid">
            <QualityPanel data={data} />
            <DecisionGuide />
          </section>
        </>
      )}
    </>
  )
}

function EmptyDashboard({ onNavigate }) {
  return (
    <>
      <section className="panel dashboard-empty">
        <div>
          <span className="eyebrow">SEM DPP CARREGADO</span>
          <h3>Gere o DPP do mês para alimentar a visão operacional.</h3>
          <p>O dashboard usa diretamente o resultado do motor Python: PGD, REAL, materiais, saldos, OPCs e matriz Material × Modelo.</p>
          <button className="primary-button" type="button" onClick={() => onNavigate?.('consolidation')}>Gerar novo DPP</button>
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
        <div><h3>PGD × REAL</h3><p>Compare a referência do PGD com o volume atualmente definido no REAL.</p></div>
        <span className="status">{formatPercent(data.realVsPgd)}</span>
      </div>
      <div className="planning-bars">
        <PlanningBar label="PGD" value={data.pgdTotal} width={pgdWidth} />
        <PlanningBar label="REAL" value={data.realTotal} width={realWidth} real />
      </div>
      <div className="dashboard-explanation-row">
        <div><small>PGD</small><strong>Referência do plano</strong></div>
        <div><small>REAL</small><strong>Decisão de produção</strong></div>
        <div><small>GAP</small><strong>{data.gap >= 0 ? `${formatNumber(data.gap)} un.` : `${formatNumber(Math.abs(data.gap))} un. acima`}</strong></div>
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

function ModelHealthPanel({ data }) {
  return (
    <section className="panel dashboard-health-panel">
      <div className="panel-header">
        <div><h3>Situação dos modelos</h3><p>Leitura do cenário REAL contra materiais UN com saldo negativo.</p></div>
      </div>
      <div className="health-score">
        <strong>{formatPercent(data.materialCoverage)}</strong>
        <span>cobertura material</span>
      </div>
      <div className="health-progress"><span style={{ width: `${Math.min(data.materialCoverage, 100)}%` }} /></div>
      <div className="health-split">
        <div className="health-safe"><strong>{data.safeModels}</strong><span>sem restrição detectada</span></div>
        <div className="health-risk"><strong>{data.riskModels.length}</strong><span>com material crítico</span></div>
      </div>
      <p className="dashboard-method-note">A cobertura mede os modelos ativos que não consomem nenhum material UN com SALDO negativo no REAL atual.</p>
    </section>
  )
}

function BottleneckPanel({ items }) {
  return (
    <section className="panel dashboard-table-panel">
      <div className="panel-header">
        <div><h3>Principais gargalos</h3><p>Materiais com os maiores déficits no cenário atual.</p></div>
        <span className="status">Top {items.length}</span>
      </div>
      {!items.length ? <div className="dashboard-clear-state">Nenhum material crítico no cenário atual.</div> : (
        <div className="table-scroll">
          <table className="dpp-table dashboard-table">
            <thead><tr><th>Material</th><th>Déficit</th><th>Modelos afetados</th><th>OPC</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.material}>
                <td><strong className="material-code">{item.material}</strong><small>{item.description || 'Sem descrição'}</small></td>
                <td className="number-cell dashboard-negative">-{formatNumber(item.deficit)}</td>
                <td>{item.affectedModels.length}</td>
                <td>{item.optional_material || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RiskModelsPanel({ items }) {
  return (
    <section className="panel dashboard-table-panel">
      <div className="panel-header">
        <div><h3>Modelos com maior risco</h3><p>Priorização pela quantidade de materiais críticos associados ao REAL atual.</p></div>
        <span className="status">{items.length} exibidos</span>
      </div>
      {!items.length ? <div className="dashboard-clear-state">Nenhum modelo com restrição material detectada.</div> : (
        <div className="table-scroll">
          <table className="dpp-table dashboard-table">
            <thead><tr><th>Modelo</th><th>PGD</th><th>REAL</th><th>Críticos</th><th>Pior déficit</th></tr></thead>
            <tbody>{items.map((model) => (
              <tr key={model.name}>
                <td><strong>{model.name}</strong><small>{model.worstMaterial}</small></td>
                <td className="number-cell">{formatNumber(model.kit_pgd)}</td>
                <td className="number-cell">{formatNumber(model.real)}</td>
                <td>{model.criticalCount}</td>
                <td className="number-cell dashboard-negative">-{formatNumber(model.worstDeficit)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Fact({ label, value, detail }) {
  return <article className="dashboard-fact"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function QualityPanel({ data }) {
  const sourceOk = data.requiredSources.length > 0 && data.loadedRequiredSources === data.requiredSources.length
  return (
    <section className="panel dashboard-quality-panel">
      <div className="panel-header"><div><h3>Qualidade dos dados</h3><p>Condições básicas para confiar no cenário exibido.</p></div></div>
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
      <div className="panel-header"><div><h3>Como ler o dashboard</h3><p>Três perguntas orientam a análise operacional.</p></div></div>
      <div className="decision-guide">
        <div><span>01</span><strong>Quanto precisamos produzir?</strong><p>PGD define a referência do mês.</p></div>
        <div><span>02</span><strong>Quanto estamos planejando?</strong><p>REAL representa a decisão atual de produção.</p></div>
        <div><span>03</span><strong>O que limita o plano?</strong><p>Materiais críticos e gargalos mostram onde investigar.</p></div>
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
