import { useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import OrionWorking from './OrionWorking'
import { useDppWorkspace } from './DppWorkspaceContext'
import './dpp-consolidation.css'

const AUTO_RUN_DELAY = 450

const CHECK_LABELS = {
  materials: 'Materiais',
  models: 'Modelos',
  matrix: 'Matriz Material × Modelo',
  description: 'Descrição',
  um: 'UM',
  origin: 'Origem',
  optional_material: 'OPC',
  kit_pgd: 'KIT PGD',
  real_reference: 'REAL de referência',
  stock_sap: 'STK SAP',
  explosion: 'Explosão',
  stock_op: 'STK OP',
  stock_total: 'STK TTL',
  nec: 'NEC',
  balance: 'SALDO',
}

function DppTest({ apiUrl }) {
  const {
    testResult: cachedTestResult,
    testSignature,
    setTestResult: setCachedTestResult,
    setTestSignature,
  } = useDppWorkspace()
  const [baseDpp, setBaseDpp] = useState(null)
  const [expectedDpp, setExpectedDpp] = useState(null)
  const [wiu, setWiu] = useState(null)
  const [explosion, setExplosion] = useState(null)
  const [stock, setStock] = useState(null)
  const [pgd, setPgd] = useState(null)
  const [openFile, setOpenFile] = useState(null)
  const [referenceMonth, setReferenceMonth] = useState('')
  const [bundleMeta, setBundleMeta] = useState({ ready: false, signature: '', total: 0 })
  const [result, setResult] = useState(cachedTestResult)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const lastAutoSignatureRef = useRef(testSignature || '')
  const autoRunTimerRef = useRef(null)
  const testAbortRef = useRef(null)

  const requiredReady = Boolean(baseDpp && expectedDpp && wiu && explosion && stock && pgd && referenceMonth)

  const failedChecks = useMemo(
    () => Object.entries(result?.checks || {}).filter(([, check]) => check.mismatches > 0),
    [result],
  )

  useEffect(() => {
    if (cachedTestResult) setResult(cachedTestResult)
  }, [cachedTestResult])

  useEffect(() => {
    if (!bundleMeta.ready || !bundleMeta.signature || !requiredReady || loading) return undefined
    if (testSignature === bundleMeta.signature && cachedTestResult) return undefined
    if (lastAutoSignatureRef.current === bundleMeta.signature) return undefined

    window.clearTimeout(autoRunTimerRef.current)
    autoRunTimerRef.current = window.setTimeout(() => {
      lastAutoSignatureRef.current = bundleMeta.signature
      runTest()
    }, AUTO_RUN_DELAY)

    return () => window.clearTimeout(autoRunTimerRef.current)
  }, [bundleMeta.ready, bundleMeta.signature, requiredReady, loading, referenceMonth, baseDpp, expectedDpp, wiu, explosion, stock, pgd, openFile, testSignature, cachedTestResult])

  function applyFileBundle(bundle) {
    setBaseDpp(bundle.baseDpp || null)
    setExpectedDpp(bundle.expectedDpp || null)
    setWiu(bundle.wiu || null)
    setExplosion(bundle.explosion || null)
    setStock(bundle.stock || null)
    setPgd(bundle.pgd || null)
    setOpenFile(bundle.openFile || null)
    setBundleMeta({ ready: bundle.ready, signature: bundle.signature || '', total: bundle.total || 0 })
    if (bundle.referenceMonth) setReferenceMonth(bundle.referenceMonth)
    if (!bundle.total) {
      lastAutoSignatureRef.current = ''
      setResult(null)
    }
    setError('')
  }

  async function runTest() {
    if (!baseDpp || !expectedDpp || !wiu || !explosion || !stock || !pgd || !referenceMonth || loading) return

    const controller = new AbortController()
    testAbortRef.current = controller
    setLoading(true)
    setError('')
    setResult(null)

    const form = new FormData()
    form.append('base_dpp', baseDpp)
    form.append('expected_dpp', expectedDpp)
    form.append('wiu', wiu)
    form.append('explosion', explosion)
    form.append('stock', stock)
    form.append('pgd', pgd)
    form.append('reference_month', referenceMonth)
    if (openFile) form.append('open_orders', openFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/test`, { method: 'POST', body: form, signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível executar o teste do DPP.')
      setResult(data)
      setCachedTestResult(data)
      setTestSignature(bundleMeta.signature)
    } catch (requestError) {
      if (requestError.name === 'AbortError') setError('Teste cancelado. Use “Executar novamente” quando quiser repetir a reconstrução.')
      else setError(requestError.message || 'Falha no teste de reconstrução.')
    } finally {
      testAbortRef.current = null
      setLoading(false)
    }
  }

  function cancelTest() {
    testAbortRef.current?.abort()
  }

  function rerunTest() {
    if (bundleMeta.signature) lastAutoSignatureRef.current = bundleMeta.signature
    runTest()
  }

  function verdictText() {
    if (!result) return ''
    if (!result.pass) return `${failedChecks.length} grupo(s) de validação ainda possuem divergências atribuídas ao ORION.`

    const human = result.summary.human_interventions_total || 0
    const legacy = result.summary.legacy_corrections_total || 0
    if (!human && !legacy) return 'Todos os campos críticos comparados ficaram iguais dentro da tolerância numérica.'

    const parts = []
    if (human) parts.push(`${human.toLocaleString('pt-BR')} intervenção(ões) humana(s) separada(s) do motor`)
    if (legacy) parts.push(`${legacy.toLocaleString('pt-BR')} correção(ões) do legado`)
    return `Nenhuma divergência atribuída ao ORION. ${parts.join(' e ')}.`
  }

  return (
    <>
      <header className="page-header consolidation-header">
        <div>
          <span className="eyebrow">VALIDAÇÃO DE RECONSTRUÇÃO</span>
          <h2>Testes do DPP</h2>
          <p>Esta tela reutiliza o pacote carregado no Dashboard. Quando o teste já foi preparado para o mesmo pacote, o resultado abre imediatamente sem novo processamento.</p>
        </div>
        <span className="status">Reconstrução → Comparação</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="monthly-controls panel">
        <label>
          <span>Mês que será reconstruído</span>
          <input type="month" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} disabled={loading} />
        </label>
        <div>
          <strong>Pacote compartilhado</strong>
          <p>Os arquivos selecionados no Dashboard continuam disponíveis aqui. Só há novo processamento se o pacote mudar ou se você solicitar uma nova execução.</p>
        </div>
      </section>

      <BulkDppFilePicker
        mode="test"
        referenceMonth={referenceMonth}
        onBundle={applyFileBundle}
        processing={loading}
        title="Pacote atual do DPP"
      />

      <OrionWorking active={loading} mode="test" onCancel={cancelTest} />

      <section className="panel consolidation-action-panel">
        <div>
          <strong>{loading ? 'ORION reconstruindo e comparando' : result ? 'Resultado preparado' : requiredReady ? 'Pacote pronto para teste' : 'Aguardando arquivo necessário para o teste'}</strong>
          <p>{loading ? 'O relatório aparece automaticamente ao terminar.' : result ? 'Este resultado pertence ao pacote já processado. Navegar entre Dashboard e Testes não executa novamente.' : requiredReady ? 'O teste será executado somente se ainda não existir resultado para este pacote.' : 'Se o DPP final não estiver no pacote, adicione apenas esse arquivo; os demais continuam preservados.'}</p>
        </div>
        <button className="secondary-button consolidation-button" type="button" onClick={rerunTest} disabled={!requiredReady || loading}>
          {loading ? 'Processando...' : result ? 'Executar novamente' : 'Executar agora'}
        </button>
      </section>

      {result && (
        <>
          <section className={`panel test-verdict ${result.pass ? 'test-pass' : 'test-fail'}`}>
            <div>
              <span className="eyebrow">RESULTADO</span>
              <h3>{result.status}</h3>
              <p>{verdictText()}</p>
            </div>
            <div className="test-verdict-note">
              <strong>REAL controlado</strong>
              <p>{result.note}</p>
            </div>
          </section>

          <section className="metrics-grid consolidation-metrics monthly-metrics">
            <TestMetric label="Materiais" check={result.checks.materials} />
            <TestMetric label="Matriz" check={result.checks.matrix} />
            <TestMetric label="KIT PGD" check={result.checks.kit_pgd} />
            <TestMetric label="STK SAP" check={result.checks.stock_sap} />
            <TestMetric label="Explosão" check={result.checks.explosion} />
            <TestMetric label="NEC" check={result.checks.nec} />
            <TestMetric label="SALDO" check={result.checks.balance} />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Comparação campo a campo</h3>
                <p>{result.summary.generated_materials.toLocaleString('pt-BR')} materiais gerados × {result.summary.expected_materials.toLocaleString('pt-BR')} materiais no gabarito.</p>
              </div>
              <span className={`source-state ${result.pass ? 'ready' : 'required'}`}>{result.status}</span>
            </div>
            <div className="table-scroll">
              <table className="dpp-table">
                <thead><tr><th>Validação</th><th>Comparados</th><th>Iguais</th><th>Intervenções humanas</th><th>Correções legado</th><th>Divergências ORION</th><th>Resultado</th></tr></thead>
                <tbody>
                  {Object.entries(result.checks).map(([name, check]) => (
                    <tr key={name}>
                      <td>{CHECK_LABELS[name] || name}</td>
                      <td className="number-cell">{check.checked.toLocaleString('pt-BR')}</td>
                      <td className="number-cell">{check.matches.toLocaleString('pt-BR')}</td>
                      <td className="number-cell">{(check.human_interventions || 0).toLocaleString('pt-BR')}</td>
                      <td className="number-cell">{(check.legacy_corrections || 0).toLocaleString('pt-BR')}</td>
                      <td className="number-cell">{check.mismatches.toLocaleString('pt-BR')}</td>
                      <td><CheckBadge check={check} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h3>Divergências do ORION</h3><p>Diferenças que continuam indicando regra ausente ou comportamento incorreto no motor determinístico.</p></div>
              <span className="status">{result.summary.orion_mismatches_total.toLocaleString('pt-BR')} total · {result.mismatches.length.toLocaleString('pt-BR')} exemplo(s)</span>
            </div>
            {!result.mismatches.length ? (
              <div className="rule-box"><strong>Nenhuma divergência atribuída ao ORION.</strong><p>Intervenções humanas e correções do legado são apresentadas separadamente abaixo.</p></div>
            ) : (
              <DifferenceTable items={result.mismatches} />
            )}
            {result.mismatch_samples_truncated && <div className="rule-box warning-box"><strong>Existem mais divergências do ORION.</strong><p>A tabela mostra apenas uma amostra. Os contadores acima representam o total encontrado.</p></div>}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h3>Intervenções humanas</h3><p>OPCs criados, removidos ou reassociados durante a análise do mês e os efeitos diretamente derivados dessas decisões.</p></div>
              <span className="status">{(result.summary.human_interventions_total || 0).toLocaleString('pt-BR')} total · {(result.human_interventions || []).length.toLocaleString('pt-BR')} exemplo(s)</span>
            </div>
            {!result.human_interventions?.length ? (
              <div className="rule-box"><strong>Nenhuma intervenção humana classificada.</strong><p>O OPC do DPP final coincide com a informação disponível na base histórica para os casos comparados.</p></div>
            ) : (
              <DifferenceTable items={result.human_interventions} showReason />
            )}
            {result.human_samples_truncated && <div className="rule-box warning-box"><strong>Existem mais intervenções humanas.</strong><p>A tabela mostra apenas uma amostra. Os contadores representam o total classificado.</p></div>}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h3>Correções do legado</h3><p>Diferenças conhecidas em que o ORION mantém a fonte ou o cálculo correto em vez de reproduzir uma falha histórica do Excel.</p></div>
              <span className="status">{result.summary.legacy_corrections_total.toLocaleString('pt-BR')} total · {result.legacy_corrections.length.toLocaleString('pt-BR')} exemplo(s)</span>
            </div>
            {!result.legacy_corrections.length ? (
              <div className="rule-box"><strong>Nenhuma correção de legado classificada.</strong><p>Neste teste, não houve falha histórica reconhecida pelo classificador.</p></div>
            ) : (
              <DifferenceTable items={result.legacy_corrections} showReason />
            )}
            {result.legacy_samples_truncated && <div className="rule-box warning-box"><strong>Existem mais correções do legado.</strong><p>A tabela mostra apenas uma amostra. Os contadores representam o total classificado.</p></div>}
          </section>
        </>
      )}
    </>
  )
}

function DifferenceTable({ items, showReason = false }) {
  return (
    <div className="table-scroll">
      <table className="dpp-table">
        <thead><tr><th>Escopo</th><th>Chave</th><th>Campo</th><th>ORION</th><th>DPP esperado</th>{showReason && <th>Classificação</th>}</tr></thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.scope}-${item.key}-${item.field}-${index}`}>
              <td>{item.scope}</td>
              <td className="material-code">{item.key}</td>
              <td>{CHECK_LABELS[item.field] || item.field}</td>
              <td>{displayValue(item.generated)}</td>
              <td>{displayValue(item.expected)}</td>
              {showReason && <td>{item.reason || item.classification}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CheckBadge({ check }) {
  if (check.mismatches) return <span className="unit-badge warning">DIVERGE</span>
  const human = check.human_interventions || 0
  const legacy = check.legacy_corrections || 0
  if (human && legacy) return <span className="unit-badge neutral">HUMANO + LEGADO</span>
  if (human) return <span className="unit-badge neutral">HUMANO</span>
  if (legacy) return <span className="unit-badge neutral">LEGADO</span>
  return <span className="unit-badge ok">OK</span>
}

function TestMetric({ label, check }) {
  const hasError = check && check.mismatches > 0
  const legacy = check?.legacy_corrections || 0
  const human = check?.human_interventions || 0
  let detail = 'Iguais'
  if (hasError) detail = `${check.mismatches} divergência(s)`
  else if (human && legacy) detail = `${human} humana(s) · ${legacy} legado`
  else if (human) detail = `${human} intervenção(ões) humana(s)`
  else if (legacy) detail = `${legacy} correção(ões) legado`

  return (
    <div className={`metric-card ${hasError ? 'metric-attention' : 'metric-ok'}`}>
      <span>{label}</span>
      <strong>{check ? `${check.matches.toLocaleString('pt-BR')}/${check.checked.toLocaleString('pt-BR')}` : '—'}</strong>
      <small>{detail}</small>
    </div>
  )
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  return String(value)
}

export default DppTest