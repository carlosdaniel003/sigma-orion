import { useEffect, useMemo, useRef, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import './agent-orion.css'

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const CONTEXTUAL_COLUMN_NAMES = new Set(['coments', 'comments', 'comentario', 'comentarios'])

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

function resolveColumnMode(column) {
  if (column?.mode) return column.mode
  const name = normalize(column?.name)
  if (name === 'opc') return 'reference_final'
  if (CONTEXTUAL_COLUMN_NAMES.has(name)) return 'contextual'
  return column?.supported ? 'compare' : 'unsupported'
}

function comparisonColumns(finalDppAnalysis) {
  return (finalDppAnalysis?.column_comparison?.columns || []).map((column) => ({
    ...column,
    mode: resolveColumnMode(column),
  }))
}

function isDivergentColumn(column) {
  return column?.mode === 'compare'
    && Boolean(column?.supported)
    && (Math.abs(number(column?.delta)) > 1e-4 || number(column?.difference_count) > 0)
}

function findComparisonColumn(question, finalDppAnalysis) {
  const q = normalize(question)
  return comparisonColumns(finalDppAnalysis)
    .filter((column) => normalize(column.name).length >= 3)
    .sort((left, right) => normalize(right.name).length - normalize(left.name).length)
    .find((column) => q.includes(normalize(column.name))) || null
}

function isDivergenceDataRequest(question) {
  const q = normalize(question)
  if (!(q.includes('diverg') || q.includes('diferenc'))) return false
  return q.includes('quant')
    || q.includes('quais')
    || q.includes('lista')
    || q.includes('mostr')
    || q.includes('estao')
    || q.includes('tem ')
    || q.endsWith(' tem')
}

function isCriticalDataQuestion(question) {
  const q = normalize(question)
  if (!(q.includes('material') && (q.includes('critic') || q.includes('investigar')))) return false
  return q.includes('quant') || q.includes('quais') || q.includes('lista') || q.includes('mostr') || q.includes('estao')
}

function isWorkspaceDataQuestion(question, scenario, finalDppAnalysis) {
  const q = normalize(question)
  if (findMaterial(question, scenario?.materials || [])) return true
  if (findModel(question, scenario?.models || [])) return true
  if (isCriticalDataQuestion(question)) return true
  if (q.includes('quant') && q.includes('material')) return true
  if (q.includes('real') && (q.includes('diverg') || q.includes('difer') || q.includes('mud'))) return true
  if (q.includes('cenario atual')) return true
  if (isDivergenceDataRequest(question)) {
    if (q.includes('comparativo') || q.includes('comparacao') || q.includes('coluna') || q.includes('dpp final')) return true
    if (findComparisonColumn(question, finalDppAnalysis)) return true
  }
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

function comparisonSummaryAnswer(finalDppAnalysis, month) {
  if (!finalDppAnalysis?.column_comparison) {
    return {
      text: 'O DPP Final sincronizado ainda não possui o comparativo completo de colunas disponível para este pacote.',
      evidence: [],
      sources: [`DPP Final · ${formatMonth(month)}`],
      entities: ['Comparativo completo das colunas do DPP'],
      tool: 'get_column_comparison_summary',
      confidence: 'Determinística',
    }
  }

  const columns = comparisonColumns(finalDppAnalysis)
  const divergent = columns.filter(isDivergentColumn)
  const comparable = columns.filter((column) => column.mode === 'compare' && column.supported)
  const reference = columns.filter((column) => column.mode === 'reference_final')
  const contextual = columns.filter((column) => column.mode === 'contextual')
  const totalDifferences = divergent.reduce((total, column) => total + number(column.difference_count), 0)

  return {
    text: `O componente Comparativo completo das colunas do DPP possui ${columns.length} colunas, ${comparable.length} comparáveis e ${divergent.length} coluna(s) com divergência. Somando os registros de cada coluna divergente, há ${formatNumber(totalDifferences)} ocorrências de divergência de coluna; esse total não representa materiais únicos, pois o mesmo material pode divergir em mais de uma coluna.`,
    evidence: divergent.map((column) => ({
      label: column.name,
      value: `${formatNumber(column.difference_count)} divergência(s)`,
      detail: `Diferença agregada: ${formatNumber(column.delta)}`,
    })),
    sources: [`Comparativo DPP Final × Cenário ORION · ${formatMonth(month)}`],
    entities: ['Comparativo completo das colunas do DPP', ...divergent.map((column) => column.name)],
    tool: 'get_column_comparison_summary',
    confidence: 'Determinística',
    extra: { reference: reference.length, contextual: contextual.length },
  }
}

async function columnDivergenceAnswer(apiUrl, finalDppAnalysis, column, month) {
  const count = number(column?.difference_count)
  const source = `Comparativo DPP Final × Cenário ORION · ${formatMonth(month)}`

  if (!isDivergentColumn(column) || count <= 0) {
    return {
      text: `A coluna ${column?.name || 'solicitada'} não possui divergências no comparativo sincronizado atual.`,
      evidence: [],
      sources: [source],
      entities: [column?.name].filter(Boolean),
      tool: 'get_column_divergences',
      confidence: 'Determinística',
    }
  }

  const analysisId = finalDppAnalysis?.analysis_id || finalDppAnalysis?.column_comparison?.analysis_id
  if (!analysisId || !apiUrl) {
    return {
      text: `A coluna ${column.name} possui ${formatNumber(count)} divergência(s), mas o identificador de drill-down não está disponível para listar os materiais desta análise.`,
      evidence: [{ label: column.name, value: `${formatNumber(count)} divergência(s)`, detail: 'Resumo persistido do comparativo' }],
      sources: [source],
      entities: [column.name],
      tool: 'get_column_divergences',
      confidence: 'Determinística',
    }
  }

  try {
    const limit = Math.max(1, Math.min(100, Math.ceil(count)))
    const response = await fetch(
      `${apiUrl}/api/dpp/dashboard/final/${analysisId}/columns/${column.column}/divergences?offset=0&limit=${limit}`,
      { cache: 'no-store' },
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 404) {
        return {
          text: `A coluna ${column.name} possui ${formatNumber(count)} divergência(s), mas os detalhes desta análise expiraram da memória do backend. Execute novamente a análise do DPP Final para recriar o mesmo drill-down usado pelo componente Comparativo completo das colunas do DPP.`,
          evidence: [{ label: column.name, value: `${formatNumber(count)} divergência(s)`, detail: 'Contagem preservada; drill-down expirado' }],
          sources: [source],
          entities: [column.name],
          tool: 'get_column_divergences',
          confidence: 'Determinística',
        }
      }
      throw new Error(payload?.detail || 'Não foi possível carregar o drill-down desta coluna.')
    }

    const items = payload?.items || []
    const materialLabels = items.map((item) => item.material).filter(Boolean)
    const rendered = items.map((item) => {
      const delta = item.delta === null || item.delta === undefined ? '—' : formatNumber(item.delta)
      return `${item.material}: ORION ${item.orion_value ?? '—'} → Final ${item.final_value ?? '—'} (Δ ${delta})`
    })
    const suffix = count > items.length
      ? ` Foram retornadas as primeiras ${items.length} de ${formatNumber(count)} divergências.`
      : ''

    return {
      text: `A coluna ${column.name} possui ${formatNumber(count)} divergência(s). ${rendered.join('; ')}.${suffix}`,
      evidence: items.slice(0, 16).map((item) => ({
        label: item.material || column.name,
        value: `${item.orion_value ?? '—'} → ${item.final_value ?? '—'}`,
        detail: `Δ ${item.delta === null || item.delta === undefined ? '—' : formatNumber(item.delta)}${item.reason ? ` · ${item.reason}` : ''}`,
      })),
      sources: [source],
      entities: [column.name, ...materialLabels],
      tool: 'get_column_divergences',
      confidence: 'Determinística',
    }
  } catch (error) {
    return {
      text: `A coluna ${column.name} possui ${formatNumber(count)} divergência(s), mas não foi possível carregar os detalhes agora: ${error.message || 'falha desconhecida'}`,
      evidence: [{ label: column.name, value: `${formatNumber(count)} divergência(s)`, detail: 'Contagem do comparativo sincronizado' }],
      sources: [source],
      entities: [column.name],
      tool: 'get_column_divergences',
      confidence: 'Determinística',
    }
  }
}

async function workspaceAnswer(question, { scenario, finalDppAnalysis, referenceMonth, apiUrl }) {
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

  if (isDivergenceDataRequest(question)) {
    const column = findComparisonColumn(question, finalDppAnalysis)
    if (column) return columnDivergenceAnswer(apiUrl, finalDppAnalysis, column, month)

    if (q.includes('comparativo') || q.includes('comparacao') || q.includes('coluna') || q.includes('dpp final')) {
      return comparisonSummaryAnswer(finalDppAnalysis, month)
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

  if (isCriticalDataQuestion(question)) {
    const critical = materials.filter((item) => normalize(item.um) === 'un' && number(item.balance) < -1e-4)
    const finalCritical = finalDppAnalysis?.summary?.critical_materials
    const codes = critical.map((item) => item.material || item.material_key).filter(Boolean)
    const asksWhich = q.includes('quais') || q.includes('lista') || q.includes('mostr') || q.includes('estao')
    const listText = asksWhich && codes.length ? ` Materiais: ${codes.join(', ')}.` : ''
    const finalText = finalCritical === undefined
      ? ''
      : ` No DPP Final sincronizado, o resumo registra ${formatNumber(finalCritical)} material(is) críticos.`

    return {
      text: `O Cenário ORION atual possui ${critical.length} material(is) críticos pela regra UM = UN e SALDO < -0,0001.${finalText}${listText}`,
      evidence: critical.slice(0, 16).map((item) => ({
        label: item.material || item.material_key || 'Material',
        value: `SALDO ${formatNumber(item.balance)}`,
        detail: item.description || 'UM = UN',
      })),
      sources,
      entities: ['Materiais críticos', ...codes],
      tool: 'get_critical_materials',
      confidence: 'Determinística',
    }
  }

  if (q.includes('quant') && q.includes('material')) {
    const finalTotal = finalDppAnalysis?.summary?.total_materials
    return {
      text: finalTotal === undefined
        ? `O Cenário ORION atual possui ${materials.length} materiais.`
        : `O Cenário ORION atual possui ${materials.length} materiais e o DPP Final sincronizado possui ${formatNumber(finalTotal)} materiais.`,
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
    const supported = !localRag || sources.length > 0
    return {
      text: payload.answer,
      evidence: supported
        ? sources.map((source) => ({
            label: 'Base de conhecimento',
            value: source,
            detail: localRag ? 'Trecho recuperado localmente pelo backend' : 'Contexto fornecido à LLM',
          }))
        : [],
      sources,
      entities: [],
      tool: supported
        ? (localRag ? 'rag_local_lexical' : `llm_rag:${payload.provider}`)
        : 'knowledge_scope_guard',
      confidence: supported
        ? (localRag ? 'Conhecimento validado' : 'LLM + RAG')
        : 'Escopo não suportado',
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
  'O que significa WIU?',
  'Quais materiais estão críticos?',
  'Quantas colunas estão com divergência no comparativo?',
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

    const workspaceDependent = isWorkspaceDataQuestion(trimmed, generatedScenario, finalForChat)
    let answer

    if (workspaceDependent && dppState?.scenario?.state === 'stale') {
      answer = staleWorkspaceAnswer(dppState)
    } else if (workspaceDependent && !scenarioForChat) {
      answer = workspaceUnavailableAnswer(dppState)
    } else {
      answer = await workspaceAnswer(trimmed, {
        scenario: scenarioForChat,
        finalDppAnalysis: finalForChat,
        referenceMonth: month,
        apiUrl,
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
                <p>Consultando os dados DPP e a base de conhecimento local...</p>
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
                placeholder="Ex.: Quais divergências existem em STK OP?"
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
