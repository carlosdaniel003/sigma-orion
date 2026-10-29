import { useMemo } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { currentInvestigationReports } from './current-investigation-reports'
import { pendingInvestigationItems, qualityPendingItems } from './pending-investigation-items'
import ModuleInfoHint from './ModuleInfoHint'
import DashboardModuleIcon from './DashboardModuleIcon'
import './pending-validations.css'

const MAX_VISIBLE = 5

function PendingArea({ area, title, items, onOpen }) {
  const known = Array.isArray(items)
  return (
    <section className="orion-pending-area" aria-label={title}>
      <div className="orion-pending-area-heading">
        <h4>{title}</h4>
        <strong>{known ? items.length.toLocaleString('pt-BR') : '—'}</strong>
      </div>
      {!known ? <p>Consulta ainda não disponível.</p> : items.length === 0
        ? <p>Nenhum PN aguardando confirmação nesta área.</p>
        : <>
          <ul className="orion-pending-list">
            {items.slice(0, MAX_VISIBLE).map(item => <li key={item.pn}>
              <button type="button" className="orion-pending-item"
                aria-label={`Abrir ${title}: PN ${item.pn}`}
                onClick={() => onOpen(area, item.pn)}>
                <strong>PN {item.pn}</strong>
                {item.description && <span title={item.description}>{item.description}</span>}
                {item.depots.length > 0 && <small>{item.depots.join(' / ')}</small>}
              </button>
            </li>)}
          </ul>
          {items.length > MAX_VISIBLE && (
            <button type="button" className="orion-pending-view-all"
              onClick={() => onOpen(area, '')}>
              Ver todos os {items.length.toLocaleString('pt-BR')} PNs pendentes
            </button>
          )}
        </>}
    </section>
  )
}

export default function PendingValidations({ scenario, stockFile, onOpen }) {
  const { dppState, workspaceReady, stockInvestigation, qualityInvestigation } = useDppWorkspace()
  const { stock, quality } = currentInvestigationReports({
    dppState, workspaceReady, stockFile, scenario, stockInvestigation, qualityInvestigation,
  })
  const stockItems = useMemo(() => pendingInvestigationItems(stock, 'stock'), [stock])
  const qualityItems = useMemo(() => qualityPendingItems(stock, quality), [stock, quality])

  return (
    <aside className="orion-pending-validations orion-investigation-ui"
      aria-label="Pendências de validação" id="orion-pending-validations">
      <div className="module-heading-with-info">
        <span className="orion-module-title">
          <DashboardModuleIcon name="pending" />
          <h3>Pendências de validação</h3>
        </span>
        <ModuleInfoHint moduleKey="dashboard.pending_validations" />
      </div>
      <p className="orion-pending-intro">
        PNs com registros nos depósitos investigados ainda sem decisão humana.
      </p>
      <PendingArea title="Aguardando Almoxarifado" area="stock" items={stockItems} onOpen={onOpen} />
      <PendingArea title="Aguardando CQ" area="quality" items={qualityItems} onOpen={onOpen} />
    </aside>
  )
}
