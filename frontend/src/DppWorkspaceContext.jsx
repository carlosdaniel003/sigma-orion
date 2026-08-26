import { createContext, useContext, useMemo, useState } from 'react'

const DppWorkspaceContext = createContext(null)

export function DppWorkspaceProvider({ children }) {
  const [files, setFiles] = useState([])
  const [referenceMonth, setReferenceMonth] = useState('')
  const [generatedSignature, setGeneratedSignature] = useState('')

  const value = useMemo(() => ({
    files,
    setFiles,
    referenceMonth,
    setReferenceMonth,
    generatedSignature,
    setGeneratedSignature,
  }), [files, referenceMonth, generatedSignature])

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
