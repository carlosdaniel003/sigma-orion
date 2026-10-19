/** The bars visualize source evidence only; they are not stock recovery. */
export function evidenceCoveragePercent(found, deficit) {
  const rawFound = Number(found)
  const rawDeficit = Number(deficit)
  if (!Number.isFinite(rawFound) || !Number.isFinite(rawDeficit) || rawDeficit <= 0) return 0
  return Math.min(100, Math.max(0, (rawFound / rawDeficit) * 100))
}
