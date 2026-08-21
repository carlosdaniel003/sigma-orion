import { useEffect, useState } from 'react'

const API_URL = 'http://localhost:8000'

function App() {
  const [activeView, setActiveView] = useState('overview')
  const [files, setFiles] = useState([])
  const [fileResult, setFileResult] = useState(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [error, setError] = useState('')
  const [agentStatus, setAgentStatus] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [question, setQuestion] = useState('')
  const [chatAnswer, setChatAnswer] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [feedbackState, setFeedbackState] = useState({})

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/agent/status`).then((response) => response.json()),
      fetch(`${API_URL}/api/agent/demo`).then((response) => response.json()),
    ])
      .then(([statusData, analysisData]) => {
        setAgentStatus(statusData)
        setAnalysis(analysisData)
      })
      .catch(() => setError('Não foi possível carregar o estado inicial do backend.'))
  }, [])

  async function inspectFiles() {
    if (!files.length) return

    setLoadingFiles(true)
    setError('')
    setFileResult(null)

    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    try {
      const response = await fetch(`${API_URL}/api/files/inspect`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.detail || 'Falha ao analisar os arquivos.')
      setFileResult(data)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoadingFiles(false)
    }
  }

  async function sendFeedback(recommendation, decision) {
    let comment = null
    if (decision === 'rejected') {
      comment = window.prompt('Por que esta recomendação deve ser rejeitada?')
      if (comment === null) return
    }

    const response = await fetch(`${API_URL}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analysis_id: analysis.analysis_id,
        recommendation_id: recommendation.id,
        decision,
        comment,
      }),
    })

    if (!response.ok) {
      setError('Não foi possível registrar o feedback.')
      return
    }

    setFeedbackState((current) => ({ ...current, [recommendation.id]: decision }))
  }

  async function askAgent(event) {
    event.preventDefault()
    if (!question.trim()) return

    setChatLoading(true)
    setChatAnswer('')

    try {
      const response = await fetch(`${API_URL}/api/agent/chat-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error('Falha ao consultar o agente.')
      setChatAnswer(data.answer)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <span className="eyebrow">MVP LOCAL</span>
          <h1>Gêmeo Digital</h1>
          <p>Assistente de análise do DPP com cálculo determinístico e validação humana.</p>
        </div>

        <nav>
          <button className={activeView === 'overview' ? 'nav-active' : ''} onClick={() => setActiveView('overview')}>
            Visão geral
          </button>
          <button className={activeView === 'files' ? 'nav-active' : ''} onClick={() => setActiveView('files')}>
            Arquivos
          </button>
          <button className={activeView === 'agent' ? 'nav-active' : ''} onClick={() => setActiveView('agent')}>
            Agente
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          Backend local
        </div>
      </aside>

      <main className="content">
        {error && <div className="alert error">{error}</div>}

        {activeView === 'overview' && (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">CONTROLE E RASTREABILIDADE</span>
                <h2>Visão geral</h2>
              </div>
              <span className="status">Agente: {agentStatus?.provider || 'carregando'}</span>
            </header>

            {analysis && (
              <>
                <div className="alert demo">{analysis.demo_notice}</div>
                <section className="metrics-grid">
                  <Metric label="Materiais" value={analysis.metrics.total_materials} />
                  <Metric label="Críticos" value={analysis.metrics.critical} tone="critical" />
                  <Metric label="Atenção" value={analysis.metrics.attention} tone="attention" />
                  <Metric label="Atendidos" value={analysis.metrics.ok} tone="ok" />
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <h3>Fluxo projetado</h3>
                      <p>O núcleo já está separado para receber as regras reais quando os arquivos chegarem.</p>
                    </div>
                  </div>
                  <div className="flow-grid">
                    <FlowStep number="01" title="Python" text="Lê, relaciona, valida e calcula." />
                    <FlowStep number="02" title="RAG" text="Recupera regras e conhecimento aprovado." />
                    <FlowStep number="03" title="LLM" text="Interpreta fatos e sugere ações." />
                    <FlowStep number="04" title="Humano" text="Valida, corrige e decide." />
                  </div>
                </section>
              </>
            )}
          </>
        )}

        {activeView === 'files' && (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">ENTRADA DE DADOS</span>
                <h2>Arquivos</h2>
                <p>Inspecione planilhas antes de criarmos as regras de consolidação.</p>
              </div>
              <span className="status">Pandas + OpenPyXL</span>
            </header>

            <section className="panel">
              <label className="upload-box">
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  multiple
                  onChange={(event) => setFiles(Array.from(event.target.files || []))}
                />
                <strong>Selecionar planilhas</strong>
                <span>{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Nenhum arquivo selecionado'}</span>
              </label>

              {files.length > 0 && (
                <ul className="file-list">
                  {files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
                </ul>
              )}

              <button className="primary-button" type="button" onClick={inspectFiles} disabled={!files.length || loadingFiles}>
                {loadingFiles ? 'Lendo arquivos...' : 'Inspecionar arquivos'}
              </button>
            </section>

            {fileResult && (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h3>Estrutura detectada</h3>
                    <p>{fileResult.files_received} arquivo(s) processado(s).</p>
                  </div>
                </div>
                <div className="results-grid">
                  {fileResult.files.map((file) => (
                    <article className="result-card" key={file.filename}>
                      <h3>{file.filename}</h3>
                      {file.sheets.map((sheet) => (
                        <div className="sheet" key={sheet.name}>
                          <strong>{sheet.name}</strong>
                          <span>{sheet.rows} linhas</span>
                          <small>{sheet.columns.length} colunas</small>
                          <div className="columns">{sheet.columns.join(' · ') || 'Sem colunas detectadas'}</div>
                        </div>
                      ))}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {activeView === 'agent' && analysis && (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">HUMAN IN THE LOOP</span>
                <h2>Agente DPP</h2>
                <p>Interface preparada para a futura LLM. Neste momento as respostas são demonstrativas.</p>
              </div>
              <span className="status">Provider: {analysis.provider}</span>
            </header>

            <div className="alert demo">{analysis.demo_notice}</div>

            <section className="panel">
              <h3>Resumo da análise</h3>
              <p>{analysis.summary}</p>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Riscos e evidências</h3>
                  <p>A conclusão nunca deve aparecer desacompanhada dos fatos utilizados.</p>
                </div>
              </div>
              <div className="risk-list">
                {analysis.risks.map((risk) => (
                  <article className="risk-card" key={risk.id}>
                    <div className="risk-title-row">
                      <div>
                        <span className={`severity ${risk.severity}`}>{risk.severity}</span>
                        <h4>{risk.material} — {risk.title}</h4>
                      </div>
                    </div>
                    <p>{risk.explanation}</p>
                    <div className="evidence-grid">
                      {risk.evidence.map((item) => (
                        <div className="evidence" key={`${risk.id}-${item.label}`}>
                          <small>{item.label}</small>
                          <strong>{item.value}</strong>
                          <span>{item.source}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Ações sugeridas</h3>
                  <p>O agente recomenda; o analista decide.</p>
                </div>
              </div>
              <div className="recommendation-list">
                {analysis.recommendations.map((recommendation) => (
                  <article className="recommendation" key={recommendation.id}>
                    <div>
                      <h4>{recommendation.title}</h4>
                      <p>{recommendation.reason}</p>
                    </div>
                    <div className="feedback-actions">
                      <button
                        className="secondary-button"
                        onClick={() => sendFeedback(recommendation, 'rejected')}
                        disabled={Boolean(feedbackState[recommendation.id])}
                      >
                        Rejeitar
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => sendFeedback(recommendation, 'approved')}
                        disabled={Boolean(feedbackState[recommendation.id])}
                      >
                        Aprovar
                      </button>
                      {feedbackState[recommendation.id] && (
                        <span className="saved-feedback">
                          {feedbackState[recommendation.id] === 'approved' ? 'Aprovada' : 'Rejeitada'}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Converse com o agente</h3>
                  <p>O contrato do chat já está pronto para substituir o mock pela LLM.</p>
                </div>
              </div>
              <form className="chat-form" onSubmit={askAgent}>
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ex.: Por que MAT-DEMO-001 está crítico?"
                />
                <button className="primary-button" disabled={chatLoading || !question.trim()}>
                  {chatLoading ? 'Consultando...' : 'Perguntar'}
                </button>
              </form>
              {chatAnswer && <div className="chat-answer">{chatAnswer}</div>}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Metric({ label, value, tone = '' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function FlowStep({ number, title, text }) {
  return (
    <article className="flow-step">
      <span>{number}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </article>
  )
}

export default App
