import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function source(name) {
  return readFileSync(fileURLToPath(new URL('../src/' + name, import.meta.url)), 'utf8')
}

test('module headings contain no ornamental boxed SVG icons', () => {
  for (const file of ['Dashboard.jsx', 'InvestigationOverview.jsx',
    'StockDivergenceInvestigation.jsx', 'QualityInvestigation.jsx']) {
    const content = source(file)
    assert.doesNotMatch(content, /orion-visual-icon(?:-feature)?/)
    assert.doesNotMatch(content, /orion-visual-small-heading/)
    assert.doesNotMatch(content, /orion-visual-pn-track/)
  }
  assert.doesNotMatch(source('dashboard-visual-rhythm.css'), /\.orion-visual-icon\s*\{/)
})

test('only the operational shortcuts use SVG; PN records stay inside KPI modals', () => {
  const summary = source('InvestigationOverview.jsx')
  assert.doesNotMatch(summary, /href="#orion-stock-investigation"|href="#orion-quality-investigation"/)
  assert.doesNotMatch(summary, /className="orion-visual-journey"/)
  for (const file of ['StockDivergenceInvestigation.jsx', 'QualityInvestigation.jsx']) {
    const content = source(file)
    assert.match(content, /<InvestigationKpiGrid /)
    assert.match(content, /<InvestigationModal /)
    assert.match(content, /<InvestigationRecord /)
    assert.doesNotMatch(content, /InvestigationPagination|orion-investigation-queue-list|orion-investigation-found-grid/)
  }
})

test('six operational metrics and Excel remain separate from the modal redesign', () => {
  assert.doesNotMatch(source('dashboard-visual-rhythm.css'), /(?:workbook|worksheet|spreadsheet|xlsx)/i)
  const summary = source('InvestigationOverview.jsx')
  assert.match(summary, /aria-label="Resumo operacional das investigações"/)
  assert.doesNotMatch(summary, /orion-visual-coverage-grid|orion-investigation-unit-grid|orion-investigation-priority-summary/)
  assert.equal((summary.match(/\{ label: '/g) || []).length, 6)
})


test('the initial DPP headline is plain text followed by the functional info hint', () => {
  const dashboard = source('Dashboard.jsx')
  const heading = dashboard.match(
    /<div className="module-heading-with-info dashboard-primary-heading">([\s\S]*?)<\/div>/,
  )
  assert.ok(heading, 'dashboard uses the specific plain heading structure')
  assert.match(heading[1], /^\s*<h2>Cenário inicial do DPP<\/h2>\s*<ModuleInfoHint moduleKey="dashboard\.overview" \/>\s*$/)
  assert.doesNotMatch(heading[1], /<svg|OrionVisualIcon|visual-icon|<span/)
  assert.doesNotMatch(source('dashboard-visual-rhythm.css'), /orion-visual-dashboard-header/)
  const info = source('info-hint.css')
  assert.match(info, /\.info-hint-trigger\s*\{/)
  assert.match(info, /background:\s*transparent/)
  assert.match(info, /border:\s*1px solid var\(--orion-border\)/)
})
