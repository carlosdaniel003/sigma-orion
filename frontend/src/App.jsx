import { useState } from 'react'
import DashboardLoader from './DashboardLoader'
import DppAnalysis from './DppAnalysis'
import DppConsolidation from './DppConsolidation'
import DppTest from './DppTest'
import LegacyApp from './LegacyApp'

const API_URL = 'http://localhost:8000'

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [finalDppAnalysis, setFinalDppAnalysis] = useState(null)

  if (activeView === 'legacy') {
    return (
      <div>
        <div className="legacy-return-bar">
          <button type="button" onClick={() => setActiveView('dashboard')}>Voltar para Visão Geral</button>
          <span>Módulos anteriores do MVP</span>
        </div>
        <LegacyApp />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">PLANEJAMENTO DPP</span>
          <h1>ORION</h1>
          <p>Visão operacional do plano de produção, cobertura de materiais, riscos e rastreabilidade do DPP.</p>
          <nav>
            <button className={activeView === 'dashboard' ? 'nav-active' : ''} onClick={() => setActiveView('dashboard')}>Visão Geral</button>
            <button className={activeView === 'consolidation' ? 'nav-active' : ''} onClick={() => setActiveView('consolidation')}>Gerar novo DPP</button>
            <button className={activeView === 'test' ? 'nav-active' : ''} onClick={() => setActiveView('test')}>Testes do DPP</button>
            <button className={activeView === 'validation' ? 'nav-active' : ''} onClick={() => setActiveView('validation')}>Validar DPP pronto</button>
            <button onClick={() => setActiveView('legacy')}>Agente, Histórico e Diagnóstico</button>
          </nav>
        </div>
        <div className="sidebar-footer"><span className="status-dot" />Motor Python local</div>
      </aside>

      <main className="content">
        {activeView === 'dashboard' && (
          <DashboardLoader
            apiUrl={API_URL}
            onNavigate={setActiveView}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={setFinalDppAnalysis}
          />
        )}
        {activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeView === 'test' && <DppTest apiUrl={API_URL} />}
        {activeView === 'validation' && <DppAnalysis apiUrl={API_URL} />}
      </main>
    </div>
  )
}

export default App
