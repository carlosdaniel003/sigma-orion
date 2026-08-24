import { useState } from 'react'
import DppAnalysis from './DppAnalysis'
import DppConsolidation from './DppConsolidation'
import LegacyApp from './LegacyApp'

const API_URL = 'http://localhost:8000'

function App() {
  const [activeView, setActiveView] = useState('consolidation')

  if (activeView === 'legacy') {
    return (
      <div>
        <div className="legacy-return-bar">
          <button type="button" onClick={() => setActiveView('consolidation')}>Voltar para Novo DPP</button>
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
          <span className="eyebrow">FLUXO MENSAL</span>
          <h1>ORION</h1>
          <p>Geração do novo DPP a partir da base histórica e das fontes mensais, com cálculo determinístico e rastreabilidade.</p>
          <nav>
            <button className={activeView === 'consolidation' ? 'nav-active' : ''} onClick={() => setActiveView('consolidation')}>Gerar novo DPP</button>
            <button className={activeView === 'validation' ? 'nav-active' : ''} onClick={() => setActiveView('validation')}>Validar DPP pronto</button>
            <button onClick={() => setActiveView('legacy')}>Agente, Histórico e Diagnóstico</button>
          </nav>
        </div>
        <div className="sidebar-footer"><span className="status-dot" />Backend local</div>
      </aside>

      <main className="content">
        {activeView === 'consolidation' && <DppConsolidation apiUrl={API_URL} />}
        {activeView === 'validation' && <DppAnalysis apiUrl={API_URL} />}
      </main>
    </div>
  )
}

export default App
