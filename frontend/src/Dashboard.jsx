import ModuleInfoHint from './ModuleInfoHint'
import './dashboard.css'
import './dashboard-operational-cards.css'

const number = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const display = value => number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

function formatMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return 'Mês não definido'
  const [year, month] = value.split('-')
  const label = new Date(Number(year), Number(month) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Cenário inicial: somente quatro métricas, sem comparativos ou painéis ocultos. */
export default function Dashboard({ scenario }) {
  if (!scenario) {
    return <section className="panel dashboard-plan-overview" aria-label="Cenário inicial do DPP">
      <h2>Cenário inicial do DPP</h2>
      <p>Carregue o Pacote do mês para gerar os indicadores do cenário.</p>
    </section>
  }

  const models = scenario.models || []
  const pgd = number(scenario.summary?.kit_pgd_total
    ?? models.reduce((total, model) => total + number(model.kit_pgd), 0))
  const real = number(scenario.summary?.real_total
    ?? models.reduce((total, model) => total + number(model.real), 0))
  const gap = pgd - real
  const critical = (scenario.materials || []).filter(material => material.status === 'INVESTIGAR').length
  const gapDescription = Math.abs(gap) <= 1e-4
    ? 'REAL alinhado ao PGD' : gap > 0 ? 'PGD acima do REAL' : 'REAL acima do PGD'

  return (
    <section className="panel dashboard-plan-overview" aria-label="Cenário inicial do DPP">
      <header className="page-header dashboard-header">
        <div>
          <div className="module-heading-with-info dashboard-primary-heading">
            <h2>Cenário inicial do DPP</h2>
            <ModuleInfoHint moduleKey="dashboard.overview" />
          </div>
          <p>Cenário ORION antes das confirmações · {formatMonth(scenario.reference_month)}</p>
        </div>
      </header>
      <div className="dashboard-plan-metrics">
        <div><span>PGD do mês</span><strong>{display(pgd)} un.</strong><small>Referência de produção</small></div>
        <div><span>REAL planejado</span><strong>{display(real)} un.</strong><small>Definido pelo cenário ORION</small></div>
        <div><span>Gap PGD × REAL</span><strong>{display(Math.abs(gap))} un.</strong><small>{gapDescription}</small></div>
        <div><span>Materiais críticos</span><strong>{display(critical)}</strong><small>PNs UN com SALDO negativo</small></div>
      </div>
    </section>
  )
}
