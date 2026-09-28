import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import ScenarioDivergenceDetails from './ScenarioDivergenceDetails'

const KINDS = ['pgd', 'real', 'gap', 'coverage', 'risk', 'critical', 'exposed', 'shared']

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function activeModelsForMaterial(material, realLookup) {
  return Object.entries(material.consumption_by_model || {})
    .filter(([modelName, usage]) => number(usage) > 0 && number(realLookup[modelName]) > 0)
    .map(([modelName]) => modelName)
}

function buildData(scenario) {
  const models = scenario?.models || []
  const materials = scenario?.materials || []
  const realLookup = Object.fromEntries(models.map((model) => [model.name, number(model.real)]))
  const activeModels = models.filter((model) => number(model.real) > 0)
  const criticalMaterials = materials.filter((material) => material.status === 'INVESTIGAR')
  const riskNames = new Set()
  criticalMaterials.forEach((material) => {
    activeModelsForMaterial(material, realLookup).forEach((name) => riskNames.add(name))
  })
  return {
    models,
    materials,
    activeModels,
    criticalMaterials,
    riskModels: activeModels.filter((model) => riskNames.has(model.name)),
  }
}

function ScenarioDivergenceController({ finalDppAnalysis }) {
  const { generatedScenario } = useDppWorkspace()
  const data = useMemo(() => buildData(generatedScenario), [generatedScenario])
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    const section = document.querySelector('.dashboard-scenario-comparison')
    if (!section || !finalDppAnalysis) {
      setSelection(null)
      return undefined
    }

    const rows = Array.from(section.querySelectorAll('.scenario-comparison-row'))
    rows.forEach((row, index) => {
      const cell = row.querySelector('.scenario-comparison-divergence.warning')
      if (!cell || !KINDS[index]) return
      cell.dataset.drilldown = 'true'
      cell.dataset.divergenceKind = KINDS[index]
      cell.setAttribute('role', 'button')
      cell.setAttribute('tabindex', '0')
      cell.setAttribute('aria-label', `Ver detalhes da divergência de ${row.querySelector('.scenario-comparison-label strong')?.textContent || 'indicador'}`)
    })

    function activate(cell) {
      const row = cell.closest('.scenario-comparison-row')
      const kind = cell.dataset.divergenceKind
      if (!row || !kind) return

      setSelection((current) => {
        document.querySelectorAll('.scenario-comparison-divergence[data-expanded="true"]').forEach((element) => {
          element.dataset.expanded = 'false'
          element.setAttribute('aria-expanded', 'false')
        })
        if (current?.cell === cell) return null
        cell.dataset.expanded = 'true'
        cell.setAttribute('aria-expanded', 'true')
        return { kind, row, cell }
      })
    }

    function onClick(event) {
      const cell = event.target.closest('.scenario-comparison-divergence.warning[data-drilldown="true"]')
      if (cell && section.contains(cell)) activate(cell)
    }

    function onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const cell = event.target.closest('.scenario-comparison-divergence.warning[data-drilldown="true"]')
      if (!cell || !section.contains(cell)) return
      event.preventDefault()
      activate(cell)
    }

    section.addEventListener('click', onClick)
    section.addEventListener('keydown', onKeyDown)
    return () => {
      section.removeEventListener('click', onClick)
      section.removeEventListener('keydown', onKeyDown)
      rows.forEach((row) => {
        const cell = row.querySelector('.scenario-comparison-divergence')
        if (!cell) return
        delete cell.dataset.drilldown
        delete cell.dataset.divergenceKind
        delete cell.dataset.expanded
        cell.removeAttribute('tabindex')
        cell.removeAttribute('aria-expanded')
      })
      setSelection(null)
    }
  }, [finalDppAnalysis])

  useEffect(() => {
    if (!selection?.row) return undefined
    const host = document.createElement('div')
    host.className = 'scenario-divergence-host'
    selection.row.insertAdjacentElement('afterend', host)
    setSelection((current) => current ? { ...current, host } : current)
    return () => host.remove()
  }, [selection?.row, selection?.kind])

  if (!selection?.host || !generatedScenario || !finalDppAnalysis) return null
  return createPortal(
    <ScenarioDivergenceDetails kind={selection.kind} data={data} finalDppAnalysis={finalDppAnalysis} />,
    selection.host,
  )
}

export default ScenarioDivergenceController
