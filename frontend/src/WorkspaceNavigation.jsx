import { useState } from 'react'
import BrandLogo from './BrandLogo'

const knowledgeViews = [
  { id: 'operational', label: 'Conhecimento operacional', Icon: OperationalKnowledgeIcon },
  { id: 'deterministic', label: 'Regras determinísticas', Icon: DeterministicRulesIcon },
  { id: 'current', label: 'Dados atuais', Icon: CurrentDataIcon },
  { id: 'tests', label: 'Testes do RAG', Icon: RagTestsIcon },
]

function NavigationItem({ label, Icon, active, onClick }) {
  return (
    <button className="shell-nav-item" type="button" aria-label={label}
      aria-current={active ? 'page' : undefined} title={label} onClick={onClick}>
      <Icon /><span>{label}</span>
    </button>
  )
}

export default function WorkspaceNavigation({ activeWorkspace, activeView, activeKnowledgeView,
  onDppView, onAgent, onKnowledge, knowledgeQuery, onKnowledgeQuery, theme, onToggleTheme }) {
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const title = activeWorkspace === 'agent' ? 'Agente ORION'
    : activeWorkspace === 'knowledge' ? knowledgeViews.find((view) => view.id === activeKnowledgeView)?.label
      : activeView === 'test' ? 'Testes do DPP' : activeView === 'consolidation' ? 'Consolidação do DPP' : 'Dashboard do DPP'
  const themeAction = theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'

  return (
    <>
      <aside className="shell-sidebar" data-collapsed={collapsed} aria-label="Áreas do SIGMA-S ORION">
        <div className="shell-sidebar-head">
          <button className="shell-brand" type="button" aria-label="Ir para o Dashboard do DPP"
            onClick={() => onDppView('dashboard')}><BrandLogo /></button>
          <button type="button" className="shell-mobile-close shell-icon-button" aria-label="Fechar navegação" onClick={() => setCollapsed(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <nav id="workspace-navigation" className="shell-navigation" aria-label="Navegação principal"
          onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setCollapsed(true) }}>
          <NavigationItem label="Agente ORION" Icon={AgentIcon} active={activeWorkspace === 'agent'} onClick={onAgent} />
          <div className="shell-nav-group">
            <p>DPP mensal</p>
            <NavigationItem label="Dashboard do DPP" Icon={DashboardIcon}
              active={activeWorkspace === 'dpp' && activeView === 'dashboard'} onClick={() => onDppView('dashboard')} />
            <NavigationItem label="Testes do DPP" Icon={TestIcon}
              active={activeWorkspace === 'dpp' && activeView === 'test'} onClick={() => onDppView('test')} />
          </div>
          <div className="shell-nav-group">
            <p>Base de conhecimento</p>
            {knowledgeViews.map(({ id, label, Icon }) => (
              <NavigationItem key={id} label={label} Icon={Icon}
                active={activeWorkspace === 'knowledge' && activeKnowledgeView === id} onClick={() => onKnowledge(id)} />
            ))}
          </div>
        </nav>
        <div className="shell-sidebar-footer">
          <button className="shell-nav-item" type="button" aria-label={themeAction} title={themeAction}
            aria-pressed={theme === 'dark'} onClick={onToggleTheme}>
            {theme === 'dark' ? <MoonIcon /> : <SunIcon />}<span>{theme === 'dark' ? 'Tema escuro' : 'Tema claro'}</span>
          </button>
          <span className="shell-product-caption">Análise e consolidação do DPP</span>
        </div>
      </aside>
      <header className="shell-topbar">
        <button className="shell-icon-button" type="button" aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
          title={collapsed ? 'Expandir navegação' : 'Recolher navegação'} aria-expanded={!collapsed}
          aria-controls="workspace-navigation" onClick={() => setCollapsed((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h17v15h-17ZM9 4.5v15" /></svg>
        </button>
        <span className="shell-view-title">{title}</span>
        {activeWorkspace === 'knowledge' && (
          <label className="knowledge-topbar-search" aria-label="Pesquisar em toda a Base de conhecimento">
            <SearchIcon />
            <input type="search" value={knowledgeQuery} onChange={(event) => onKnowledgeQuery(event.target.value)}
              placeholder="Pesquisar conhecimento..." />
          </label>
        )}
      </header>
    </>
  )
}

function AgentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 5.5h14v10.8H9.2L5 19.5Z" />
      <path d="M8.5 9.2h7M8.5 12.6h4.8" />
    </svg>
  )
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="0" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="0" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="0" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="0" />
    </svg>
  )
}

function TestIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3.5h6M10 3.5v5l-5 9A2 2 0 0 0 6.8 20.5h10.4A2 2 0 0 0 19 17.5l-5-9v-5" />
      <path d="M8 14h8" />
      <path d="m9.5 17 1.5 1.5 3.5-3.5" />
    </svg>
  )
}

function OperationalKnowledgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 4.5h10.8a2.2 2.2 0 0 1 2.2 2.2v12.8H7.7a2.2 2.2 0 0 1-2.2-2.2Z" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </svg>
  )
}

function DeterministicRulesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6-4 6 4 6M15 6l4 6-4 6" />
      <path d="m13.5 4-3 16" />
    </svg>
  )
}

function CurrentDataIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5.8" rx="6.5" ry="2.8" />
      <path d="M5.5 5.8v6c0 1.55 2.9 2.8 6.5 2.8s6.5-1.25 6.5-2.8v-6" />
      <path d="M5.5 11.8v6.4C5.5 19.75 8.4 21 12 21s6.5-1.25 6.5-2.8v-6.4" />
    </svg>
  )
}

function RagTestsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3.5h6M10 3.5v5l-5 9A2 2 0 0 0 6.8 20.5h10.4A2 2 0 0 0 19 17.5l-5-9v-5" />
      <path d="M8 14h8" />
      <path d="m9.5 17 1.5 1.5 3.5-3.5" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.5 15.5 4 4" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.2A8.2 8.2 0 0 1 8.8 4a8.2 8.2 0 1 0 11.2 11.2Z" />
    </svg>
  )
}

