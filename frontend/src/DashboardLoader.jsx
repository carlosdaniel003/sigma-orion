import { useCallback, useEffect, useState } from 'react'
import Dashboard from './Dashboard'

function DashboardLoader({ apiUrl, onNavigate }) {
  const [scenario, setScenario] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadLatest = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/latest`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar o cenário mensal mais recente.')
      setScenario(data.available ? data.scenario : null)
    } catch (requestError) {
      setError(requestError.message || 'Falha ao carregar o dashboard.')
      setScenario(null)
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    loadLatest()
  }, [loadLatest])

  if (loading) {
    return (
      <section className="panel">
        <span className="eyebrow">VISÃO OPERACIONAL</span>
        <h3 style={{ marginTop: 14 }}>Carregando cenário mais recente...</h3>
        <p>Consultando o motor Python local.</p>
      </section>
    )
  }

  if (error) {
    return (
      <>
        <div className="alert error">{error}</div>
        <section className="panel">
          <h3>Dashboard indisponível</h3>
          <p>Verifique se o backend local está em execução e tente novamente.</p>
          <button className="secondary-button" type="button" onClick={loadLatest}>Tentar novamente</button>
        </section>
      </>
    )
  }

  return <Dashboard scenario={scenario} onNavigate={onNavigate} />
}

export default DashboardLoader
