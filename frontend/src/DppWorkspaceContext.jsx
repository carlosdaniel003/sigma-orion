import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const DppWorkspaceContext = createContext(null)

const DB_NAME = 'sigma-s-orion-workspace'
const DB_VERSION = 1
const STORE_NAME = 'dpp-package'
const PACKAGE_KEY = 'current-package'
const PROCESSED_STATE_KEY = 'processed-state'
const GENERATED_SIGNATURE_KEY = 'sigma-s-orion-generated-signature'
const TEST_SIGNATURE_KEY = 'sigma-s-orion-test-signature'

function openWorkspaceDb() {
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
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento local.'))
  })
}

async function readStoredValue(key) {
  const database = await openWorkspaceDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error || new Error('Falha ao restaurar workspace do DPP.'))
    })
  } finally {
    database.close()
  }
}

async function writeStoredValue(key, value) {
  const database = await openWorkspaceDb()
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error || new Error('Falha ao persistir workspace do DPP.'))
      transaction.onabort = () => reject(transaction.error || new Error('Persistência do workspace foi interrompida.'))
    })
  } finally {
    database.close()
  }
}

async function readPersistedPackage() {
  return readStoredValue(PACKAGE_KEY)
}

async function readPersistedProcessedState() {
  return readStoredValue(PROCESSED_STATE_KEY)
}

async function writePersistedPackage(files, referenceMonth) {
  const persistedFiles = files.map((file) => ({
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
    blob: file,
  }))

  await writeStoredValue(PACKAGE_KEY, {
    files: persistedFiles,
    referenceMonth,
    updatedAt: Date.now(),
  })
}

async function writePersistedProcessedState({
  generatedScenario,
  generatedSignature,
  testResult,
  testSignature,
  finalDppAnalysis,
  finalDppSignature,
}) {
  await writeStoredValue(PROCESSED_STATE_KEY, {
    generatedScenario,
    generatedSignature,
    testResult,
    testSignature,
    finalDppAnalysis,
    finalDppSignature,
    updatedAt: Date.now(),
  })
}

function restoreFiles(entries) {
  return (entries || []).map((entry) => {
    if (entry?.blob instanceof File) return entry.blob
    const blob = entry?.blob instanceof Blob ? entry.blob : new Blob([])
    return new File([blob], entry?.name || 'arquivo.xlsx', {
      type: entry?.type || blob.type || '',
      lastModified: Number(entry?.lastModified) || Date.now(),
    })
  })
}

function readStoredSignature(key) {
  try {
    return window.localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function persistSignature(key, value) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // O workspace continua funcional quando o localStorage não está disponível.
  }
}

export function DppWorkspaceProvider({ children }) {
  const [files, setFiles] = useState([])
  const [referenceMonth, setReferenceMonth] = useState('')
  const [generatedSignature, setGeneratedSignature] = useState('')
  const [generatedScenario, setGeneratedScenario] = useState(null)
  const [testSignature, setTestSignature] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [finalDppAnalysis, setFinalDppAnalysis] = useState(null)
  const [finalDppSignature, setFinalDppSignature] = useState('')
  const [workspaceReady, setWorkspaceReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function restoreWorkspace() {
      try {
        const [persistedPackage, persistedState] = await Promise.all([
          readPersistedPackage(),
          readPersistedProcessedState(),
        ])
        if (cancelled) return

        if (persistedPackage) {
          setFiles(restoreFiles(persistedPackage.files))
          setReferenceMonth(persistedPackage.referenceMonth || '')
        }

        const persistedGeneratedSignature = persistedState?.generatedSignature
          || readStoredSignature(GENERATED_SIGNATURE_KEY)
        const persistedTestSignature = persistedState?.testSignature
          || readStoredSignature(TEST_SIGNATURE_KEY)

        setGeneratedSignature(persistedGeneratedSignature || '')
        setGeneratedScenario(persistedState?.generatedScenario || null)
        setTestSignature(persistedTestSignature || '')
        setTestResult(persistedState?.testResult || null)
        setFinalDppAnalysis(persistedState?.finalDppAnalysis || null)
        setFinalDppSignature(persistedState?.finalDppSignature || '')

        if (navigator.storage?.persist) {
          navigator.storage.persist().catch(() => {})
        }
      } catch (error) {
        console.warn('Não foi possível restaurar o workspace persistido do DPP:', error)
      } finally {
        if (!cancelled) setWorkspaceReady(true)
      }
    }

    restoreWorkspace()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspaceReady) return
    writePersistedPackage(files, referenceMonth).catch((error) => {
      console.warn('Não foi possível persistir pacote do DPP:', error)
    })
  }, [files, referenceMonth, workspaceReady])

  useEffect(() => {
    if (!workspaceReady) return
    writePersistedProcessedState({
      generatedScenario,
      generatedSignature,
      testResult,
      testSignature,
      finalDppAnalysis,
      finalDppSignature,
    }).catch((error) => {
      console.warn('Não foi possível persistir o estado processado do DPP:', error)
    })
  }, [
    generatedScenario,
    generatedSignature,
    testResult,
    testSignature,
    finalDppAnalysis,
    finalDppSignature,
    workspaceReady,
  ])

  useEffect(() => {
    if (!workspaceReady) return
    persistSignature(GENERATED_SIGNATURE_KEY, generatedSignature)
  }, [generatedSignature, workspaceReady])

  useEffect(() => {
    if (!workspaceReady) return
    persistSignature(TEST_SIGNATURE_KEY, testSignature)
  }, [testSignature, workspaceReady])

  const value = useMemo(() => ({
    files,
    setFiles,
    referenceMonth,
    setReferenceMonth,
    generatedSignature,
    setGeneratedSignature,
    generatedScenario,
    setGeneratedScenario,
    testSignature,
    setTestSignature,
    testResult,
    setTestResult,
    finalDppAnalysis,
    setFinalDppAnalysis,
    finalDppSignature,
    setFinalDppSignature,
    workspaceReady,
  }), [
    files,
    referenceMonth,
    generatedSignature,
    generatedScenario,
    testSignature,
    testResult,
    finalDppAnalysis,
    finalDppSignature,
    workspaceReady,
  ])

  return (
    <DppWorkspaceContext.Provider value={value}>
      {children}
    </DppWorkspaceContext.Provider>
  )
}

export function useDppWorkspace() {
  const context = useContext(DppWorkspaceContext)
  if (!context) throw new Error('useDppWorkspace deve ser usado dentro de DppWorkspaceProvider.')
  return context
}
