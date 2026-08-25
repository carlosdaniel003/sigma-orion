const MONTHS = {
  JAN: 1, JANEIRO: 1,
  FEV: 2, FEVEREIRO: 2,
  MAR: 3, MARCO: 3,
  ABR: 4, ABRIL: 4,
  MAI: 5, MAIO: 5,
  JUN: 6, JUNHO: 6,
  JUL: 7, JULHO: 7,
  AGO: 8, AGOSTO: 8,
  SET: 9, SETEMBRO: 9,
  OUT: 10, OUTUBRO: 10,
  NOV: 11, NOVEMBRO: 11,
  DEZ: 12, DEZEMBRO: 12,
}

export const FILE_LABELS = {
  baseDpp: 'DPP do mês anterior',
  expectedDpp: 'DPP final / consolidado do mês',
  stock: 'STK SAP',
  explosion: 'Explosão de Placas',
  openFile: 'OPEN',
  pgd: 'PGD',
  wiu: 'WIU',
}

const REQUIRED_BY_MODE = {
  generate: ['baseDpp', 'stock', 'explosion', 'pgd', 'wiu'],
  test: ['baseDpp', 'expectedDpp', 'stock', 'explosion', 'pgd', 'wiu'],
  dashboard: ['baseDpp', 'expectedDpp', 'stock', 'explosion', 'pgd', 'wiu'],
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function reference(year, month) {
  if (!year || !month) return null
  return `${year}-${String(month).padStart(2, '0')}`
}

function fileIdentity(file) {
  return `${file?.name || ''}:${file?.size || 0}:${file?.lastModified || 0}`
}

export function previousReference(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return null
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return reference(date.getFullYear(), date.getMonth() + 1)
}

export function fileMonthReference(filename) {
  const text = normalize(filename)

  for (const [name, month] of Object.entries(MONTHS)) {
    const match = text.match(new RegExp(`(?:^|[^A-Z])${name}[^0-9]{0,8}(20\\d{2})`))
    if (match) return reference(Number(match[1]), month)
  }

  const numeric = text.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[._-](20\d{2})(?:[^0-9]|$)/)
  if (numeric) return reference(Number(numeric[2]), Number(numeric[1]))

  const dated = text.match(/(?:^|[^0-9])\d{1,2}[._-](0?[1-9]|1[0-2])[._-](20\d{2})(?:[^0-9]|$)/)
  if (dated) return reference(Number(dated[2]), Number(dated[1]))

  return null
}

function kindFromFilename(file) {
  const name = normalize(file?.name)
  if (!name) return 'unknown'
  if (name.includes('WIU')) return 'wiu'
  if (name.includes('EXPLOSAO')) return 'explosion'
  if (name.includes('STK')) return 'stock'
  if (/(^|[^A-Z])OPEN([^A-Z]|$)/.test(name)) return 'openFile'
  if (name.includes('PGD')) return 'pgd'
  if (/(^|[^A-Z])DPP([^A-Z]|$)/.test(name)) return 'dpp'
  return 'unknown'
}

function inferReference(classified) {
  const votes = []
  for (const item of classified) {
    if (item.kind === 'pgd' || item.kind === 'dpp' || item.kind === 'unknown') continue
    const month = fileMonthReference(item.file.name)
    if (month) votes.push(month)
  }

  if (votes.length) {
    const counts = new Map()
    for (const value of votes) counts.set(value, (counts.get(value) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0]
  }

  const dppMonths = classified
    .filter((item) => item.kind === 'dpp')
    .map((item) => fileMonthReference(item.file.name))
    .filter(Boolean)
    .sort()
  return dppMonths.at(-1) || null
}

export function classifyDppBundle(inputFiles, referenceMonth = '', mode = 'generate') {
  const files = Array.from(inputFiles || [])
  const classified = files.map((file) => ({ file, kind: kindFromFilename(file) }))
  const inferredReference = referenceMonth || inferReference(classified) || ''
  const previousMonth = previousReference(inferredReference)

  const bundle = {
    baseDpp: null,
    expectedDpp: null,
    stock: null,
    explosion: null,
    openFile: null,
    pgd: null,
    wiu: null,
  }
  const duplicates = []
  const unknown = []
  const dpps = []

  function assign(key, file) {
    if (!bundle[key]) bundle[key] = file
    else duplicates.push(file)
  }

  for (const item of classified) {
    if (item.kind === 'dpp') {
      dpps.push(item.file)
      continue
    }
    if (item.kind === 'unknown') {
      unknown.push(item.file)
      continue
    }
    assign(item.kind, item.file)
  }

  const unresolvedDpps = []
  for (const file of dpps) {
    const month = fileMonthReference(file.name)
    if (month && inferredReference && month === inferredReference) assign('expectedDpp', file)
    else if (month && previousMonth && month === previousMonth) assign('baseDpp', file)
    else unresolvedDpps.push(file)
  }

  if (unresolvedDpps.length) {
    const sorted = [...unresolvedDpps].sort((a, b) => {
      const left = fileMonthReference(a.name) || ''
      const right = fileMonthReference(b.name) || ''
      return left.localeCompare(right)
    })
    if (!bundle.baseDpp && sorted.length >= 1) bundle.baseDpp = sorted[0]
    if (!bundle.expectedDpp && sorted.length >= 2) bundle.expectedDpp = sorted.at(-1)
    else if (!bundle.expectedDpp && sorted.length === 1 && mode !== 'generate' && fileMonthReference(sorted[0].name) === inferredReference) bundle.expectedDpp = sorted[0]
  }

  const requiredKeys = REQUIRED_BY_MODE[mode] || REQUIRED_BY_MODE.generate
  const missing = requiredKeys.filter((key) => !bundle[key])
  const recognized = Object.entries(bundle).filter(([, file]) => Boolean(file)).length
  const signature = [
    mode,
    inferredReference,
    ...files.map(fileIdentity).sort(),
  ].join('|')

  return {
    ...bundle,
    referenceMonth: inferredReference,
    previousMonth,
    requiredKeys,
    missing,
    unknown,
    duplicates,
    recognized,
    total: files.length,
    signature,
    ready: missing.length === 0,
  }
}
