import { useLayoutEffect, useState } from 'react'
import AgentOrion from './AgentOrion'
import WorkspaceNavigation from './WorkspaceNavigation'
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

  return (
    <div className="app-shell">
      <WorkspaceNavigation
        activeWorkspace={activeWorkspace}
        activeView={activeView}
        activeKnowledgeView={activeKnowledgeView}
        onDppView={openDppView}
        onAgent={openAgent}
        onKnowledge={openKnowledge}
        knowledgeQuery={knowledgeQuery}
        onKnowledgeQuery={setKnowledgeQuery}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

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

export default App
