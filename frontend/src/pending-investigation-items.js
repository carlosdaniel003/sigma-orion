import { qualityCohorts, stockCohorts } from './investigation-view-model.js'

/** Fila de PNs únicos, baseada exclusivamente na categoria 'pending' dos KPIs. */
export function pendingInvestigationItems(report, area) {
  if (!report) return null
  const cohorts = area === 'stock' ? stockCohorts(report) : qualityCohorts(report)
  const items = cohorts.find(cohort => cohort.key === 'pending')?.items || []
  const seen = new Set()

  return items.flatMap(material => {
    const pn = String(material.material || '').trim()
    if (!pn || seen.has(pn)) return []
    seen.add(pn)
    const depots = [...new Set((material.candidates || [])
      .filter(candidate => !candidate.validation)
      .map(candidate => String(candidate.depot || '').trim())
      .filter(Boolean))]
    return [{ pn, description: material.description || '', depots }]
  })
}

export function qualityPendingItems(stock, quality) {
  if (quality) return pendingInvestigationItems(quality, 'quality')
  if (Array.isArray(stock?.workflow?.forward_to_quality)
    && stock.workflow.forward_to_quality.length === 0) return []
  return null
}
