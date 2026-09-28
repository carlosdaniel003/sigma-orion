export const AGENT_CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000

const DB_NAME = 'sigma-s-orion-agent'
const DB_VERSION = 1
const STORE_NAME = 'conversation'
const ACTIVE_KEY = 'active'
const FALLBACK_KEY = 'sigma-s-orion-agent-conversation-v1'

function openAgentDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento da conversa do Agente ORION.'))
  })
}

async function readIndexedConversation() {
  const database = await openAgentDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_KEY)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('Falha ao restaurar conversa do Agente ORION.'))
    })
  } finally {
    database.close()
  }
}

async function writeIndexedConversation(value) {
  const database = await openAgentDb()
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(value, ACTIVE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Falha ao persistir conversa do Agente ORION.'))
      transaction.onabort = () => reject(transaction.error || new Error('Persistência da conversa foi interrompida.'))
    })
  } finally {
    database.close()
  }
}

async function deleteIndexedConversation() {
  const database = await openAgentDb()
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(ACTIVE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Falha ao remover conversa expirada do Agente ORION.'))
      transaction.onabort = () => reject(transaction.error || new Error('Remoção da conversa foi interrompida.'))
    })
  } finally {
    database.close()
  }
}

function readFallbackConversation() {
  try {
    const raw = window.localStorage.getItem(FALLBACK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeFallbackConversation(value) {
  try {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(value))
  } catch {
    // O IndexedDB é o armazenamento principal; este fallback é apenas de contingência.
  }
}

function deleteFallbackConversation() {
  try {
    window.localStorage.removeItem(FALLBACK_KEY)
  } catch {
    // Sem ação: ausência de localStorage não impede o chat de funcionar na sessão atual.
  }
}

function validConversation(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return false
  if (!value.sessionId || !Array.isArray(value.messages)) return false
  const createdAt = Number(value.createdAt)
  const expiresAt = Number(value.expiresAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) return false
  if (expiresAt <= createdAt) return false
  return now < expiresAt
}

export async function readAgentConversation() {
  let value = null
  try {
    value = await readIndexedConversation()
  } catch {
    value = readFallbackConversation()
  }

  if (!validConversation(value)) {
    await clearAgentConversation()
    return null
  }

  return {
    sessionId: String(value.sessionId),
    createdAt: Number(value.createdAt),
    expiresAt: Number(value.expiresAt),
    updatedAt: Number(value.updatedAt) || Number(value.createdAt),
    messages: value.messages,
  }
}

export async function writeAgentConversation(value) {
  const snapshot = {
    sessionId: String(value.sessionId || ''),
    createdAt: Number(value.createdAt) || Date.now(),
    expiresAt: Number(value.expiresAt) || (Date.now() + AGENT_CONVERSATION_TTL_MS),
    updatedAt: Number(value.updatedAt) || Date.now(),
    messages: Array.isArray(value.messages) ? value.messages : [],
  }

  try {
    await writeIndexedConversation(snapshot)
    deleteFallbackConversation()
  } catch {
    writeFallbackConversation(snapshot)
  }
}

export async function clearAgentConversation() {
  deleteFallbackConversation()
  try {
    await deleteIndexedConversation()
  } catch {
    // A expiração ainda é respeitada pelo leitor mesmo se o armazenamento estiver indisponível.
  }
}
