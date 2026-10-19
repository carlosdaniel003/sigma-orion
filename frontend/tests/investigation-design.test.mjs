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

test('SVG use remains tied to actual navigation actions', () => {
  const summary = source('InvestigationOverview.jsx')
  assert.match(summary, /href="#orion-stock-investigation"/)
  assert.match(summary, /href="#orion-quality-investigation"/)
  assert.doesNotMatch(summary, /className="orion-visual-journey"/)
  for (const file of ['StockDivergenceInvestigation.jsx', 'QualityInvestigation.jsx']) {
    const content = source(file)
    assert.match(content, /href="#orion-investigation-overview"/)
    assert.match(content, /<OrionVisualIcon name="up" size=\{16\}/)
  }
})

test('the workbooks are unaffected by the presentation-only design update', () => {
  assert.doesNotMatch(source('dashboard-visual-rhythm.css'), /(?:workbook|worksheet|spreadsheet|xlsx)/i)
  assert.match(source('InvestigationOverview.jsx'), /aria-label="Registros encontrados"/)
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
