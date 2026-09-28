import { useEffect, useMemo, useRef, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import {
  AGENT_CONVERSATION_TTL_MS,
  readAgentConversation,
  writeAgentConversation,
} from './agent-conversation-storage'
import './agent-orion.css'

function formatMonth(value) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return 'Mês não definido'
  const [year, month] = value.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

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

function databaseStatusText(status) {
  if (status.state === 'ready') {
    return `SQLite/RAG sincronizado · ${status.runtimeEntities || status.runtimeDocuments || 0} entidade(s) atual(is)`
  }
  if (status.state === 'syncing') return 'Sincronizando SQLite/RAG'
  if (status.state === 'error') return 'SQLite/RAG indisponível'
  return 'Verificando SQLite/RAG'
}

function buildWorkspaceVersion({ month, scenario, finalDpp, packageState, scenarioState, finalState }) {
  const modelState = (scenario?.models || [])
    .map((model) => `${model?.name || ''}:${Number(model?.real) || 0}:${Number(model?.kit_pgd) || 0}`)
    .join('|')
  return [
    month || '',
    scenario?.scenario_id || '',
    modelState,
    finalDpp?.analysis_id || '',
    finalDpp?.filename || '',
    packageState || '',
    scenarioState || '',
    finalState || '',
  ].join('::')
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `orion-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createInitialAgentMessage() {
  return {
    id: 'initial',
    role: 'orion',
    text: 'Pergunte livremente sobre materiais, modelos, regras, fórmulas, cálculos, fontes, divergências e qualquer conhecimento indexado no ORION. Quando a pergunta envolver dados do mês, respondo a partir do Cenário ORION e do DPP Final sincronizados.',
    evidence: [],
    sources: [],
    entities: [],
    tool: 'sqlite_sql + fts5_bm25',
    confidence: 'Banco RAG',
    auditId: null,
  }
}

function createFreshConversation(now = Date.now()) {
  return {
    sessionId: createSessionId(),
    createdAt: now,
    expiresAt: now + AGENT_CONVERSATION_TTL_MS,
    updatedAt: now,
    messages: [createInitialAgentMessage()],
  }
}

function responseType(payload) {
  if (payload.model === 'deterministic-router') return 'Conversacional'
  if (payload.model === 'deterministic-status-registry' || payload.model === 'deterministic-rule-registry') return 'Determinística'
  if (payload.llm_used) return `SQLite/RAG + ${payload.llm_provider || 'LLM local'}`
  if (payload.knowledge_sources?.length) return 'Fundamentada no SQLite/RAG'
  return 'Sem evidência suficiente'
}

function MessageDataTable({ table }) {
  const rows = table?.rows || []
  const columns = table?.columns || []
  if (!rows.length || !columns.length) return null
  const totalRows = Number(table.total_rows) || rows.length

  return (
    <div className="agent-data-table-block">
      <div className="agent-data-table-caption">
        <strong>{table.title || 'Dados da consulta'}</strong>
        <span>{rows.length === totalRows ? `${totalRows} linha(s)` : `${rows.length} de ${totalRows} linha(s)`}</span>
      </div>
      <div className="agent-data-table-wrap" role="region" aria-label={table.title || 'Tabela da resposta'} tabIndex="0">
        <table className="agent-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" data-align={column.align || 'left'}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${row.material || row.source || row.column || 'row'}-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={column.key} data-align={column.align || 'left'} data-kind={column.kind || 'text'}>
                    {row[column.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
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
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const [conversationReady, setConversationReady] = useState(false)
  const [conversationCreatedAt, setConversationCreatedAt] = useState(0)
  const [conversationExpiresAt, setConversationExpiresAt] = useState(0)
  const [databaseStatus, setDatabaseStatus] = useState({ state: 'checking', runtimeDocuments: 0, runtimeEntities: 0, database: 'orion.db' })
  const [messages, setMessages] = useState(() => [createInitialAgentMessage()])

  const messageListRef = useRef(null)
  const latestMessageRef = useRef(null)
  const syncedVersionRef = useRef('')
  const sessionIdRef = useRef('')
  const conversationUpdatedAtRef = useRef(0)

  const month = dppState?.currentMonth
    || referenceMonth
    || generatedScenario?.reference_month
    || finalDppAnalysis?.column_comparison?.reference_month
    || ''

  const scenarioReady = dppState?.scenario?.current ?? Boolean(generatedScenario)
  const finalReady = dppState?.finalDpp?.current ?? Boolean(finalDppAnalysis)
  const scenarioForDatabase = scenarioReady ? generatedScenario : null
  const finalForDatabase = finalReady ? finalDppAnalysis : null
  const packageState = dppState?.packageState || (workspaceReady ? 'empty' : 'restoring')
  const scenarioState = dppState?.scenario?.state || (scenarioReady ? 'current' : 'missing')
  const finalState = dppState?.finalDpp?.state || (finalReady ? 'current' : 'missing-file')

  const workspacePayload = useMemo(() => ({
    month,
    state: {
      package: packageState,
      scenario: scenarioState,
      final_dpp: finalState,
    },
    scenario: scenarioForDatabase,
    final_dpp: finalForDatabase,
  }), [month, packageState, scenarioState, finalState, scenarioForDatabase, finalForDatabase])

  const workspaceVersion = useMemo(() => buildWorkspaceVersion({
    month,
    scenario: scenarioForDatabase,
    finalDpp: finalForDatabase,
    packageState,
    scenarioState,
    finalState,
  }), [month, scenarioForDatabase, finalDppAnalysis, finalState, packageState, scenarioState, scenarioForDatabase, finalDppAnalysis])

  const currentAnswer = [...messages].reverse().find((message) => message.role === 'orion') || messages[0]
  const materials = scenarioForDatabase?.materials?.length || 0
  const models = scenarioForDatabase?.models?.length || 0

  function activateConversation(conversation) {
    const safeMessages = Array.isArray(conversation?.messages) && conversation.messages.length
      ? conversation.messages
      : [createInitialAgentMessage()]
    sessionIdRef.current = conversation.sessionId
    conversationUpdatedAtRef.current = Number(conversation.updatedAt) || Number(conversation.createdAt) || Date.now()
    setConversationCreatedAt(Number(conversation.createdAt) || Date.now())
    setConversationExpiresAt(Number(conversation.expiresAt) || (Date.now() + AGENT_CONVERSATION_TTL_MS))
    setMessages(safeMessages)
    return { ...conversation, messages: safeMessages }
  }

  function resetExpiredConversation() {
    const fresh = createFreshConversation()
    activateConversation(fresh)
    writeAgentConversation(fresh).catch((error) => {
      console.warn('Não foi possível persistir a nova conversa do Agente ORION:', error)
    })
    return fresh
  }

  async function synchronizeWorkspace(payload = workspacePayload, version = workspaceVersion, signal = undefined) {
    setDatabaseStatus((current) => ({ ...current, state: 'syncing' }))
    const response = await fetch(`${apiUrl}/api/knowledge/workspace/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal,
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(result?.detail || 'Não foi possível sincronizar o workspace com o banco RAG.')
    }
    syncedVersionRef.current = version
    setDatabaseStatus({
      state: 'ready',
      runtimeDocuments: Number(result.runtime_document_count) || 0,
      runtimeEntities: Number(result.runtime_entity_count) || 0,
      documents: Number(result.document_count) || 0,
      chunks: Number(result.chunk_count) || 0,
      database: result.database || 'orion.db',
      fingerprint: result.workspace_fingerprint || '',
    })
    return result
  }

  useEffect(() => {
    let cancelled = false

    async function restoreConversation() {
      try {
        const stored = await readAgentConversation()
        if (cancelled) return
        const active = stored || createFreshConversation()
        activateConversation(active)
        if (!stored) {
          await writeAgentConversation(active)
        }
        if (navigator.storage?.persist) {
          navigator.storage.persist().catch(() => {})
        }
      } catch (error) {
        if (cancelled) return
        const fresh = createFreshConversation()
        activateConversation(fresh)
        console.warn('Não foi possível restaurar a conversa do Agente ORION:', error)
      } finally {
        if (!cancelled) setConversationReady(true)
      }
    }

    restoreConversation()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!conversationReady || !conversationCreatedAt || !conversationExpiresAt || !sessionIdRef.current) return
    const updatedAt = Date.now()
    conversationUpdatedAtRef.current = updatedAt
    writeAgentConversation({
      sessionId: sessionIdRef.current,
      createdAt: conversationCreatedAt,
      expiresAt: conversationExpiresAt,
      updatedAt,
      messages,
    }).catch((error) => {
      console.warn('Não foi possível persistir a conversa do Agente ORION:', error)
    })
  }, [messages, conversationReady, conversationCreatedAt, conversationExpiresAt])

  useEffect(() => {
    if (!conversationReady || !conversationExpiresAt) return undefined
    const remaining = conversationExpiresAt - Date.now()
    if (remaining <= 0) {
      resetExpiredConversation()
      return undefined
    }
    const timer = window.setTimeout(() => {
      resetExpiredConversation()
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [conversationReady, conversationExpiresAt])

  useEffect(() => {
    const controller = new AbortController()
    synchronizeWorkspace(workspacePayload, workspaceVersion, controller.signal).catch((error) => {
      if (error.name === 'AbortError') return
      setDatabaseStatus((current) => ({ ...current, state: 'error', error: error.message }))
    })
    return () => controller.abort()
  }, [apiUrl, workspacePayload, workspaceVersion])

  useEffect(() => {
    if (messages.length <= 1) return
    const messageList = messageListRef.current
    const latestMessage = latestMessageRef.current
    if (!messageList || !latestMessage) return

    const listRect = messageList.getBoundingClientRect()
    const messageRect = latestMessage.getBoundingClientRect()
    const targetTop = messageList.scrollTop + (messageRect.top - listRect.top) - 8
    messageList.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' })
  }, [messages])

  async function askDatabase(questionText) {
    const response = await fetch(`${apiUrl}/api/knowledge/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: questionText, session_id: sessionIdRef.current }),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.detail || 'Não foi possível consultar o banco RAG do ORION.')
    }

    const retrieval = payload.retrieval || []
    return {
      text: payload.answer,
      table: payload.table || null,
      evidence: retrieval.map((item) => ({
        label: item.heading || 'Trecho recuperado',
        value: item.source,
        detail: `${item.category || 'knowledge'} · score ${Number(item.score || 0).toFixed(4)}`,
      })),
      sources: payload.knowledge_sources || [],
      entities: payload.entities || [],
      tool: payload.model || 'sqlite-fts5-bm25+sql',
      confidence: responseType(payload),
      auditId: payload.audit_id || null,
      database: payload.database || 'orion.db',
      fingerprint: payload.workspace_fingerprint || '',
      resolvedQuestion: payload.resolved_question || questionText,
    }
  }

  async function submitQuestion(value = question) {
    const trimmed = String(value || '').trim()
    if (!trimmed || asking || !conversationReady) return

    const now = Date.now()
    const freshConversation = !conversationExpiresAt || now >= conversationExpiresAt
      ? resetExpiredConversation()
      : null
    const userMessage = { id: `user-${now}`, role: 'user', text: trimmed }
    if (freshConversation) {
      setMessages([...freshConversation.messages, userMessage])
    } else {
      setMessages((current) => [...current, userMessage])
    }
    setQuestion('')
    setAsking(true)

    try {
      if (syncedVersionRef.current !== workspaceVersion) {
        await synchronizeWorkspace(workspacePayload, workspaceVersion)
      }
      const answer = await askDatabase(trimmed)
      setMessages((current) => [...current, { id: `orion-${Date.now() + 1}`, role: 'orion', ...answer }])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `orion-${Date.now() + 1}`,
          role: 'orion',
          text: `Não foi possível consultar o banco RAG sincronizado: ${error.message || 'falha desconhecida'}`,
          evidence: [],
          sources: [],
          entities: [],
          tool: 'sqlite-fts5-bm25+sql',
          confidence: 'Indisponível',
          auditId: null,
        },
      ])
    } finally {
      setAsking(false)
    }
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

  const statusContext = !workspaceReady
    ? 'Restaurando workspace'
    : databaseStatus.state === 'ready'
      ? 'Banco RAG sincronizado com a aba DPP'
      : databaseStatus.state === 'error'
        ? 'Falha de sincronização com o banco RAG'
        : 'Sincronizando conhecimento atual'

  return (
    <section className="agent-orion-page" aria-labelledby="agent-orion-title">
      <header className="agent-orion-header">
        <div>
          <span className="agent-orion-kicker">ASSISTENTE DE ANÁLISE DPP</span>
          <h2 id="agent-orion-title">Agente ORION</h2>
          <p>Consulte qualquer conhecimento do ORION e investigue os dados calculados do DPP com evidências rastreáveis.</p>
        </div>
        <div className="agent-orion-context" aria-label="Contexto atual do agente">
          <strong>{formatMonth(month)}</strong>
          <span>{statusContext}</span>
        </div>
      </header>

      <div className="agent-orion-statusline" aria-label="Estado das fontes do Agente ORION">
        <span><i data-state={packageState === 'ready' ? 'ready' : 'pending'} aria-hidden="true" />{packageStatusText(packageState)}</span>
        <span><i data-state={scenarioState === 'current' ? 'ready' : 'pending'} aria-hidden="true" />{scenarioStatusText(scenarioState)}</span>
        <span><i data-state={finalState === 'current' ? 'ready' : 'pending'} aria-hidden="true" />{finalStatusText(finalState)}</span>
        <span><i data-state={databaseStatus.state === 'ready' ? 'ready' : 'pending'} aria-hidden="true" />{databaseStatusText(databaseStatus)}</span>
      </div>

      <div className="agent-orion-layout" data-evidence-open={evidenceOpen}>
        <section className="agent-conversation" aria-label="Conversa com o Agente ORION">
          <div className="agent-conversation-head">
            <div>
              <strong>Conversa</strong>
              <span>{materials} materiais · {models} modelos no contexto atual.</span>
            </div>
            <button type="button" className="agent-evidence-toggle" aria-expanded={evidenceOpen}
              aria-controls="agent-evidence" onClick={() => setEvidenceOpen((value) => !value)}>
              {evidenceOpen ? 'Ocultar evidências' : 'Ver evidências'}
            </button>
          </div>

          <div className="agent-message-list" aria-live="polite" ref={messageListRef}>
            {messages.map((message, index) => {
              const latestMessage = index === messages.length - 1
              const hasTable = Boolean(message.table?.rows?.length)
              return (
                <article
                  className="agent-message"
                  data-role={message.role}
                  data-has-table={hasTable ? 'true' : 'false'}
                  key={message.id}
                  ref={latestMessage ? latestMessageRef : null}
                >
                  <div className="agent-message-author">{message.role === 'orion' ? 'ORION' : 'Você'}</div>
                  <p>{message.text}</p>
                  {hasTable && <MessageDataTable table={message.table} />}
                  {message.role === 'orion' && message.confidence && (
                    <div className="agent-message-meta">
                      <span>Tipo de resposta: {message.confidence}</span>
                      <span>Consulta: {message.tool || 'sqlite-fts5-bm25+sql'}</span>
                      {message.auditId && <span>Auditoria DB: #{message.auditId}</span>}
                    </div>
                  )}
                </article>
              )
            })}
            {asking && (
              <article className="agent-message" data-role="orion">
                <div className="agent-message-author">ORION</div>
                <p>Consultando entidades e conhecimento no SQLite...</p>
              </article>
            )}
          </div>

          <form className="agent-composer" onSubmit={handleSubmit}>
            <label htmlFor="agent-orion-input">Pergunte livremente sobre qualquer conhecimento existente no ORION</label>
            <div>
              <textarea
                id="agent-orion-input"
                rows="2"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={conversationReady ? 'Pergunte sobre materiais, modelos ou divergências...' : 'Restaurando conversa...'}
                disabled={asking || !conversationReady}
              />
              <button type="submit" disabled={!question.trim() || asking || !conversationReady}>{asking ? 'Consultando' : 'Enviar'}</button>
            </div>
            <small>Enter envia · Shift + Enter cria uma nova linha</small>
          </form>
        </section>

        <aside id="agent-evidence" className="agent-evidence" hidden={!evidenceOpen} aria-label="Evidências e inspeção da resposta">
          <section>
            <div className="agent-section-heading">
              <strong>Evidências recuperadas</strong>
              <span>{currentAnswer.evidence?.length || 0} utilizada(s)</span>
            </div>
            {currentAnswer.evidence?.length ? (
              <div className="agent-evidence-list">
                {currentAnswer.evidence.map((item, index) => (
                  <article key={`${item.value}-${index}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </article>
                ))}
              </div>
            ) : (
              <p className="agent-empty-evidence">Consultas estruturadas podem usar diretamente as entidades do SQLite sem recuperar chunks textuais.</p>
            )}
          </section>

          <section className="agent-inspector">
            <div className="agent-section-heading">
              <strong>Inspeção</strong>
              <span>Rastreabilidade</span>
            </div>
            <dl>
              <div>
                <dt>Banco</dt>
                <dd>{currentAnswer.database || databaseStatus.database || 'orion.db'}</dd>
              </div>
              <div>
                <dt>Fontes utilizadas</dt>
                <dd>{currentAnswer.sources?.length ? currentAnswer.sources.join(' · ') : 'Nenhuma fonte suficiente'}</dd>
              </div>
              <div>
                <dt>Entidades</dt>
                <dd>{currentAnswer.entities?.length ? currentAnswer.entities.slice(0, 20).join(' · ') : '—'}</dd>
              </div>
              <div>
                <dt>Motor de consulta</dt>
                <dd>SQLite SQL + FTS5 + BM25</dd>
              </div>
              <div>
                <dt>Workspace indexado</dt>
                <dd>{databaseStatus.runtimeEntities || databaseStatus.runtimeDocuments || 0} entidade(s) atual(is)</dd>
              </div>
              <div>
                <dt>Auditoria</dt>
                <dd>{currentAnswer.auditId ? `Registro #${currentAnswer.auditId}` : '—'}</dd>
              </div>
              <div>
                <dt>Execução</dt>
                <dd>Frontend passivo · backend DB-first · contexto persistido por 24 horas</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  )
}

export default AgentOrion