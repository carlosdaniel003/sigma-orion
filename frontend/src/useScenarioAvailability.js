import { useCallback, useEffect, useState } from 'react'

/**
 * Browser-persisted DPP data is not proof that its server-side scenario exists.
 * Verify on mount, browser resume and before exposing an investigation modal.
 */
export function useScenarioAvailability(scenarioId, apiUrl = '') {
  const [status, setStatus] = useState({ scenarioId: '', state: 'checking' })

  const check = useCallback(async () => {
    if (!scenarioId) return false
    setStatus({ scenarioId, state: 'checking' })
    try {
      const response = await fetch(
        apiUrl + '/api/dpp/monthly/scenarios/' + encodeURIComponent(scenarioId) + '/availability',
        { cache: 'no-store' },
      )
      if (!response.ok) throw new Error('Consulta de disponibilidade indisponível')
      const data = await response.json()
      const available = data.available === true && data.scenario_id === scenarioId
      setStatus({ scenarioId, state: available ? 'ready' : 'missing' })
      return available
    } catch {
      // A transient network error is not proof that the scenario was deleted.
      // Still hide stale operational data until a successful verification.
      setStatus({ scenarioId, state: 'offline' })
      return false
    }
  }, [scenarioId, apiUrl])

  useEffect(() => {
    if (!scenarioId) return undefined
    check()
    const resume = () => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    const interval = window.setInterval(() => {
      if (!document.hidden) check()
    }, 120000)
    return () => {
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      window.clearInterval(interval)
    }
  }, [scenarioId, check])

  return {
    state: status.scenarioId === scenarioId ? status.state : 'checking',
    check,
  }
}
