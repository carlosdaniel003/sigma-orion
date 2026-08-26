import { createContext, useContext, useMemo, useState } from 'react'

const DppWorkspaceContext = createContext(null)

export function DppWorkspaceProvider({ children }) {
  const [files, setFiles] = useState([])
  const [referenceMonth, setReferenceMonth] = useState('')
  const [generatedSignature, setGeneratedSignature] = useState('')
  const [generatedScenario, setGeneratedScenario] = useState(null)
  const [testSignature, setTestSignature] = useState('')
  const [testResult, setTestResult] = useState(null)

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
  }), [
    files,
    referenceMonth,
    generatedSignature,
    generatedScenario,
    testSignature,
    testResult,
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
