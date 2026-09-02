import { useLayoutEffect, useState } from 'react'
import AgentOrion from './AgentOrion'
import BrandLogo from './BrandLogo'
import DashboardInfoLayer from './DashboardInfoLayer'
import DashboardLoader from './DashboardLoader'
import DppColumnComparison from './DppColumnComparison'
import FinalModelPlan from './FinalModelPlan'
import './final-model-plan-detail.css'
import ScenarioDivergenceController from './ScenarioDivergenceController'
import EvolutionDivergenceController from './EvolutionDivergenceController'
import DppConsolidation from './DppConsolidation'
import DppTest from './DppTest'
import KnowledgeBase from './KnowledgeBase'
import { useDppWorkspace } from './DppWorkspaceContext'

const API_URL = ''
const THEME_STORAGE_KEY = 'sigma-s-orion-theme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return savedTheme === 'light' ? 'light' : 'dark'
}

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState('dpp')
  const [activeView, setActiveView] = useState('dashboard')
  const [activeKnowledgeView, setActiveKnowledgeView] = useState('operational')
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const { finalDppAnalysis, setFinalDppAnalysis } = useDppWorkspace()
  const [theme, setTheme] = useState(getInitialTheme)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  function openDppView(view) {
    setActiveWorkspace('dpp')
    setActiveView(view)
  }

  function openAgent() {
    setActiveWorkspace('agent')
  }

  function openKnowledge(view = 'operational') {
    setActiveWorkspace('knowledge')
    setActiveKnowledgeView(view)
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  const themeAction = theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'

  return (
    <div className="app-shell">
      <aside className="workspace-dock" aria-label="Áreas do SIGMA-S ORION">
        <button
          className={`workspace-button ${activeWorkspace === 'dpp' ? 'workspace-active' : ''}`}
          type="button"
          aria-label="DPP"
          data-tooltip="DPP"
          onClick={() => openDppView('dashboard')}
        >
          <DppIcon />
        </button>

        <button
          className={`workspace-button ${activeWorkspace === 'agent' ? 'workspace-active' : ''}`}
          type="button"
          aria-label="Agente ORION"
          data-tooltip="Agente ORION"
          onClick={openAgent}
        >
          <AgentIcon />
        </button>

        <button
          className={`workspace-button ${activeWorkspace === 'knowledge' ? 'workspace-active' : ''}`}
          type="button"
          aria-label="Base de conhecimento"
          data-tooltip="Base de conhecimento"
          onClick={() => openKnowledge('operational')}
        >
          <KnowledgeIcon />
        </button>

        <span className="workspace-dock-separator" aria-hidden="true" />

        <button
          className="workspace-button theme-toggle-button"
          type="button"
          aria-label={themeAction}
          aria-pressed={theme === 'dark'}
          data-tooltip={themeAction}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </button>
      </aside>

      <header className="topbar">
        <button className="topbar-brand" type="button" onClick={() => openDppView('dashboard')} aria-label="Ir para o Dashboard do DPP">
          <BrandLogo />
        </button>

        {activeWorkspace === 'dpp' && (
          <nav className="topbar-nav" aria-label="Navegação do DPP">
            <button
              className={`nav-icon-button ${activeView === 'dashboard' ? 'nav-active' : ''}`}
              type="button"
              aria-label="Dashboard do DPP"
              data-tooltip="Dashboard do DPP"
              onClick={() => openDppView('dashboard')}
            >
              <DashboardIcon />
            </button>

            <button
              className={`nav-icon-button ${activeView === 'test' ? 'nav-active' : ''}`}
              type="button"
              aria-label="Testes do DPP"
              data-tooltip="Testes do DPP"
              onClick={() => openDppView('test')}
            >
              <TestIcon />
            </button>
          </nav>
        )}

        {activeWorkspace === 'knowledge' && (
          <>
            <nav className="topbar-nav knowledge-topbar-nav" aria-label="Navegação da Base de conhecimento">
              <button
                className={`nav-icon-button ${activeKnowledgeView === 'operational' ? 'nav-active' : ''}`}
                type="button"
                aria-label="Conhecimento Operacional"
                data-tooltip="Conhecimento Operacional"
                onClick={() => openKnowledge('operational')}
              >
                <OperationalKnowledgeIcon />
              </button>
              <button
                className={`nav-icon-button ${activeKnowledgeView === 'deterministic' ? 'nav-active' : ''}`}
                type="button"
                aria-label="Regras Determinísticas"
                data-tooltip="Regras Determinísticas"
                onClick={() => openKnowledge('deterministic')}
              >
                <DeterministicRulesIcon />
              </button>
              <button
                className={`nav-icon-button ${activeKnowledgeView === 'current' ? 'nav-active' : ''}`}
                type="button"
                aria-label="Dados Atuais"
                data-tooltip="Dados Atuais"
                onClick={() => openKnowledge('current')}
              >
                <CurrentDataIcon />
              </button>
              <button
                className={`nav-icon-button ${activeKnowledgeView === 'tests' ? 'nav-active' : ''}`}
                type="button"
                aria-label="Testes do RAG"
                data-tooltip="Testes do RAG"
                onClick={() => openKnowledge('tests')}
              >
                <RagTestsIcon />
              </button>
            </nav>

            <label className="knowledge-topbar-search" aria-label="Pesquisar em toda a Base de conhecimento">
              <SearchIcon />
              <input
                type="search"
                value={knowledgeQuery}
                onChange={(event) => setKnowledgeQuery(event.target.value)}
                placeholder="Pesquisar em toda a Base de conhecimento..."
              />
            </label>
          </>
        )}
      </header>

      <main className="content">
        <section className="dpp-dashboard-view" hidden={activeWorkspace !== 'dpp' || activeView !== 'dashboard'}>
          <DashboardLoader
            apiUrl={API_URL}
            onNavigate={openDppView}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={setFinalDppAnalysis}
          />
          <EvolutionDivergenceController finalDppAnalysis={finalDppAnalysis} />
          <ScenarioDivergenceController finalDppAnalysis={finalDppAnalysis} />
          <FinalModelPlan finalDppAnalysis={finalDppAnalysis} />
          <DppColumnComparison finalDppAnalysis={finalDppAnalysis} apiUrl={API_URL} />
          <DashboardInfoLayer />
        </section>

        {activeWorkspace === 'dpp' && activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeWorkspace === 'dpp' && activeView === 'test' && (
          <section className="dpp-test-view" aria-label="Testes do DPP">
            <DppTest apiUrl={API_URL} />
          </section>
        )}
        {activeWorkspace === 'agent' && <AgentOrion apiUrl={API_URL} />}
        {activeWorkspace === 'knowledge' && (
          <KnowledgeBase apiUrl={API_URL} view={activeKnowledgeView} query={knowledgeQuery} />
        )}
      </main>
    </div>
  )
}

function DppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h7.2l3.8 3.8v13.2H6.5Z" />
      <path d="M13.5 3.8v4h3.8" />
      <path d="M9 11h6M9 14h6M9 17h4" />
    </svg>
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

function KnowledgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h5.2A2.8 2.8 0 0 1 13 7.3v12.2H7.8A2.8 2.8 0 0 1 5 16.7Z" />
      <path d="M19 4.5h-5.2A2.8 2.8 0 0 0 11 7.3v12.2h5.2a2.8 2.8 0 0 0 2.8-2.8Z" />
      <path d="M7.8 8.2h2M14.2 8.2h2M7.8 11.2h2M14.2 11.2h2" />
    </svg>
  )
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
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

export default App
