import { useEffect, useMemo, useRef, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import InfoHint from './InfoHint'
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

const TEST_INFO = {
  overview: {
    title: 'Testes do DPP',
    what: 'Reconstrói um mês conhecido com o motor determinístico do ORION e compara o resultado contra o DPP consolidado usado como gabarito.',
    source: 'DPP do mês anterior, WIU, Explosão, STK SAP, PGD e OPEN opcional; o DPP Final do mês é usado como referência esperada da comparação.',
    purpose: 'Validar se as regras Python reproduzem corretamente o processo mensal antes de usar o motor como base operacional.',
  },
  month: {
    title: 'Mês que será reconstruído',
    what: 'Define o mês de referência do teste que o ORION deve reconstruir.',
    source: 'Mês selecionado pelo usuário ou detectado a partir do pacote carregado.',
    purpose: 'Garantir que PGD, fontes mensais e DPP esperado sejam comparados no mesmo período.',
  },
  sharedPackage: {
    title: 'Pacote compartilhado',
    what: 'Confirma que a tela de Testes reutiliza os mesmos arquivos carregados no workspace do Dashboard.',
    source: 'Workspace local do DPP, persistido no navegador e compartilhado entre Dashboard e Testes.',
    purpose: 'Evitar selecionar arquivos repetidamente e impedir que cada tela valide um conjunto de fontes diferente.',
  },
  package: {
    title: 'Pacote atual do DPP',
    what: 'Lista as fontes reconhecidas para reconstruir e validar o mês: DPP anterior, DPP Final esperado, STK SAP, Explosão, PGD, WIU e OPEN quando disponível.',
    source: 'Arquivos selecionados pelo usuário e classificados pelo frontend conforme a função de cada planilha.',
    purpose: 'Permitir conferir rapidamente se o teste está usando todas as entradas obrigatórias e qual arquivo atua como gabarito.',
  },
  execution: {
    title: 'Execução do teste',
    what: 'Informa se o resultado já pertence ao pacote atual, se uma nova reconstrução é necessária e permite executar novamente sob demanda.',
    source: 'Assinatura do pacote compartilhado, resultado armazenado no workspace e endpoint /api/dpp/monthly/test.',
    purpose: 'Evitar processamento pesado repetido sem esconder quando o teste precisa ser executado de novo.',
  },
  verdict: {
    title: 'Resultado do teste',
    what: 'Resume se existem divergências atribuídas ao motor ORION após separar diferenças humanas e correções conhecidas do legado.',
    source: 'Classificação final produzida pelo serviço de reconstrução e comparação campo a campo.',
    purpose: 'Responder primeiro se o motor determinístico reproduziu corretamente os campos críticos do DPP.',
  },
  controlledReal: {
    title: 'REAL controlado',
    what: 'Durante este teste, o REAL do DPP esperado é aplicado ao cenário reconstruído para isolar a validação dos cálculos derivados.',
    source: 'Linha REAL do DPP Final usado como gabarito do mês conhecido.',
    purpose: 'Testar NEC, SALDO, estoques e demais regras sem confundir o resultado com um futuro solver automático de REAL, que ainda não está sendo validado aqui.',
  },
  validationSummary: {
    title: 'Resumo das validações',
    what: 'Mostra rapidamente a relação iguais/comparados nos principais grupos: Materiais, Matriz, KIT PGD, STK SAP, Explosão, NEC e SALDO.',
    source: 'Contadores gerados durante a comparação do Cenário ORION reconstruído contra o DPP esperado.',
    purpose: 'Localizar de imediato qual grupo precisa ser investigado antes de abrir o detalhamento campo a campo.',
  },
  fieldComparison: {
    title: 'Comparação campo a campo',
    what: 'Consolida, para cada grupo de validação, quantos valores foram comparados, quantos ficaram iguais e quantos foram classificados como intervenção humana, correção do legado ou divergência ORION.',
    source: 'Resultado detalhado do serviço de teste após reconstruir o mês e comparar cada campo suportado com o DPP esperado.',
    purpose: 'Dar rastreabilidade quantitativa ao veredito e mostrar exatamente em qual regra estão concentradas as diferenças.',
  },
  orionDifferences: {
    title: 'Divergências do ORION',
    what: 'Lista somente diferenças que continuam atribuídas ao motor determinístico depois de excluir intervenções humanas e correções conhecidas do legado.',
    source: 'Amostras classificadas como divergência ORION pelo serviço de teste.',
    purpose: 'Direcionar correções de regra, leitura de fonte ou cálculo que ainda impedem a reprodução correta do DPP.',
  },
  humanInterventions: {
    title: 'Intervenções humanas',
    what: 'Separa alterações do DPP Final que resultam de decisões do analista, principalmente criação, remoção, reassociação ou realocação de OPCs.',
    source: 'Comparação entre base histórica, cenário reconstruído e DPP Final esperado, usando as regras conservadoras de classificação de intervenção humana.',
    purpose: 'Impedir que uma decisão humana legítima seja registrada como falha do motor ORION.',
  },
  legacyCorrections: {
    title: 'Correções do legado',
    what: 'Mostra diferenças em que o ORION preserva uma fonte ou cálculo considerado correto em vez de reproduzir uma falha histórica conhecida da planilha.',
    source: 'Regras de classificação de legado aplicadas durante a comparação com o DPP esperado.',
    purpose: 'Distinguir melhoria/correção determinística de uma regressão real do motor.',
  },
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
          <div className="test-heading-with-info test-heading-main">
            <h2>Testes do DPP</h2>
            <InfoHint {...TEST_INFO.overview} />
          </div>
          <p>Esta tela reutiliza o pacote carregado no Dashboard. Quando o teste já foi preparado para o mesmo pacote, o resultado abre imediatamente sem novo processamento.</p>
        </div>
        <span className="status">Reconstrução → Comparação</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="monthly-controls panel">
        <div className="test-month-control">
          <div className="test-control-label-row">
            <label htmlFor="dpp-test-reference-month">Mês que será reconstruído</label>
            <InfoHint {...TEST_INFO.month} />
          </div>
          <input id="dpp-test-reference-month" type="month" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} disabled={loading} />
        </div>
        <div>
          <div className="test-heading-with-info test-inline-heading">
            <strong>Pacote compartilhado</strong>
            <InfoHint {...TEST_INFO.sharedPackage} />
          </div>
          <p>Os arquivos selecionados no Dashboard continuam disponíveis aqui. Só há novo processamento se o pacote mudar ou se você solicitar uma nova execução.</p>
        </div>
      </section>

      <BulkDppFilePicker
        mode="test"
        referenceMonth={referenceMonth}
        onBundle={applyFileBundle}
        processing={loading}
        title="Pacote atual do DPP"
        info={TEST_INFO.package}
      />

      <OrionWorking active={loading} mode="test" onCancel={cancelTest} />

      <section className="panel consolidation-action-panel">
        <div>
          <div className="test-heading-with-info test-inline-heading">
            <strong>{loading ? 'ORION reconstruindo e comparando' : result ? 'Resultado preparado' : requiredReady ? 'Pacote pronto para teste' : 'Aguardando arquivo necessário para o teste'}</strong>
            <InfoHint {...TEST_INFO.execution} />
          </div>
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
              <div className="test-heading-with-info">
                <h3>{result.status}</h3>
                <InfoHint {...TEST_INFO.verdict} />
              </div>
              <p>{verdictText()}</p>
            </div>
            <div className="test-verdict-note">
              <div className="test-heading-with-info test-inline-heading">
                <strong>REAL controlado</strong>
                <InfoHint {...TEST_INFO.controlledReal} align="right" />
              </div>
              <p>{result.note}</p>
            </div>
          </section>

          <div className="test-summary-heading">
            <div className="test-heading-with-info">
              <h3>Resumo das validações</h3>
              <InfoHint {...TEST_INFO.validationSummary} />
            </div>
            <p>Leitura rápida dos principais grupos antes do detalhamento completo.</p>
          </div>

          <section className="metrics-grid consolidation-metrics monthly-metrics">
            <TestMetric label="Materiais" check={result.checks.materials} />
            <TestMetric label="Matriz" check={result.checks.matrix} />
            <TestMetric label="KIT PGD" check={result.checks.kit_pgd} />
            <TestMetric label="STK SAP" check={result.checks.stock_sap} />
            <TestMetric label="Explosão" check={result.checks.explosion} />
            <TestMetric label="NEC" check={result.checks.nec} />
            <TestMetric label="SALDO" check={result.checks.balance} />
          </section>

          <section className="panel test-field-comparison">
            <div className="panel-header">
              <div>
                <div className="test-heading-with-info">
                  <h3>Comparação campo a campo</h3>
                  <InfoHint {...TEST_INFO.fieldComparison} />
                </div>
                <p>{result.summary.generated_materials.toLocaleString('pt-BR')} materiais gerados × {result.summary.expected_materials.toLocaleString('pt-BR')} materiais no gabarito.</p>
              </div>
              <span className={`source-state ${result.pass ? 'ready' : 'required'}`}>{result.status}</span>
            </div>
            <div className="table-scroll">
              <table className="dpp-table">
                <colgroup>
                  <col className="test-col-validation" />
                  <col className="test-col-compared" />
                  <col className="test-col-matches" />
                  <col className="test-col-human" />
                  <col className="test-col-legacy" />
                  <col className="test-col-orion" />
                  <col className="test-col-result" />
                </colgroup>
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
              <div>
                <div className="test-heading-with-info">
                  <h3>Divergências do ORION</h3>
                  <InfoHint {...TEST_INFO.orionDifferences} />
                </div>
                <p>Diferenças que continuam indicando regra ausente ou comportamento incorreto no motor determinístico.</p>
              </div>
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
              <div>
                <div className="test-heading-with-info">
                  <h3>Intervenções humanas</h3>
                  <InfoHint {...TEST_INFO.humanInterventions} />
                </div>
                <p>OPCs criados, removidos ou reassociados durante a análise do mês e os efeitos diretamente derivados dessas decisões.</p>
              </div>
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
              <div>
                <div className="test-heading-with-info">
                  <h3>Correções do legado</h3>
                  <InfoHint {...TEST_INFO.legacyCorrections} />
                </div>
                <p>Diferenças conhecidas em que o ORION mantém a fonte ou o cálculo correto em vez de reproduzir uma falha histórica do Excel.</p>
              </div>
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
