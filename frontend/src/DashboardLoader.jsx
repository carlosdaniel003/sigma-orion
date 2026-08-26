import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import Dashboard from './Dashboard'
import OrionWorking from './OrionWorking'
import { classifyDppBundle } from './dpp-file-bundle'
import { useDppWorkspace } from './DppWorkspaceContext'

const AUTO_RUN_DELAY = 120
const BACKGROUND_TEST_DELAY = 350
const JOB_POLL_INTERVAL = 250

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function DashboardLoader({ apiUrl, onNavigate, finalDppAnalysis, onFinalDppAnalysis }) {
  const {
    files,
    referenceMonth,
    setReferenceMonth,
    generatedSignature,
    setGeneratedSignature,
    generatedScenario,
    setGeneratedScenario,
    testSignature,
    setTestSignature,
    setTestResult,
  } = useDppWorkspace()
  const [loading, setLoading] = useState(!generatedScenario)
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({
    progress: 0,
    activity: 'Preparando processamento',
  })
  const [error, setError] = useState('')
  const generationTimerRef = useRef(null)
  const generationAbortRef = useRef(null)
  const testPreparingRef = useRef(false)
  const backgroundTestTimerRef = useRef(null)
  const bootstrappedRef = useRef(false)

  const bundle = useMemo(
    () => classifyDppBundle(files, referenceMonth, 'generate'),
    [files, referenceMonth],
  )

  const testBundle = useMemo(
    () => classifyDppBundle(files, referenceMonth, 'test'),
    [files, referenceMonth],
  )

  const loadLatest = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/latest`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível carregar o cenário mensal mais recente.')
      setGeneratedScenario(data.available ? data.scenario : null)
    } catch (requestError) {
      setError(requestError.message || 'Falha ao carregar o dashboard.')
      setGeneratedScenario(null)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, setGeneratedScenario])

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    if (generatedScenario) {
      setLoading(false)
      return
    }
    loadLatest()
  }, [generatedScenario, loadLatest])

  useEffect(() => {
    if (bundle.referenceMonth && bundle.referenceMonth !== referenceMonth) {
      setReferenceMonth(bundle.referenceMonth)
    }
  }, [bundle.referenceMonth, referenceMonth, setReferenceMonth])

  useEffect(() => {
    if (loading || generating || !bundle.ready || !bundle.signature) return undefined
    if (bundle.signature === generatedSignature && generatedScenario) return undefined

    window.clearTimeout(generationTimerRef.current)
    generationTimerRef.current = window.setTimeout(() => {
      generateFromPackage()
    }, AUTO_RUN_DELAY)

    return () => window.clearTimeout(generationTimerRef.current)
  }, [loading, generating, bundle.ready, bundle.signature, generatedSignature, generatedScenario])

  useEffect(() => {
    window.clearTimeout(backgroundTestTimerRef.current)
    if (loading || generating || !generatedScenario || !testBundle.ready || !testBundle.signature) return undefined
    if (testBundle.signature === testSignature) return undefined

    backgroundTestTimerRef.current = window.setTimeout(() => {
      prepareTestFromPackage()
    }, BACKGROUND_TEST_DELAY)

    return () => window.clearTimeout(backgroundTestTimerRef.current)
  }, [loading, generating, generatedScenario, testBundle.ready, testBundle.signature, testSignature])

  async function prepareTestFromPackage() {
    if (!testBundle.ready || !testBundle.signature || testPreparingRef.current) return
    if (testBundle.signature === testSignature) return

    const month = testBundle.referenceMonth || referenceMonth
    if (!month) return

    testPreparingRef.current = true
    const form = new FormData()
    form.append('base_dpp', testBundle.baseDpp)
    form.append('expected_dpp', testBundle.expectedDpp)
    form.append('wiu', testBundle.wiu)
    form.append('explosion', testBundle.explosion)
    form.append('stock', testBundle.stock)
    form.append('pgd', testBundle.pgd)
    form.append('reference_month', month)
    if (testBundle.openFile) form.append('open_orders', testBundle.openFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/test`, { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível preparar os Testes do DPP.')
      setTestResult(data)
      setTestSignature(testBundle.signature)
    } catch (requestError) {
      console.error('Falha ao preparar Testes do DPP em segundo plano:', requestError)
    } finally {
      testPreparingRef.current = false
    }
  }

  async function waitForGenerationJob(jobId, controller) {
    let job = null

    while (!controller.signal.aborted) {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/generate/jobs/${jobId}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível consultar o progresso do processamento.')

      job = data
      setGenerationProgress({
        progress: Number(job.progress) || 0,
        activity: job.activity || 'Processando DPP',
      })

      if (job.status === 'completed') return job.result
      if (job.status === 'failed') throw new Error(job.error || 'O processamento do DPP foi interrompido.')

      await sleep(JOB_POLL_INTERVAL)
    }

    throw new DOMException('Processamento cancelado', 'AbortError')
  }

  async function generateFromPackage() {
    const month = bundle.referenceMonth || referenceMonth
    if (!bundle.baseDpp || !bundle.wiu || !bundle.explosion || !bundle.stock || !bundle.pgd || !month || generating) return

    const controller = new AbortController()
    generationAbortRef.current = controller
    setGenerating(true)
    setGenerationProgress({ progress: 1, activity: 'Enviando arquivos ao ORION' })
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
      const response = await fetch(`${apiUrl}/api/dpp/monthly/generate/jobs`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const job = await response.json()
      if (!response.ok) throw new Error(job.detail || 'Não foi possível iniciar a geração mensal do DPP.')
      if (!job.job_id) throw new Error('O backend não retornou o identificador do processamento.')

      setGenerationProgress({
        progress: Number(job.progress) || 0,
        activity: job.activity || 'Processamento iniciado',
      })

      const data = await waitForGenerationJob(job.job_id, controller)
      if (!data) throw new Error('O processamento terminou sem retornar o cenário mensal.')

      setGeneratedSignature(bundle.signature)
      setGeneratedScenario(data)
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
        <p>Consultando o cenário local já processado.</p>
      </section>
    )
  }

  return (
    <>
      {!generatedScenario ? (
        <>
          <header className="page-header dashboard-header">
            <div>
              <span className="eyebrow">VISÃO OPERACIONAL</span>
              <h2>Dashboard do DPP</h2>
              <p>Carregue o pacote mensal aqui uma única vez. O SIGMA-S ORION gera o cenário e prepara as demais telas usando os mesmos arquivos.</p>
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
        </>
      ) : (
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

          <Dashboard
            apiUrl={apiUrl}
            scenario={generatedScenario}
            onNavigate={onNavigate}
            finalDppAnalysis={finalDppAnalysis}
            onFinalDppAnalysis={onFinalDppAnalysis}
          />
        </>
      )}

      <OrionWorking
        active={generating}
        mode="generate"
        progress={generationProgress.progress}
        activity={generationProgress.activity}
      />
    </>
  )
}

export default DashboardLoader
