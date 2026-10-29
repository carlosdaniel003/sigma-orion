import { useEffect, useState } from 'react'
import InfoHint from './InfoHint'

let moduleInfoCache = null
let moduleInfoPromise = null

async function loadModuleInfo() {
  if (moduleInfoCache) return moduleInfoCache
  if (!moduleInfoPromise) {
    moduleInfoPromise = fetch('/api/knowledge/module-info', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(payload?.detail || 'Não foi possível carregar as informações dos módulos.')
        }
        moduleInfoCache = payload?.items || {}
        return moduleInfoCache
      })
      .catch((error) => {
        moduleInfoPromise = null
        throw error
      })
  }
  return moduleInfoPromise
}

function unavailableInfo(moduleKey) {
  return {
    title: 'Informação do módulo',
    what: `A definição de "${moduleKey}" ainda não foi carregada.`,
    source: 'Base de conhecimento operacional do ORION.',
    purpose: 'Manter a rastreabilidade do módulo. Recarregue a página se esta mensagem persistir.',
  }
}

function ModuleInfoHint({ moduleKey, align = 'left' }) {
  const [info, setInfo] = useState(() => moduleInfoCache?.[moduleKey] || null)

  useEffect(() => {
    let active = true
    if (moduleInfoCache?.[moduleKey]) {
      setInfo(moduleInfoCache[moduleKey])
      return () => { active = false }
    }

    loadModuleInfo()
      .then((items) => {
        if (active) setInfo(items?.[moduleKey] || unavailableInfo(moduleKey))
      })
      .catch(() => {
        if (active) setInfo(unavailableInfo(moduleKey))
      })

    return () => { active = false }
  }, [moduleKey])

  return <InfoHint {...(info || unavailableInfo(moduleKey))} align={align} />
}

export default ModuleInfoHint
