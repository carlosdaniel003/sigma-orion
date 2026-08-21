import { useState } from 'react'

const API_URL = 'http://localhost:8000'

function App() {
  const [files, setFiles] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function inspectFiles() {
    if (!files.length) return

    setLoading(true)
    setError('')
    setResult(null)

    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    try {
      const response = await fetch(`${API_URL}/api/files/inspect`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Falha ao analisar os arquivos.')
      }

      setResult(data)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <span className="eyebrow">MVP LOCAL</span>
        <h1>Gêmeo Digital</h1>
        <p>
          Base inicial para receber as planilhas do DPP, inspecionar sua estrutura e
          preparar a consolidação determinística antes da camada de IA.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Arquivos de entrada</h2>
            <p>Neste primeiro estágio aceitamos arquivos .xlsx e .csv.</p>
          </div>
          <span className="status">Python + FastAPI</span>
        </div>

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
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>{file.name}</li>
            ))}
          </ul>
        )}

        <button type="button" onClick={inspectFiles} disabled={!files.length || loading}>
          {loading ? 'Lendo arquivos...' : 'Inspecionar arquivos'}
        </button>

        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Estrutura detectada</h2>
              <p>{result.files_received} arquivo(s) processado(s).</p>
            </div>
          </div>

          <div className="results-grid">
            {result.files.map((file) => (
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

      <section className="panel muted-panel">
        <h2>Próxima etapa</h2>
        <p>
          Quando os arquivos reais forem recebidos, vamos mapear as colunas, relações,
          equivalentes de PROC-V, tabelas dinâmicas e regras utilizadas pelo analista para
          construir o DPP consolidado.
        </p>
      </section>
    </main>
  )
}

export default App
