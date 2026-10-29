import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import ScenarioDivergenceDetails from './ScenarioDivergenceDetails'

const ROW_KINDS = ['critical', 'opc', 'real', 'active']
const TOLERANCE = 1e-4

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function key(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR')
}

function same(left, right) {
  return Math.abs(number(left) - number(right)) <= TOLERANCE
}

function scenarioCritical(material) {
  return material?.status === 'INVESTIGAR'
}

function buildData(scenario) {
  const models = scenario?.models || []
  const materials = scenario?.materials || []
  return {
    models,
    materials,
    activeModels: models.filter((model) => number(model.real) > 0),
    criticalMaterials: materials.filter(scenarioCritical),
  }
}

function symmetricDifferenceCount(leftValues, rightValues) {
  const left = new Set((leftValues || []).map(key).filter(Boolean))
  const right = new Set((rightValues || []).map(key).filter(Boolean))
  let differences = 0
  left.forEach((value) => { if (!right.has(value)) differences += 1 })
  right.forEach((value) => { if (!left.has(value)) differences += 1 })
  return differences
}

function modelValueDifferenceCount(orionModels, finalModels) {
  const left = new Map((orionModels || []).map((model) => [key(model.name), number(model.real)]))
  const right = new Map((finalModels || []).map((model) => [key(model.name), number(model.real)]))
  const names = new Set([...left.keys(), ...right.keys()])
  let differences = 0
  names.forEach((name) => {
    if (!left.has(name) || !right.has(name) || !same(left.get(name), right.get(name))) differences += 1
  })
  return differences
}

function optionalMaterialDifferenceCount(orionMaterials, finalMaterials) {
  const left = new Map((orionMaterials || []).map((material) => [key(material.material || material.material_key), key(material.optional_material)]))
  const right = new Map((finalMaterials || []).map((material) => [key(material.material || material.material_key), key(material.optional_material)]))
  const materials = new Set([...left.keys(), ...right.keys()])
  let differences = 0
  materials.forEach((material) => {
    if (!left.has(material) || !right.has(material) || left.get(material) !== right.get(material)) differences += 1
  })
  return differences
}

function detailCounts(data, finalDppAnalysis) {
  const finalModels = finalDppAnalysis?.models || []
  const finalMaterials = finalDppAnalysis?.material_details || []
  return {
    critical: symmetricDifferenceCount(
      data.criticalMaterials.map((material) => material.material || material.material_key),
      finalMaterials.filter((material) => material.critical).map((material) => material.material || material.material_key),
    ),
    opc: optionalMaterialDifferenceCount(data.materials, finalMaterials),
    real: modelValueDifferenceCount(data.models, finalModels),
    active: symmetricDifferenceCount(
      data.activeModels.map((model) => model.name),
      finalModels.filter((model) => model.active).map((model) => model.name),
    ),
  }
}

function EvolutionDivergenceController({ finalDppAnalysis }) {
  const { generatedScenario } = useDppWorkspace()
  const data = useMemo(() => buildData(generatedScenario), [generatedScenario])
  const counts = useMemo(() => detailCounts(data, finalDppAnalysis), [data, finalDppAnalysis])
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    const section = document.querySelector('.dpp-evolution-panel')
    if (!section || !finalDppAnalysis || !generatedScenario) {
      setSelection(null)
      return undefined
    }

    const rows = Array.from(section.querySelectorAll('.dpp-evolution-row'))
    rows.forEach((row, index) => {
      const kind = ROW_KINDS[index]
      const cell = row.querySelector('small')
      if (!kind || !cell) return

      const baseText = cell.textContent || ''
      cell.dataset.evolutionBaseText = baseText
      const aggregateDivergent = cell.classList.contains('attention')
      const itemDifferences = counts[kind] || 0
      const divergent = aggregateDivergent || itemDifferences > 0
      if (!divergent) return

      if (!aggregateDivergent && itemDifferences > 0) {
        cell.textContent = `Mesmo total · ${itemDifferences} item(ns) diferente(s)`
        cell.classList.remove('neutral')
        cell.classList.add('attention')
      } else if (itemDifferences > 0 && !baseText.includes('item(ns)')) {
        cell.textContent = `${baseText} · ${itemDifferences} item(ns) diferente(s)`
      }

      cell.dataset.evolutionDrilldown = 'true'
      cell.dataset.divergenceKind = kind
      cell.setAttribute('role', 'button')
      cell.setAttribute('tabindex', '0')
      cell.setAttribute('aria-label', `Ver detalhes da evolução de ${row.querySelector('strong')?.textContent || 'indicador'}`)
    })

    function activate(cell) {
      const row = cell.closest('.dpp-evolution-row')
      const kind = cell.dataset.divergenceKind
      if (!row || !kind) return

      setSelection((current) => {
        section.querySelectorAll('[data-evolution-expanded="true"]').forEach((element) => {
          element.dataset.evolutionExpanded = 'false'
          element.setAttribute('aria-expanded', 'false')
        })
        if (current?.cell === cell) return null
        cell.dataset.evolutionExpanded = 'true'
        cell.setAttribute('aria-expanded', 'true')
        return { kind, row, cell }
      })
    }

    function onClick(event) {
      const cell = event.target.closest('[data-evolution-drilldown="true"]')
      if (cell && section.contains(cell)) activate(cell)
    }

    function onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const cell = event.target.closest('[data-evolution-drilldown="true"]')
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
        const cell = row.querySelector('small')
        if (!cell) return
        const baseText = cell.dataset.evolutionBaseText
        if (baseText !== undefined) cell.textContent = baseText
        delete cell.dataset.evolutionBaseText
        delete cell.dataset.evolutionDrilldown
        delete cell.dataset.divergenceKind
        delete cell.dataset.evolutionExpanded
        cell.removeAttribute('tabindex')
        cell.removeAttribute('aria-expanded')
        if (baseText === 'Igual') {
          cell.classList.remove('attention')
          cell.classList.add('neutral')
        }
      })
      setSelection(null)
    }
  }, [counts, finalDppAnalysis, generatedScenario])

  useEffect(() => {
    if (!selection?.row) return undefined
    const host = document.createElement('div')
    host.className = 'evolution-divergence-host'
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

export default EvolutionDivergenceController
