/** Presentation-only transformations; never change DPP or investigation calculations. */
export function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function stockFound(report) {
  return (report?.materials || [])
    .filter(material => (material.candidates || []).length > 0)
    .slice()
    .sort((a, b) => {
      const pendingA = (a.candidates || []).some(c => !c.validation) ? 1 : 0
      const pendingB = (b.candidates || []).some(c => !c.validation) ? 1 : 0
      return pendingB - pendingA || amount(b.negative_balance) - amount(a.negative_balance)
        || String(a.material).localeCompare(String(b.material))
    })
}

export function qualityFound(report) {
  return (report?.materials || [])
    .filter(material => (material.candidates || []).length > 0)
    .slice()
    .sort((a, b) => {
      const pendingA = (a.candidates || []).some(c => !c.validation) ? 1 : 0
      const pendingB = (b.candidates || []).some(c => !c.validation) ? 1 : 0
      return pendingB - pendingA || amount(b.gap_from_41) - amount(a.gap_from_41)
        || String(a.material).localeCompare(String(b.material))
    })
}

export function pendingRecords(materials) {
  return materials.flatMap(material => (material.candidates || [])
    .filter(candidate => !candidate.validation)
    .map(candidate => ({ material, candidate })))
}

export function investigationUnits(stock, quality) {
  if (!stock) return []
  const units = new Map()
  function entry(unit) {
    const name = unit || 'SEM UM'
    if (!units.has(name)) units.set(name, {
      unit: name, deficit: 0, foundStock: 0, potentialStock: 0,
      appliedStock: 0, gapStock: 0, unexplainedStock: 0,
      foundQuality: 0, appliedQuality: 0, unexplainedQuality: 0,
    })
    return units.get(name)
  }
  const stocks = [...(stock.materials || []), ...(stock.unmatched_materials || [])]
  for (const m of stocks) {
    const e = entry(m.unit)
    const deficit = amount(m.negative_balance)
    const found = (m.candidates || []).reduce((s, c) => s + amount(c.quantity), 0)
    e.deficit += deficit
    e.foundStock += found
    e.potentialStock += Math.min(deficit, found)
    e.appliedStock += amount(m.recovered_quantity_applied)
    e.gapStock += amount(m.projected_gap_remaining ?? deficit)
    e.unexplainedStock += amount(m.unexplained_quantity ?? deficit)
  }
  for (const m of quality?.materials || []) {
    const e = entry(m.unit)
    e.foundQuality += (m.candidates || []).reduce((s, c) => s + amount(c.quantity), 0)
    e.appliedQuality += amount(m.quality_released_applied)
    e.unexplainedQuality += amount(m.unexplained_after_quality)
  }
  return [...units.values()].sort((a, b) => a.unit.localeCompare(b.unit))
}

export function filterFound(materials, query, selection) {
  const search = String(query || '').trim().toLocaleLowerCase('pt-BR')
  return materials.filter(material => {
    if (selection === 'pending' && !(material.candidates || []).some(c => !c.validation)) return false
    if (selection === 'reviewed' && (material.candidates || []).some(c => !c.validation)) return false
    if (!search) return true
    return [material.material, material.description, ...(material.candidates || []).map(c => c.depot)]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(search))
  })
}
