import { useState } from 'react'
import DashboardLoader from './DashboardLoader'
import DppConsolidation from './DppConsolidation'
import DppTest from './DppTest'

const API_URL = 'http://localhost:8000'

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [dashboardExpanded, setDashboardExpanded] = useState(false)
  const [finalDppAnalysis, setFinalDppAnalysis] = useState(null)

  function openView(view) {
    setActiveView(view)
    setDashboardExpanded(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="topbar-brand" type="button" onClick={() => openView('dashboard')} aria-label="Ir para o Dashboard">
          <span className="brand-mark">O</span>
          <strong>ORION</strong>
        </button>

        <nav className="topbar-nav" aria-label="Navegação principal">
          <div className={`nav-group ${dashboardExpanded ? 'expanded' : ''}`}>
            <button
              className={`nav-icon-button ${['dashboard', 'consolidation', 'test'].includes(activeView) ? 'nav-active' : ''}`}
              type="button"
              aria-label="Dashboard"
              aria-expanded={dashboardExpanded}
              data-tooltip="Dashboard"
              onClick={() => {
                setActiveView('dashboard')
                setDashboardExpanded((current) => !current)
              }}
            >
              <DashboardIcon />
              <span className="nav-disclosure" aria-hidden="true"><ChevronIcon /></span>
            </button>

            {dashboardExpanded && (
              <div className="nav-submenu" aria-label="Opções do Dashboard">
                <button
                  className={`nav-icon-button nav-subitem ${activeView === 'consolidation' ? 'nav-active' : ''}`}
                  type="button"
                  aria-label="Gerar novo DPP"
                  data-tooltip="Gerar novo DPP"
                  onClick={() => openView('consolidation')}
                >
                  <GenerateIcon />
                </button>
                <button
                  className={`nav-icon-button nav-subitem ${activeView === 'test' ? 'nav-active' : ''}`}
                  type="button"
                  aria-label="Testes do DPP"
                  data-tooltip="Testes do DPP"
                  onClick={() => openView('test')}
                >
                  <TestIcon />
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="topbar-status" data-tooltip="Motor Python local ativo" aria-label="Motor Python local ativo">
          <span className="status-dot" />
          <EngineIcon />
        </div>
      </header>

      <main className="content">
        {activeView === 'dashboard' && (
          <DashboardLoader
            apiUrl={API_URL}
            onNavigate={openView}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={setFinalDppAnalysis}
          />
        )}
        {activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeView === 'test' && <DppTest apiUrl={API_URL} />}
      </main>
    </div>
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

function GenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4" />
      <path d="M12 11v6M9 14h6" />
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m8 10 4 4 4-4" />
    </svg>
  )
}

function EngineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z" />
      <path d="M9 3v4M15 3v4M9 17v4M15 17v4M5 10H2M5 14H2M22 10h-3M22 14h-3" />
      <circle cx="10" cy="12" r="1" />
      <circle cx="14" cy="12" r="1" />
    </svg>
  )
}

export default App
