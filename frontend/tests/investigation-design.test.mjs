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
