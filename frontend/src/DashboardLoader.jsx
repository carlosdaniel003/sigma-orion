import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import Dashboard from './Dashboard'
import OrionWorking from './OrionWorking'
import { classifyDppBundle } from './dpp-file-bundle'
import { useDppWorkspace } from './DppWorkspaceContext'

const AUTO_RUN_DELAY = 450

function DashboardLoader({ apiUrl, onNavigate, finalDppAnalysis, onFinalDppAnalysis }) {
  const { files, referenceMonth, setReferenceMonth, generatedSignature, setGeneratedSignature } = useDppWorkspace()
  const [scenario, setScenario] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const generationTimerRef = useRef(null)
  const generationAbortRef = useRef(null)

  const bundle = useMemo(
    () => classifyDppBundle(files, referenceMonth, 'generate'),
    [files, referenceMonth],
  )

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

  useEffect(() => {
    if (bundle.referenceMonth && bundle.referenceMonth !== referenceMonth) {
      setReferenceMonth(bundle.referenceMonth)
    }
  }, [bundle.referenceMonth, referenceMonth, setReferenceMonth])

  useEffect(() => {
    if (loading || generating || !bundle.ready || !bundle.signature) return undefined
    if (bundle.signature === generatedSignature) return undefined

    window.clearTimeout(generationTimerRef.current)
    generationTimerRef.current = window.setTimeout(() => {
      generateFromPackage()
    }, AUTO_RUN_DELAY)

    return () => window.clearTimeout(generationTimerRef.current)
  }, [loading, generating, bundle.ready, bundle.signature, generatedSignature])

  async function generateFromPackage() {
    const month = bundle.referenceMonth || referenceMonth
    if (!bundle.baseDpp || !bundle.wiu || !bundle.explosion || !bundle.stock || !bundle.pgd || !month || generating) return

    const controller = new AbortController()
    generationAbortRef.current = controller
    setGenerating(true)
    setError('')

    const form = new FormData()
    form.append('base_dpp', bundle.baseDpp)
    form.append('wiu', bundle.wiu)
    form.append('explosion', bundle.explosion)
    form.append('stock', bundle.stock)
    form.append('pgd', bundle.pgd)
    form.append('reference_month', month)
    if (bundle.openFile) form.append('open_orders', bundle.openFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/generate`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível gerar o cenário mensal a partir do pacote.')
      setScenario(data)
      setGeneratedSignature(bundle.signature)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message || 'Falha ao gerar o cenário mensal.')
      }
    } finally {
      generationAbortRef.current = null
      setGenerating(false)
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <span className="eyebrow">VISÃO OPERACIONAL</span>
        <h3 style={{ marginTop: 14 }}>Carregando cenário mais recente...</h3>
        <p>Consultando o motor Python local.</p>
      </section>
    )
  }

  if (!scenario) {
    return (
      <>
        <header className="page-header dashboard-header">
          <div>
            <span className="eyebrow">VISÃO OPERACIONAL</span>
            <h2>Dashboard do DPP</h2>
            <p>Carregue o pacote mensal aqui. O SIGMA-S ORION gera o cenário automaticamente e reutiliza os mesmos arquivos nas demais telas.</p>
          </div>
          <span className="status">Aguardando pacote</span>
        </header>

        {error && <div className="alert error">{error}</div>}

        <BulkDppFilePicker
          mode="generate"
          referenceMonth={referenceMonth}
          onBundle={() => {}}
          processing={generating}
          title="Carregar pacote do DPP"
        />

        <OrionWorking active={generating} mode="generate" />
      </>
    )
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <section className="dashboard-shared-package">
        <BulkDppFilePicker
          mode="generate"
          referenceMonth={referenceMonth}
          onBundle={() => {}}
          processing={generating}
          compact
          title="Pacote compartilhado do DPP"
        />
      </section>

      <OrionWorking active={generating} mode="generate" />
      <Dashboard
        apiUrl={apiUrl}
        scenario={scenario}
        onNavigate={onNavigate}
        finalDppAnalysis={finalDppAnalysis}
        onFinalDppAnalysis={onFinalDppAnalysis}
      />
    </>
  )
}

export default DashboardLoader
