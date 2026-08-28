import { useLayoutEffect, useState } from 'react'
import BrandLogo from './BrandLogo'
import DashboardInfoLayer from './DashboardInfoLayer'
import DashboardLoader from './DashboardLoader'
import DppColumnComparison from './DppColumnComparison'
import FinalModelPlan from './FinalModelPlan'
import ScenarioDivergenceController from './ScenarioDivergenceController'
import DppConsolidation from './DppConsolidation'
import DppTest from './DppTest'

const API_URL = 'http://localhost:8000'
const THEME_STORAGE_KEY = 'sigma-s-orion-theme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark'
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return savedTheme === 'light' ? 'light' : 'dark'
}

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState('dpp')
  const [activeView, setActiveView] = useState('dashboard')
  const [finalDppAnalysis, setFinalDppAnalysis] = useState(null)
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
      </header>

      <main className="content">
        <section className="dpp-dashboard-view" hidden={activeWorkspace !== 'dpp' || activeView !== 'dashboard'}>
          <DashboardLoader
            apiUrl={API_URL}
            onNavigate={openDppView}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={setFinalDppAnalysis}
          />
          <ScenarioDivergenceController finalDppAnalysis={finalDppAnalysis} />
          <FinalModelPlan finalDppAnalysis={finalDppAnalysis} />
          <DppColumnComparison finalDppAnalysis={finalDppAnalysis} />
          <DashboardInfoLayer />
        </section>

        {activeWorkspace === 'dpp' && activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeWorkspace === 'dpp' && activeView === 'test' && (
          <section className="dpp-test-view" aria-label="Testes do DPP">
            <DppTest apiUrl={API_URL} />
          </section>
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
