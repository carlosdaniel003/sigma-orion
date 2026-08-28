import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import Dashboard from './Dashboard'
import OrionWorking from './OrionWorking'
import { classifyDppBundle } from './dpp-file-bundle'
import { useDppWorkspace } from './DppWorkspaceContext'

const AUTO_RUN_DELAY = 120
const BACKGROUND_TEST_DELAY = 350
const FINAL_DPP_DELAY = 180
const JOB_POLL_INTERVAL = 250

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function fileIdentity(file) {
  return `${file?.name || ''}:${file?.size || 0}:${file?.lastModified || 0}`
}

function downloadFilename(disposition, fallback) {
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1] || fallback
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
    workspaceReady,
  } = useDppWorkspace()
  const [loading, setLoading] = useState(!generatedScenario)
  const [generating, setGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState({
    progress: 0,
    activity: 'Preparando processamento',
  })
  const [error, setError] = useState('')
  const [finalLoading, setFinalLoading] = useState(false)
  const [finalError, setFinalError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({
    progress: 0,
    activity: 'Aguardando geração do Excel',
  })
  const [exportError, setExportError] = useState('')
  const generationTimerRef = useRef(null)
  const generationAbortRef = useRef(null)
  const testPreparingRef = useRef(false)
  const backgroundTestTimerRef = useRef(null)
  const finalAnalysisTimerRef = useRef(null)
  const finalAnalysisAbortRef = useRef(null)
  const finalAnalysisSignatureRef = useRef('')
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
    if (!workspaceReady || bootstrappedRef.current) return
    bootstrappedRef.current = true
    if (generatedScenario) {
      setLoading(false)
      return
    }
    loadLatest()
  }, [workspaceReady, generatedScenario, loadLatest])

  useEffect(() => {
    if (!workspaceReady) return
    if (bundle.referenceMonth && bundle.referenceMonth !== referenceMonth) {
      setReferenceMonth(bundle.referenceMonth)
    }
  }, [workspaceReady, bundle.referenceMonth, referenceMonth, setReferenceMonth])

  useEffect(() => {
    if (!workspaceReady || loading || generating || !bundle.ready || !bundle.signature) return undefined
    if (bundle.signature === generatedSignature && generatedScenario) return undefined

    window.clearTimeout(generationTimerRef.current)
    generationTimerRef.current = window.setTimeout(() => {
      generateFromPackage()
    }, AUTO_RUN_DELAY)

    return () => window.clearTimeout(generationTimerRef.current)
  }, [workspaceReady, loading, generating, bundle.ready, bundle.signature, generatedSignature, generatedScenario])

  useEffect(() => {
    window.clearTimeout(backgroundTestTimerRef.current)
    if (!workspaceReady || loading || generating || !generatedScenario || !testBundle.ready || !testBundle.signature) return undefined
    if (testBundle.signature === testSignature) return undefined

    backgroundTestTimerRef.current = window.setTimeout(() => {
      prepareTestFromPackage()
    }, BACKGROUND_TEST_DELAY)

    return () => window.clearTimeout(backgroundTestTimerRef.current)
  }, [workspaceReady, loading, generating, generatedScenario, testBundle.ready, testBundle.signature, testSignature])

  useEffect(() => {
    window.clearTimeout(finalAnalysisTimerRef.current)

    if (!workspaceReady || !generatedScenario) return undefined

    const finalFile = bundle.expectedDpp
    if (!finalFile) {
      finalAnalysisSignatureRef.current = ''
      finalAnalysisAbortRef.current?.abort()
      setFinalLoading(false)
      setFinalError('')
      onFinalDppAnalysis?.(null)
      return undefined
    }

    const signature = `${referenceMonth || bundle.referenceMonth}|${fileIdentity(finalFile)}`
    if (finalAnalysisSignatureRef.current === signature) return undefined

    finalAnalysisTimerRef.current = window.setTimeout(() => {
      analyzeFinalDpp(finalFile, signature)
    }, FINAL_DPP_DELAY)

    return () => window.clearTimeout(finalAnalysisTimerRef.current)
  }, [workspaceReady, generatedScenario, bundle.expectedDpp, bundle.referenceMonth, referenceMonth])

  useEffect(() => () => {
    finalAnalysisAbortRef.current?.abort()
  }, [])

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

  async function analyzeFinalDpp(finalFile, signature) {
    if (!finalFile || !signature) return

    finalAnalysisAbortRef.current?.abort()
    const controller = new AbortController()
    finalAnalysisAbortRef.current = controller
    finalAnalysisSignatureRef.current = signature
    setFinalLoading(true)
    setFinalError('')
    onFinalDppAnalysis?.(null)

    const form = new FormData()
    form.append('file', finalFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/dashboard/final`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Não foi possível carregar o DPP final.')
      onFinalDppAnalysis?.(payload)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setFinalError(requestError.message || 'Falha ao resumir o DPP final.')
      }
    } finally {
      if (finalAnalysisAbortRef.current === controller) {
        finalAnalysisAbortRef.current = null
        setFinalLoading(false)
      }
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

  async function waitForExportJob(jobId) {
    while (true) {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/export/jobs/${jobId}`, {
        cache: 'no-store',
      })
      const job = await response.json()
      if (!response.ok) throw new Error(job.detail || 'Não foi possível consultar o progresso do Excel.')

      setExportProgress({
        progress: Math.min(Math.max(Number(job.progress) || 0, 0), 100),
        activity: job.activity || 'Gerando Excel ORION',
      })

      if (job.status === 'completed') return job
      if (job.status === 'failed') throw new Error(job.error || 'A geração do Excel foi interrompida.')

      await sleep(JOB_POLL_INTERVAL)
    }
  }

  async function generateFromPackage() {
    const month = bundle.referenceMonth || referenceMonth
    if (!bundle.baseDpp || !bundle.wiu || !bundle.explosion || !bundle.stock || !bundle.pgd || !month || generating) return

    const controller = new AbortController()
    generationAbortRef.current = controller
    setGenerating(true)
    setGenerationProgress({ progress: 1, activity: 'Enviando arquivos ao ORION' })
    setError('')
    setExportError('')

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

  async function exportOrionScenario() {
    if (!generatedScenario?.scenario_id || !bundle.baseDpp || exporting) return

    setExporting(true)
    setExportProgress({ progress: 0, activity: 'Enviando DPP base ao backend' })
    setExportError('')
    const form = new FormData()
    form.append('scenario_id', generatedScenario.scenario_id)
    form.append('base_dpp', bundle.baseDpp)

    try {
      const startResponse = await fetch(`${apiUrl}/api/dpp/monthly/export/jobs`, {
        method: 'POST',
        body: form,
      })
      const startedJob = await startResponse.json()
      if (!startResponse.ok) throw new Error(startedJob.detail || 'Não foi possível iniciar a geração do Excel ORION.')
      if (!startedJob.job_id) throw new Error('O backend não retornou o identificador da geração do Excel.')

      setExportProgress({
        progress: Math.min(Math.max(Number(startedJob.progress) || 0, 0), 100),
        activity: startedJob.activity || 'Geração do Excel iniciada',
      })

      const completedJob = await waitForExportJob(startedJob.job_id)
      setExportProgress({ progress: 100, activity: completedJob.activity || 'Excel pronto para download' })

      const response = await fetch(`${apiUrl}/api/dpp/monthly/export/jobs/${startedJob.job_id}/download`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        let message = 'O Excel foi gerado, mas não foi possível iniciar o download.'
        try {
          const payload = await response.json()
          if (payload.detail) message = payload.detail
        } catch {
          // Mantém a mensagem padrão quando a resposta não for JSON.
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const fallback = completedJob.result?.filename || `DPP_ORION_${generatedScenario.reference_month || 'cenario'}.xlsx`
      const filename = downloadFilename(response.headers.get('Content-Disposition'), fallback)
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (requestError) {
      setExportError(requestError.message || 'Falha ao baixar o cenário ORION.')
    } finally {
      setExporting(false)
    }
  }

  if (!workspaceReady || loading) {
    return (
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>{workspaceReady ? 'Carregando cenário mais recente...' : 'Restaurando pacote do DPP...'}</h3>
        <p>{workspaceReady ? 'Consultando o cenário local já processado.' : 'Recuperando os arquivos mantidos no armazenamento local deste navegador.'}</p>
      </section>
    )
  }

  const exportPercent = Math.round(exportProgress.progress)
  const packageFooter = (
    <>
      {finalLoading && <div className="dashboard-final-auto-status">Analisando o DPP final do pacote automaticamente...</div>}
      {finalError && <div className="alert error dashboard-final-auto-error">{finalError}</div>}

      <div className="dashboard-scenario-export" aria-label="Exportar cenário ORION">
        <div>
          <span>ARQUIVO DO CENÁRIO</span>
          <strong>Excel do cenário ORION</strong>
          <small>
            {bundle.baseDpp
              ? `Usa ${bundle.baseDpp.name} somente como estrutura visual. Todos os dados operacionais da aba DPP são preenchidos com o Cenário ORION.`
              : 'O DPP do mês anterior precisa estar no pacote para fornecer somente a estrutura visual do arquivo.'}
          </small>
        </div>
        <button
          className={`secondary-button dashboard-export-button ${exporting ? 'is-exporting' : ''}`}
          type="button"
          onClick={exportOrionScenario}
          disabled={!bundle.baseDpp || exporting || generating}
          aria-busy={exporting}
          aria-label={exporting ? `Gerando Excel ORION, ${exportPercent}% concluído` : 'Baixar Excel ORION'}
          title={exporting ? exportProgress.activity : undefined}
        >
          <span className="dashboard-export-button-label">
            {exporting ? `Gerando Excel · ${exportPercent}%` : 'Baixar Excel ORION'}
          </span>
          {exporting && (
            <span
              className="dashboard-export-progress"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={exportPercent}
            >
              <span style={{ width: `${exportPercent}%` }} />
            </span>
          )}
        </button>
      </div>
      {exportError && <div className="alert error dashboard-export-error">{exportError}</div>}
    </>
  )

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
              footer={packageFooter}
            />
          </section>

          <Dashboard
            scenario={generatedScenario}
            onNavigate={onNavigate}
            finalDppAnalysis={finalDppAnalysis}
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
