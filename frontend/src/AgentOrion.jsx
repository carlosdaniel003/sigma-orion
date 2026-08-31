import { useEffect, useMemo, useRef, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import './agent-orion.css'

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value) {
  return NUMBER_FORMAT.format(number(value))
}

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function findMaterial(question, materials) {
  const normalizedQuestion = normalize(question)
  return (materials || []).find((material) => {
    const code = normalize(material.material || material.material_key)
    return code && normalizedQuestion.includes(code)
  }) || null
}

function findModel(question, models) {
  const normalizedQuestion = normalize(question)
  return [...(models || [])]
    .sort((left, right) => String(right.name || '').length - String(left.name || '').length)
    .find((model) => {
      const name = normalize(model.name)
      return name && normalizedQuestion.includes(name)
    }) || null
}

function finalModelLookup(finalDppAnalysis) {
  return new Map(
    (finalDppAnalysis?.models || []).map((model) => [normalize(model.name), model]),
  )
}

function changedRealModels(scenario, finalDppAnalysis) {
  const finalByName = finalModelLookup(finalDppAnalysis)
  return (scenario?.models || []).flatMap((model) => {
    const finalModel = finalByName.get(normalize(model.name))
    if (!finalModel) return []
    const orionReal = number(model.real)
    const finalReal = number(finalModel.real)
    if (Math.abs(orionReal - finalReal) <= 1e-4) return []
    return [{ name: model.name, orion: orionReal, final: finalReal, delta: finalReal - orionReal }]
  })
}

function materialEvidence(material) {
  if (!material) return []
  const evidence = [
    {
      label: 'Material',
      value: material.material || material.material_key || '—',
      detail: material.description || '',
    },
  ]

  if (material.nec !== undefined && material.nec !== null) {
    evidence.push({ label: 'NEC ORION', value: formatNumber(material.nec), detail: 'Motor determinístico' })
  }
  if (material.stock_total !== undefined && material.stock_total !== null) {
    evidence.push({ label: 'STK TTL ORION', value: formatNumber(material.stock_total), detail: 'Cenário atual' })
  }
  if (material.balance !== undefined && material.balance !== null) {
    evidence.push({ label: 'SALDO ORION', value: formatNumber(material.balance), detail: 'STK TTL − NEC' })
  }
  return evidence
}

function isWorkspaceDataQuestion(question, scenario) {
  const q = normalize(question)
  if (findMaterial(question, scenario?.materials || [])) return true
  if (findModel(question, scenario?.models || [])) return true
  if (q.includes('quant') && q.includes('material')) return true
  if (q.includes('real') && (q.includes('diverg') || q.includes('difer') || q.includes('mud'))) return true
  if (q.includes('cenario atual') || q.includes('cenário atual')) return true
  if (q.includes('dpp final') && (q.includes('quant') || q.includes('valor') || q.includes('difer'))) return true
  return false
}

function workspaceUnavailableAnswer(dppState) {
  const bundle = dppState?.bundle
  return {
    text: 'O cenário ORION ainda não está disponível para o pacote atual do DPP. Para responder sobre valores do mês, materiais ou modelos, complete ou reprocesse o pacote na aba DPP.',
    evidence: [
      {
        label: 'Pacote atual',
        value: formatMonth(dppState?.currentMonth),
        detail: `${bundle?.recognized || 0} arquivo(s) reconhecido(s) de ${bundle?.total || 0}`,
      },
    ],
    sources: ['Workspace compartilhado do DPP'],
    entities: [],
    tool: 'workspace_status',
    confidence: 'Determinística',
  }
}

function staleWorkspaceAnswer(dppState) {
  const bundle = dppState?.bundle
  return {
    text: 'O pacote compartilhado da aba DPP mudou desde o último processamento. Para não misturar dados antigos com os arquivos atuais, o Agente ORION bloqueou esta consulta de dados mensais até o cenário ser recalculado.',
    evidence: [
      {
        label: 'Pacote atual',
        value: formatMonth(dppState?.currentMonth),
        detail: `${bundle?.recognized || 0} arquivo(s) reconhecido(s) de ${bundle?.total || 0}`,
      },
      {
        label: 'Cenário',
        value: 'Desatualizado',
        detail: 'A assinatura do cenário não corresponde ao pacote DPP atual.',
      },
    ],
    sources: ['Workspace compartilhado do DPP'],
    entities: [],
    tool: 'workspace_sync_guard',
    confidence: 'Determinística',
  }
}

function workspaceAnswer(question, { scenario, finalDppAnalysis, referenceMonth }) {
  if (!scenario) return null

  const q = normalize(question)
  const materials = scenario?.materials || []
  const models = scenario?.models || []
  const material = findMaterial(question, materials)
  const model = findModel(question, models)
  const changedModels = changedRealModels(scenario, finalDppAnalysis)
  const month = referenceMonth || scenario?.reference_month || finalDppAnalysis?.column_comparison?.reference_month || ''
  const sources = [`Cenário ORION · ${formatMonth(month)}`]
  const entities = []
  const evidence = []
  if (finalDppAnalysis) sources.push(`DPP Final · ${formatMonth(month)}`)

  if (material && q.includes('nec') && (q.includes('diverg') || q.includes('difer') || q.includes('mud'))) {
    entities.push(material.material || material.material_key, 'NEC')
    evidence.push(...materialEvidence(material))
    changedModels.slice(0, 6).forEach((item) => {
      evidence.push({
        label: item.name,
        value: `${formatNumber(item.orion)} → ${formatNumber(item.final)}`,
        detail: `REAL · Δ ${item.delta > 0 ? '+' : ''}${formatNumber(item.delta)}`,
      })
    })

    if (changedModels.length) {
      return {
        text: `Há ${changedModels.length} modelo(s) com alteração de REAL entre o Cenário ORION e o DPP Final sincronizado. Como NEC depende de REAL × consumo, essas alterações são causas determinísticas que devem ser verificadas para este material.`,
        evidence,
        sources,
        entities,
        tool: 'compare_real_models + get_material',
        confidence: 'Determinística',
      }
    }
  }

  if (material) {
    const usedModels = Object.entries(material.consumption_by_model || {})
      .filter(([, usage]) => Math.abs(number(usage)) > 1e-9)
      .map(([name]) => name)

    entities.push(material.material || material.material_key)
    evidence.push(...materialEvidence(material))
    if (usedModels.length) {
      evidence.push({
        label: 'Modelos relacionados',
        value: `${usedModels.length}`,
        detail: usedModels.slice(0, 5).join(' · '),
      })
    }

    return {
      text: `Encontrei o material ${material.material || material.material_key}${material.description ? ` — ${material.description}` : ''}. No cenário atual, NEC = ${formatNumber(material.nec)}, STK TTL = ${formatNumber(material.stock_total)} e SALDO = ${formatNumber(material.balance)}.`,
      evidence,
      sources,
      entities,
      tool: 'get_material',
      confidence: 'Determinística',
    }
  }

  if (model) {
    const finalModel = finalModelLookup(finalDppAnalysis).get(normalize(model.name))
    const orionReal = number(model.real)
    const kitPgd = number(model.kit_pgd)
    const finalReal = finalModel ? number(finalModel.real) : null

    entities.push(model.name)
    evidence.push(
      { label: 'Modelo', value: model.name, detail: 'Cenário mensal' },
      { label: 'KIT disponível PGD', value: formatNumber(kitPgd), detail: 'Cenário ORION' },
      { label: 'REAL ORION', value: formatNumber(orionReal), detail: 'Cenário atual' },
    )
    if (finalReal !== null) {
      evidence.push({ label: 'REAL DPP Final', value: formatNumber(finalReal), detail: `Δ ${formatNumber(finalReal - orionReal)}` })
    }

    return {
      text: finalReal === null
        ? `O modelo ${model.name} possui KIT disponível PGD de ${formatNumber(kitPgd)} e REAL atual de ${formatNumber(orionReal)}. O DPP Final sincronizado não está disponível para comparação.`
        : `O modelo ${model.name} possui KIT disponível PGD de ${formatNumber(kitPgd)}, REAL ORION de ${formatNumber(orionReal)} e REAL no DPP Final de ${formatNumber(finalReal)}.`,
      evidence,
      sources,
      entities,
      tool: 'get_model + compare_final_model',
      confidence: 'Determinística',
    }
  }

  if (q.includes('quant') && q.includes('material') && (q.includes('critic') || q.includes('investigar'))) {
    const critical = materials.filter((item) => item.status === 'INVESTIGAR')
    const finalCritical = finalDppAnalysis?.summary?.critical_materials
    return {
      text: finalCritical === undefined
        ? `O cenário ORION atual possui ${critical.length} material(is) classificados para investigar.`
        : `O cenário ORION atual possui ${critical.length} material(is) classificados para investigar. No DPP Final sincronizado há ${formatNumber(finalCritical)} material(is) críticos.`,
      evidence: [
        { label: 'Cenário ORION', value: `${critical.length}`, detail: 'Materiais para investigar' },
        ...(finalCritical === undefined ? [] : [{ label: 'DPP Final', value: formatNumber(finalCritical), detail: 'Materiais críticos' }]),
      ],
      sources,
      entities: ['Materiais críticos'],
      tool: 'get_critical_materials',
      confidence: 'Determinística',
    }
  }

  if (q.includes('quant') && q.includes('material')) {
    const finalTotal = finalDppAnalysis?.summary?.total_materials
    return {
      text: finalTotal === undefined
        ? `O cenário ORION atual possui ${materials.length} materiais.`
        : `O cenário ORION atual possui ${materials.length} materiais e o DPP Final sincronizado possui ${formatNumber(finalTotal)} materiais.`,
      evidence: [
        { label: 'Cenário ORION', value: formatNumber(materials.length), detail: 'Materiais' },
        ...(finalTotal === undefined ? [] : [{ label: 'DPP Final', value: formatNumber(finalTotal), detail: 'Materiais' }]),
      ],
      sources,
      entities: ['Materiais'],
      tool: 'get_scenario_summary',
      confidence: 'Determinística',
    }
  }

  if (q.includes('real') && (q.includes('diverg') || q.includes('difer') || q.includes('mud'))) {
    return {
      text: finalDppAnalysis
        ? `Encontrei ${changedModels.length} modelo(s) com REAL diferente entre o Cenário ORION e o DPP Final sincronizado.`
        : 'O DPP Final sincronizado ainda não está disponível para o pacote atual, então não há uma segunda referência válida para comparar o REAL.',
      evidence: changedModels.slice(0, 8).map((item) => ({
        label: item.name,
        value: `${formatNumber(item.orion)} → ${formatNumber(item.final)}`,
        detail: `Δ ${item.delta > 0 ? '+' : ''}${formatNumber(item.delta)}`,
      })),
      sources,
      entities: changedModels.map((item) => item.name),
      tool: 'compare_real_models',
      confidence: 'Determinística',
    }
  }

  return null
}

async function knowledgeAnswer(apiUrl, question) {
  try {
    const response = await fetch(`${apiUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.detail || 'Não foi possível consultar a base de conhecimento do ORION.')

    const sources = payload.knowledge_sources || []
    const localRag = payload.provider === 'local-rag'
    return {
      text: payload.answer,
      evidence: sources.map((source) => ({
        label: 'Base de conhecimento',
        value: source,
        detail: localRag ? 'Trecho recuperado localmente pelo backend' : 'Contexto fornecido à LLM',
      })),
      sources,
      entities: [],
      tool: localRag ? 'rag_local_lexical' : `llm_rag:${payload.provider}`,
      confidence: localRag ? 'Conhecimento validado' : 'LLM + RAG',
    }
  } catch (error) {
    return {
      text: `Não consegui consultar a base de conhecimento do backend: ${error.message || 'falha desconhecida'}`,
      evidence: [],
      sources: [],
      entities: [],
      tool: 'rag_backend',
      confidence: 'Indisponível',
    }
  }
}

const SUGGESTIONS = [
  'Qual a fórmula para calcular NEC?',
  'Como o ORION calcula o STK TTL?',
  'Quando um material é considerado crítico?',
  'Como o CHECK é comparado?',
]

function scenarioStatusText(state) {
  if (state === 'current') return 'Cenário ORION sincronizado'
  if (state === 'stale') return 'Cenário ORION desatualizado'
  if (state === 'restoring') return 'Restaurando cenário ORION'
  return 'Cenário ORION indisponível'
}

function finalStatusText(state) {
  if (state === 'current') return 'DPP Final sincronizado'
  if (state === 'stale') return 'DPP Final desatualizado'
  if (state === 'pending') return 'DPP Final aguardando análise'
  if (state === 'waiting-scenario') return 'DPP Final aguardando cenário atual'
  if (state === 'restoring') return 'Restaurando DPP Final'
  return 'DPP Final não carregado'
}

function packageStatusText(state) {
  if (state === 'ready') return 'Pacote DPP completo'
  if (state === 'incomplete') return 'Pacote DPP incompleto'
  if (state === 'restoring') return 'Restaurando pacote DPP'
  return 'Pacote DPP não carregado'
}

function AgentOrion({ apiUrl }) {
  const {
    generatedScenario,
    finalDppAnalysis,
    referenceMonth,
    workspaceReady,
    dppState,
  } = useDppWorkspace()
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [knowledgeStatus, setKnowledgeStatus] = useState({ state: 'checking', documents: 0 })
  const [messages, setMessages] = useState(() => [
    {
      id: 'initial',
      role: 'orion',
      text: 'Estou ligado ao mesmo workspace da aba DPP e à base de conhecimento validada do motor Python. Perguntas sobre valores do mês usam o cenário sincronizado; perguntas sobre regras e fórmulas usam o RAG local do backend.',
      evidence: [],
      sources: ['Workspace compartilhado do DPP', 'Base de conhecimento local'],
      entities: [],
      tool: 'workspace_status + rag_status',
      confidence: 'Determinística',
    },
  ])
  const messageListRef = useRef(null)
  const latestAnswerRef = useRef(null)

  const month = dppState?.currentMonth
    || referenceMonth
    || generatedScenario?.reference_month
    || finalDppAnalysis?.column_comparison?.reference_month
    || ''
  const currentAnswer = [...messages].reverse().find((message) => message.role === 'orion') || messages[0]
  const scenarioReady = dppState?.scenario?.current ?? Boolean(generatedScenario)
  const finalReady = dppState?.finalDpp?.current ?? Boolean(finalDppAnalysis)
  const scenarioForChat = scenarioReady ? generatedScenario : null
  const finalForChat = finalReady ? finalDppAnalysis : null

  const contextSummary = useMemo(() => ({
    materials: scenarioForChat?.materials?.length || 0,
    models: scenarioForChat?.models?.length || 0,
  }), [scenarioForChat])

  useEffect(() => {
    let cancelled = false

    async function loadKnowledgeStatus() {
      try {
        const response = await fetch(`${apiUrl}/api/knowledge/status`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.detail || 'Base indisponível')
        if (!cancelled) {
          setKnowledgeStatus({
            state: 'ready',
            documents: Number(payload.document_count) || 0,
            chunks: Number(payload.chunk_count) || 0,
          })
        }
      } catch {
        if (!cancelled) setKnowledgeStatus({ state: 'unavailable', documents: 0, chunks: 0 })
      }
    }

    loadKnowledgeStatus()
    return () => {
      cancelled = true
    }
  }, [apiUrl])

  useEffect(() => {
    if (messages.length <= 1) return
    const messageList = messageListRef.current
    const latestAnswer = latestAnswerRef.current
    if (!messageList || !latestAnswer) return

    const listRect = messageList.getBoundingClientRect()
    const answerRect = latestAnswer.getBoundingClientRect()
    const targetTop = messageList.scrollTop + (answerRect.top - listRect.top) - 8

    messageList.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: 'smooth',
    })
  }, [messages])

  async function submitQuestion(value = question) {
    const trimmed = String(value || '').trim()
    if (!trimmed || asking) return

    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: trimmed }
    setMessages((current) => [...current, userMessage])
    setQuestion('')
    setAsking(true)

    const workspaceDependent = isWorkspaceDataQuestion(trimmed, generatedScenario)
    let answer

    if (workspaceDependent && dppState?.scenario?.state === 'stale') {
      answer = staleWorkspaceAnswer(dppState)
    } else if (workspaceDependent && !scenarioForChat) {
      answer = workspaceUnavailableAnswer(dppState)
    } else {
      answer = workspaceAnswer(trimmed, {
        scenario: scenarioForChat,
        finalDppAnalysis: finalForChat,
        referenceMonth: month,
      })
      if (!answer) answer = await knowledgeAnswer(apiUrl, trimmed)
    }

    const assistantMessage = { id: `orion-${Date.now() + 1}`, role: 'orion', ...answer }
    setMessages((current) => [...current, assistantMessage])
    setAsking(false)
  }

  function handleSubmit(event) {
    event.preventDefault()
    submitQuestion()
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitQuestion()
    }
  }

  const packageState = dppState?.packageState || (workspaceReady ? 'empty' : 'restoring')
  const scenarioState = dppState?.scenario?.state || (scenarioReady ? 'current' : 'missing')
  const finalState = dppState?.finalDpp?.state || (finalReady ? 'current' : 'missing-file')
  const statusContext = !workspaceReady
    ? 'Restaurando workspace'
    : scenarioState === 'current'
      ? 'Sincronizado com a aba DPP'
      : scenarioState === 'stale'
        ? 'Pacote alterado · reprocessamento necessário'
        : 'Conhecimento disponível · cenário mensal pendente'
  const knowledgeStatusText = knowledgeStatus.state === 'ready'
    ? `RAG local · ${knowledgeStatus.documents} documento(s)`
    : knowledgeStatus.state === 'checking'
      ? 'Verificando base de conhecimento'
      : 'Base de conhecimento indisponível'

  return (
    <section className="agent-orion-page" aria-labelledby="agent-orion-title">
      <header className="agent-orion-header">
        <div>
          <span className="agent-orion-kicker">CONSULTA OPERACIONAL</span>
          <h2 id="agent-orion-title">Agente ORION</h2>
          <p>Consulte o mesmo cenário da área DPP e o conhecimento validado do motor determinístico Python. A LLM externa continua desativada nesta etapa.</p>
        </div>
        <div className="agent-orion-context" aria-label="Contexto atual do agente">
          <strong>{formatMonth(month)}</strong>
          <span>{statusContext}</span>
        </div>
      </header>

      <div className="agent-orion-statusline" aria-label="Estado das fontes compartilhadas com o DPP">
        <span><i data-state={packageState === 'ready' ? 'ready' : 'pending'} aria-hidden="true" />{packageStatusText(packageState)}</span>
        <span><i data-state={scenarioState === 'current' ? 'ready' : 'pending'} aria-hidden="true" />{scenarioStatusText(scenarioState)}</span>
        <span><i data-state={finalState === 'current' ? 'ready' : 'pending'} aria-hidden="true" />{finalStatusText(finalState)}</span>
        <span><i data-state={knowledgeStatus.state === 'ready' ? 'ready' : 'pending'} aria-hidden="true" />{knowledgeStatusText}</span>
      </div>

      <div className="agent-orion-layout">
        <section className="agent-conversation" aria-label="Conversa com o Agente ORION">
          <div className="agent-conversation-head">
            <div>
              <strong>Conversa</strong>
              <span>Dados mensais vêm do workspace DPP; regras e fórmulas vêm da base local validada.</span>
            </div>
            <small>{contextSummary.materials} materiais · {contextSummary.models} modelos</small>
          </div>

          <div className="agent-message-list" aria-live="polite" ref={messageListRef}>
            {messages.map((message) => {
              const latestOrionAnswer = message.role === 'orion' && message.id === currentAnswer.id
              return (
                <article
                  className="agent-message"
                  data-role={message.role}
                  key={message.id}
                  ref={latestOrionAnswer ? latestAnswerRef : null}
                >
                  <div className="agent-message-author">{message.role === 'orion' ? 'ORION' : 'Você'}</div>
                  <p>{message.text}</p>
                  {message.role === 'orion' && message.confidence && (
                    <div className="agent-message-meta">
                      <span>Tipo de resposta: {message.confidence}</span>
                      {message.tool && <span>Ferramenta: {message.tool}</span>}
                    </div>
                  )}
                </article>
              )
            })}
            {asking && (
              <article className="agent-message" data-role="orion">
                <div className="agent-message-author">ORION</div>
                <p>Consultando o motor e a base de conhecimento local...</p>
              </article>
            )}
          </div>

          <div className="agent-suggestions" aria-label="Perguntas para testar o agente">
            {SUGGESTIONS.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => submitQuestion(suggestion)} disabled={asking}>
                {suggestion}
              </button>
            ))}
          </div>

          <form className="agent-composer" onSubmit={handleSubmit}>
            <label htmlFor="agent-orion-input">Pergunte sobre materiais, modelos, cálculos, divergências, regras ou funcionamento do ORION</label>
            <div>
              <textarea
                id="agent-orion-input"
                rows="2"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ex.: Qual a fórmula para calcular NEC?"
                disabled={asking}
              />
              <button type="submit" disabled={!question.trim() || asking}>{asking ? 'Consultando' : 'Enviar'}</button>
            </div>
            <small>Enter envia · Shift + Enter cria uma nova linha</small>
          </form>
        </section>

        <aside className="agent-evidence" aria-label="Evidências e inspeção da resposta">
          <section>
            <div className="agent-section-heading">
              <strong>Evidências</strong>
              <span>{currentAnswer.evidence?.length || 0} utilizadas</span>
            </div>
            {currentAnswer.evidence?.length ? (
              <div className="agent-evidence-list">
                {currentAnswer.evidence.map((item, index) => (
                  <article key={`${item.label}-${index}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="agent-empty-evidence">Faça uma consulta para ver os dados ou documentos usados na resposta.</p>
            )}
          </section>

          <section className="agent-inspector">
            <div className="agent-section-heading">
              <strong>Inspeção</strong>
              <span>Validação técnica</span>
            </div>
            <dl>
              <div>
                <dt>Fontes utilizadas</dt>
                <dd>{currentAnswer.sources?.length ? currentAnswer.sources.join(' · ') : '—'}</dd>
              </div>
              <div>
                <dt>Entidades encontradas</dt>
                <dd>{currentAnswer.entities?.length ? currentAnswer.entities.join(' · ') : 'Nenhuma'}</dd>
              </div>
              <div>
                <dt>Ferramenta consultada</dt>
                <dd>{currentAnswer.tool || '—'}</dd>
              </div>
              <div>
                <dt>Confiança</dt>
                <dd>{currentAnswer.confidence || '—'}</dd>
              </div>
              <div>
                <dt>Execução</dt>
                <dd>Local · workspace DPP + RAG lexical · sem LLM externa</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  )
}

export default AgentOrion
