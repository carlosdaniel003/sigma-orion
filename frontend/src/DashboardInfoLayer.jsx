import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ModuleInfoHint from './ModuleInfoHint'

const INFO_TARGETS = [
  { key: 'dashboard-overview', selector: '.dashboard-header h2', moduleKey: 'dashboard.overview' },
  { key: 'monthly-package', selector: '.bulk-file-picker-head h3', moduleKey: 'dashboard.package' },
  { key: 'orion-export', selector: '.dashboard-scenario-export > div > strong', moduleKey: 'dashboard.export' },
  { key: 'dpp-evolution', selector: '.dpp-evolution-panel .panel-header h3', moduleKey: 'dashboard.evolution' },
  { key: 'agent-bridge', selector: '.dpp-ai-bridge .panel-header h3', moduleKey: 'dashboard.agent_bridge' },
  { key: 'scenario-comparison', selector: '.dashboard-scenario-comparison .panel-header h3', moduleKey: 'dashboard.scenario_comparison' },
  { key: 'planning', selector: '.dashboard-planning-panel .panel-header h3', moduleKey: 'dashboard.planning' },
  { key: 'quality', selector: '.dashboard-quality-panel .panel-header h3', moduleKey: 'dashboard.quality' },
  { key: 'guide', selector: '.dashboard-guide-panel .panel-header h3', moduleKey: 'dashboard.guide' },
  { key: 'final-model-plan', selector: '.final-model-plan-heading > div:first-child h3', moduleKey: 'dashboard.final_model_plan' },
  { key: 'column-comparison', selector: '.dpp-column-comparison-title-row h3', moduleKey: 'dashboard.column_comparison', align: 'right' },
]

function sameHosts(current, next) {
  if (current.length !== next.length) return false
  return current.every((item, index) => (
    item.key === next[index].key
    && item.host === next[index].host
    && item.moduleKey === next[index].moduleKey
  ))
}

function DashboardInfoLayer() {
  const [hosts, setHosts] = useState([])

  useEffect(() => {
    const root = document.querySelector('.dpp-dashboard-view')
    if (!root) return undefined

    let frame = 0

    function sync() {
      const next = []

      for (const target of INFO_TARGETS) {
        const anchor = root.querySelector(target.selector)
        if (!anchor) continue

        let host = anchor.querySelector(`:scope > .dashboard-info-host[data-info-key="${target.key}"]`)
        if (!host) {
          host = document.createElement('span')
          host.className = 'dashboard-info-host'
          host.dataset.infoKey = target.key
          anchor.appendChild(host)
        }

        next.push({
          key: target.key,
          host,
          moduleKey: target.moduleKey,
          align: target.align || 'left',
        })
      }

      setHosts((current) => (sameHosts(current, next) ? current : next))
    }

    function scheduleSync() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(sync)
    }

    sync()
    const observer = new MutationObserver(scheduleSync)
    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      root.querySelectorAll('.dashboard-info-host[data-info-key]').forEach((host) => host.remove())
    }
  }, [])

  return hosts.map(({ key, host, moduleKey, align }) => createPortal(
    <ModuleInfoHint moduleKey={moduleKey} align={align} />,
    host,
    key,
  ))
}

export default DashboardInfoLayer
