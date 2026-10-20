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


test('removed dashboard panels stay unmounted while consolidated model plan remains', () => {
  assert.doesNotMatch(source('App.jsx'), /<DppColumnComparison\b/)
  assert.doesNotMatch(source('DashboardLoader.jsx'), /<DppGapProjection\b/)
  assert.doesNotMatch(source('Dashboard.jsx'), /dashboard-complementary-details|Ver indicadores complementares/)
  assert.match(source('App.jsx'), /<FinalModelPlan\b/)
  assert.match(source('Dashboard.jsx'), /<h2>Cenário inicial do DPP<\/h2>/)
})

test('both KPI dialogs use a portal and never treat effect cleanup as a user close', () => {
  const modal = source('InvestigationKpiPanel.jsx')
  assert.match(modal, /createPortal\(/)
  assert.match(modal, /document\.body/)
  assert.match(modal, /useLayoutEffect\(/)
  assert.match(modal, /dialog\.showModal\(\)/)
  assert.match(modal, /if \(dialog\?\.open\) dialog\.close\(\)/)
  assert.match(modal, /onCancel=\{event => \{ event\.preventDefault\(\); onClose\(\) \}\}/)
  assert.doesNotMatch(modal, /onClose=\{onClose\}/)
  for (const file of ['StockDivergenceInvestigation.jsx', 'QualityInvestigation.jsx']) {
    const content = source(file)
    assert.match(content, /<InvestigationKpiGrid\b/)
    assert.match(content, /<InvestigationModal\b/)
    assert.match(content, /onSelect=\{openCategory\}/)
  }
})

test('compact shared monthly package keeps full filename tooltip and responsive grid', () => {
  const picker = source('BulkDppFilePicker.jsx')
  const stylesheet = source('bulk-file-picker.css')
  assert.match(picker, /title=\{file\?\.name \|\| undefined\}/)
  assert.match(stylesheet, /\.bulk-file-picker\.compact \.bulk-file-checks/)
  assert.match(stylesheet, /repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(stylesheet, /@container \(max-width: 400px\)/)
})


test('the full ORION wordmark controls expansion, with only the star visible when collapsed', () => {
  const sidebar = source('WorkspaceNavigation.jsx')
  const brand = source('BrandLogo.jsx')
  const navigation = source('navigation.css')
  assert.match(sidebar, /<BrandLogo collapsed=\{collapsed\} onToggle=\{\(\) => setCollapsed/)
  assert.doesNotMatch(sidebar, /shell-mobile-close|<button className="shell-icon-button" type="button" aria-label=\{collapsed/)
  assert.match(brand, /className="brand-logo-wrap brand-wordmark-toggle"/)
  assert.match(brand, /className="brand-logo brand-logo-full"/)
  assert.match(brand, /className="brand-logo-star"/)
  assert.match(source('brand.css'), /\.shell-sidebar\[data-collapsed='true'\] \.brand-logo-full \{ display: none; \}/)
  assert.match(brand, /aria-expanded=\{!collapsed\}/)
  assert.match(brand, /aria-controls="workspace-navigation"/)
  assert.match(brand, /onClick=\{onToggle\}/)
  assert.match(navigation, /--sidebar-width: 64px/)
})

test('sidebar palettes remain isolated and Mondial background is optional', () => {
  const theme = source('sidebar-theme.css')
  const main = source('main.jsx')
  assert.match(theme, /:root\[data-theme='light'\] \.shell-sidebar/)
  assert.match(theme, /:root\[data-theme='dark'\] \.shell-sidebar/)
  assert.match(theme, /background-color: #000000 !important/)
  assert.match(theme, /background-color: #46D9FF !important/)
  assert.match(theme, /--sidebar-muted: #08111F/)
  assert.match(theme, /scrollbar-width: none/)
  assert.match(theme, /::-webkit-scrollbar/)
  assert.match(theme, /\/assets\/mondial-sidebar\.jpg/)
  assert.match(theme, /pointer-events: none/)
  assert.match(main, /import '\.\/sidebar-theme\.css'/)
})


test('investigation modal close remains visible when PN results scroll', () => {
  const modal = source('investigation-kpi-panel.css')
  assert.match(modal, /\.orion-investigation-dialog-heading \{ position:sticky; top:0; z-index:3;/)
  assert.match(modal, /background:var\(--orion-surface\)/)
  assert.match(modal, /\.orion-investigation-dialog \{[^}]*overflow-y:auto;/)
})

test('dark dashboard preserves visual hierarchy while keeping the Mondial sidebar blue', () => {
  const dark = source('orion-dark-refinement.css')
  const sidebar = source('sidebar-theme.css')
  const main = source('main.jsx')
  assert.match(main, /import '\.\/orion-dark-refinement\.css'/)
  assert.doesNotMatch(main, /orion-inverted-dark\.css/)
  assert.match(dark, /:root\[data-theme='dark'\] \{/)
  assert.match(dark, /--orion-bg: #0D1826/)
  assert.match(dark, /--orion-surface: #142235/)
  assert.match(dark, /--orion-surface-elevated: #1B2D43/)
  assert.match(dark, /--orion-text: #F4F8FC/)
  assert.match(dark, /--orion-text-secondary: #91A4B8/)
  assert.match(dark, /background: var\(--orion-blue\) !important/)
  assert.match(sidebar, /background-color: #46D9FF !important/)
  assert.match(sidebar, /\/assets\/mondial-sidebar\.jpg/)
  assert.doesNotMatch(dark, /:root\[data-theme='light'\]/)
})
