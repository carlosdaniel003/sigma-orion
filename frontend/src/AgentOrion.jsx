import { useMemo, useState } from 'react'
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
    evidence.push({ label: 'STK TTL ORION', value: formatNumber(material.stock_total), detail: 'Cenário inicial' })
  }
  if (material.balance !== undefined && material.balance !== null) {
    evidence.push({ label: 'SALDO ORION', value: formatNumber(material.balance), detail: 'STK TTL − NEC' })
  }
  return evidence
}

function offlineAnswer(question, { scenario, finalDppAnalysis, referenceMonth }) {
  const q = normalize(question)
  const materials = scenario?.materials || []
  const models = scenario?.models || []
  const material = findMaterial(question, materials)
  const model = findModel(question, models)
  const changedModels = changedRealModels(scenario, finalDppAnalysis)
  const month = referenceMonth || scenario?.reference_month || finalDppAnalysis?.column_comparison?.reference_month || ''
  const sources = []
  const entities = []
  const evidence = []

  if (!scenario) {
    return {
      text: 'O cenário ORION ainda não está disponível neste workspace. Carregue e processe o pacote mensal para habilitar consultas determinísticas sobre materiais, modelos e cálculos.',
      evidence: [],
      sources: ['Workspace local'],
      entities: [],
      tool: 'workspace_status',
      confidence: 'Determinística',
    }
  }

  sources.push(`Cenário ORION · ${formatMonth(month)}`)
  if (finalDppAnalysis) sources.push(`DPP Final · ${formatMonth(month)}`)

  if ((q.includes('como') || q.includes('regra') || q.includes('calcula')) && q.includes('nec')) {
    return {
      text: 'O ORION calcula NEC por material usando NEC = Σ(REAL do modelo × consumo do material naquele modelo). O cálculo permanece no motor Python; esta tela apenas consulta e apresenta o resultado.',
      evidence: [
        { label: 'Regra', value: 'NEC = Σ(REAL × consumo)', detail: 'Cálculo determinístico em Python' },
      ],
      sources: ['Regra determinística NEC'],
      entities: ['NEC'],
      tool: 'get_rule(nec)',
      confidence: 'Determinística',
    }
  }

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
        text: `Há ${changedModels.length} modelo(s) com alteração de REAL entre o cenário inicial e o DPP Final. Como o NEC depende de REAL × consumo, essas alterações são a primeira causa determinística a ser verificada para este material. A etapa seguinte do RAG poderá recuperar a explicação linha a linha já produzida pelo comparativo.`,
        evidence,
        sources: [...sources, 'Regra determinística NEC'],
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
      text: `Encontrei o material ${material.material || material.material_key}${material.description ? ` — ${material.description}` : ''}. No cenário inicial, NEC = ${formatNumber(material.nec)}, STK TTL = ${formatNumber(material.stock_total)} e SALDO = ${formatNumber(material.balance)}.`,
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
      { label: 'REAL ORION', value: formatNumber(orionReal), detail: 'Cenário inicial' },
    )
    if (finalReal !== null) {
      evidence.push({ label: 'REAL DPP Final', value: formatNumber(finalReal), detail: `Δ ${formatNumber(finalReal - orionReal)}` })
    }

    return {
      text: finalReal === null
        ? `O modelo ${model.name} possui KIT disponível PGD de ${formatNumber(kitPgd)} e REAL inicial de ${formatNumber(orionReal)}. O DPP Final não está disponível para comparação neste workspace.`
        : `O modelo ${model.name} possui KIT disponível PGD de ${formatNumber(kitPgd)}, REAL inicial de ${formatNumber(orionReal)} e REAL no DPP Final de ${formatNumber(finalReal)}.`,
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
        ? `O cenário inicial possui ${critical.length} material(is) classificados para investigar.`
        : `O cenário inicial possui ${critical.length} material(is) classificados para investigar. No DPP Final há ${formatNumber(finalCritical)} material(is) críticos pela mesma regra operacional.`,
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
        ? `O cenário ORION possui ${materials.length} materiais.`
        : `O cenário ORION possui ${materials.length} materiais e o DPP Final possui ${formatNumber(finalTotal)} materiais.`,
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
        ? `Encontrei ${changedModels.length} modelo(s) com REAL diferente entre o cenário inicial e o DPP Final.`
        : 'O DPP Final ainda não está disponível neste workspace, então não há uma segunda referência para comparar o REAL.',
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

  return {
    text: 'Nesta primeira versão offline eu ainda não interpreto linguagem livre com uma LLM. Já consigo consultar dados estruturados do cenário por material, modelo, quantidade de materiais, materiais críticos, diferenças de REAL e a regra do NEC. O próximo passo será ligar o retrieval/RAG a esta mesma interface.',
    evidence: [
      { label: 'Modo atual', value: 'Consulta determinística', detail: 'Sem LLM e sem acesso externo' },
      { label: 'Contexto', value: formatMonth(month), detail: `${materials.length} materiais · ${models.length} modelos` },
    ],
    sources,
    entities: [],
    tool: 'offline_router',
    confidence: 'Determinística',
  }
}

const SUGGESTIONS = [
  'Quantos materiais temos no cenário?',
  'Quantos materiais estão críticos?',
  'Quais modelos tiveram mudança de REAL?',
  'Como o ORION calcula o NEC?',
]

function AgentOrion() {
  const { generatedScenario, finalDppAnalysis, referenceMonth, workspaceReady } = useDppWorkspace()
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState(() => [
    {
      id: 'initial',
      role: 'orion',
      text: 'Estou em modo de validação offline. Posso consultar o cenário carregado e responder perguntas determinísticas sem LLM. As evidências usadas em cada resposta aparecem ao lado.',
      evidence: [],
      sources: ['Workspace local'],
      entities: [],
      tool: 'workspace_status',
      confidence: 'Determinística',
    },
  ])

  const month = referenceMonth || generatedScenario?.reference_month || finalDppAnalysis?.column_comparison?.reference_month || ''
  const currentAnswer = [...messages].reverse().find((message) => message.role === 'orion') || messages[0]
  const scenarioReady = Boolean(generatedScenario)
  const finalReady = Boolean(finalDppAnalysis)

  const contextSummary = useMemo(() => ({
    materials: generatedScenario?.materials?.length || 0,
    models: generatedScenario?.models?.length || 0,
  }), [generatedScenario])

  function submitQuestion(value = question) {
    const trimmed = String(value || '').trim()
    if (!trimmed) return

    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: trimmed }
    const answer = offlineAnswer(trimmed, {
      scenario: generatedScenario,
      finalDppAnalysis,
      referenceMonth: month,
    })
    const assistantMessage = { id: `orion-${Date.now() + 1}`, role: 'orion', ...answer }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setQuestion('')
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

  return (
    <section className="agent-orion-page" aria-labelledby="agent-orion-title">
      <header className="agent-orion-header">
        <div>
          <span className="agent-orion-kicker">CONSULTA OPERACIONAL</span>
          <h2 id="agent-orion-title">Agente ORION</h2>
          <p>Consulte o cenário, o DPP Final e as regras determinísticas. Nesta etapa, nenhuma LLM é utilizada.</p>
        </div>
        <div className="agent-orion-context" aria-label="Contexto atual do agente">
          <strong>{formatMonth(month)}</strong>
          <span>{workspaceReady ? (scenarioReady ? 'Cenário disponível' : 'Aguardando cenário') : 'Restaurando workspace'}</span>
        </div>
      </header>

      <div className="agent-orion-statusline" aria-label="Estado das fontes do agente">
        <span><i data-state={scenarioReady ? 'ready' : 'pending'} aria-hidden="true" />Cenário ORION {scenarioReady ? 'carregado' : 'indisponível'}</span>
        <span><i data-state={finalReady ? 'ready' : 'pending'} aria-hidden="true" />DPP Final {finalReady ? 'carregado' : 'indisponível'}</span>
        <span><i data-state="ready" aria-hidden="true" />Modo offline determinístico</span>
      </div>

      <div className="agent-orion-layout">
        <section className="agent-conversation" aria-label="Conversa com o Agente ORION">
          <div className="agent-conversation-head">
            <div>
              <strong>Conversa</strong>
              <span>Respostas baseadas somente no material já carregado no ORION.</span>
            </div>
            <small>{contextSummary.materials} materiais · {contextSummary.models} modelos</small>
          </div>

          <div className="agent-message-list" aria-live="polite">
            {messages.map((message) => (
              <article className="agent-message" data-role={message.role} key={message.id}>
                <div className="agent-message-author">{message.role === 'orion' ? 'ORION' : 'Você'}</div>
                <p>{message.text}</p>
                {message.role === 'orion' && message.confidence && (
                  <div className="agent-message-meta">
                    <span>Tipo de resposta: {message.confidence}</span>
                    {message.tool && <span>Ferramenta: {message.tool}</span>}
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="agent-suggestions" aria-label="Perguntas para testar o agente">
            {SUGGESTIONS.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => submitQuestion(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>

          <form className="agent-composer" onSubmit={handleSubmit}>
            <label htmlFor="agent-orion-input">Pergunte sobre materiais, modelos, divergências ou regras</label>
            <div>
              <textarea
                id="agent-orion-input"
                rows="2"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ex.: Quais modelos tiveram mudança de REAL?"
              />
              <button type="submit" disabled={!question.trim()}>Enviar</button>
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
              <p className="agent-empty-evidence">Faça uma consulta para ver os dados usados na resposta.</p>
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
                <dd>Local · sem LLM · sem rede externa</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  )
}

export default AgentOrion
