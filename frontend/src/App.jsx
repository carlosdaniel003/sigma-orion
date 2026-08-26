import { useState } from 'react'
import DashboardLoader from './DashboardLoader'
import DashboardKpiComparison from './DashboardKpiComparison'
import DppConsolidation from './DppConsolidation'
import DppTest from './DppTest'

const API_URL = 'http://localhost:8000'

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState('dpp')
  const [activeView, setActiveView] = useState('dashboard')
  const [finalDppAnalysis, setFinalDppAnalysis] = useState(null)

  function openDppView(view) {
    setActiveWorkspace('dpp')
    setActiveView(view)
  }

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
      </aside>

      <header className="topbar">
        <button className="topbar-brand" type="button" onClick={() => openDppView('dashboard')} aria-label="Ir para o Dashboard do DPP">
          <span className="brand-mark">S</span>
          <strong>SIGMA-S ORION</strong>
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
      </header>

      <main className="content">
        <section hidden={activeWorkspace !== 'dpp' || activeView !== 'dashboard'}>
          <DashboardLoader
            apiUrl={API_URL}
            onNavigate={openDppView}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={setFinalDppAnalysis}
          />
          <DashboardKpiComparison finalDppAnalysis={finalDppAnalysis} />
        </section>

        {activeWorkspace === 'dpp' && activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeWorkspace === 'dpp' && activeView === 'test' && <DppTest apiUrl={API_URL} />}
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

export default App
