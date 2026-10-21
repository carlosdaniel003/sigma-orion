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


test('operational overview replaces the initial DPP panel and aligns with month package', () => {
  const loader = source('DashboardLoader.jsx')
  const overview = source('InvestigationOverview.jsx')
  const layout = source('dashboard-hierarchy.css')
  assert.doesNotMatch(loader, /<Dashboard\b/)
  assert.match(loader, /<InvestigationOverview\b/)
  assert.match(overview, /<h3>Resumo operacional<\/h3>/)
  assert.match(layout, /\.dashboard-operational-top/)
  assert.match(layout, /\.dashboard-investigation-pair/)
  assert.match(layout, /\.dashboard-shared-package > \.bulk-file-picker\.compact/)
  assert.match(layout, /padding:\s*var\(--space-4\) !important/)
  assert.match(layout, /border:\s*1px solid var\(--orion-border\) !important/)
})


test('removed dashboard panels stay unmounted while consolidated model plan remains', () => {
  assert.doesNotMatch(source('App.jsx'), /<DppColumnComparison\b/)
  assert.doesNotMatch(source('DashboardLoader.jsx'), /<DppGapProjection\b/)
  assert.doesNotMatch(source('Dashboard.jsx'), /dashboard-complementary-details|Ver indicadores complementares/)
  assert.match(source('DashboardLoader.jsx'), /<FinalModelPlan\b/)
  assert.doesNotMatch(source('DashboardLoader.jsx'), /<Dashboard\b|Cenário inicial do DPP/)
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

test('sidebar preserves light black / dark charcoal and the Mondial photograph', () => {
  const theme = source('sidebar-theme.css')
  const main = source('main.jsx')
  assert.match(theme, /:root\[data-theme='light'\] \.shell-sidebar/)
  assert.match(theme, /:root\[data-theme='dark'\] \.shell-sidebar/)
  assert.match(theme, /background-color: #000000 !important/)
  assert.match(theme, /background-color: #090A0C !important/)
  assert.match(theme, /--sidebar-ink: #F5F5F6/)
  assert.match(theme, /--sidebar-star: #46D9FF/)
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
  assert.match(modal, /\.orion-investigation-dialog \{[^}]*overflow:hidden;/)
  assert.match(modal, /\.orion-investigation-dialog\[open\] \{ display:flex; flex-direction:column; \}/)
  assert.match(modal, /\.orion-investigation-dialog-content \{[^}]*overflow-y:auto;/)
  assert.match(modal, /\.orion-investigation-dialog-content \{[^}]*overscroll-behavior-y:contain;/)
  assert.match(modal, /\.orion-investigation-dialog::backdrop \{[^}]*backdrop-filter:blur\(3px\);/)
})

test('dark Mondial palette is neutral, readable, and sparing with ORION cyan', () => {
  const dark = source('orion-dark-refinement.css')
  const sidebar = source('sidebar-theme.css')
  const main = source('main.jsx')
  assert.match(main, /import '\.\/orion-dark-refinement\.css'/)
  assert.match(dark, /:root\[data-theme='dark'\] \{/)
  assert.match(dark, /--orion-bg: #191A1D/)
  assert.match(dark, /--orion-surface: #242529/)
  assert.match(dark, /--orion-surface-elevated: #2E3035/)
  assert.match(dark, /--orion-text: #F5F5F6/)
  assert.match(dark, /--orion-text-secondary: #BBC0C8/)
  assert.match(dark, /background: var\(--orion-text\) !important/)
  assert.doesNotMatch(dark, /--orion-bg: #46D9FF|--orion-surface: #46D9FF/)
  assert.match(sidebar, /background-color: #090A0C !important/)
  assert.match(sidebar, /\/assets\/mondial-sidebar\.jpg/)
  assert.doesNotMatch(dark, /:root\[data-theme='light'\]/)

  const rgb = hex => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const luminance = hex => rgb(hex).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (values[0] + 0.05) / (values[1] + 0.05)
  }
  assert.ok(contrast('#F5F5F6', '#242529') >= 7, 'primary text on cards meets AAA')
  assert.ok(contrast('#BBC0C8', '#242529') >= 4.5, 'secondary labels stay readable')
  assert.ok(contrast('#F5F5F6', '#090A0C') >= 7, 'sidebar white on charcoal meets AAA')
})


test('stock and quality consultations start automatically without manual buttons', () => {
  const stock = source('StockDivergenceInvestigation.jsx')
  const quality = source('QualityInvestigation.jsx')
  assert.match(stock, /fetchReport\(\{ automatic: true \}\)/)
  assert.match(quality, /Consulta automaticamente/)
  assert.doesNotMatch(stock, /Consultar novamente|Investigar depósitos/)
  assert.doesNotMatch(quality, /Consultar novamente|Consultar Qualidade/)
  assert.match(stock, /ensureScenarioAvailable/)
  assert.match(quality, /ensureScenarioAvailable/)
})

test('suspended browser does not show cached investigation metrics when server scenario is missing', () => {
  const loader = source('DashboardLoader.jsx')
  const session = source('useScenarioAvailability.js')
  assert.match(loader, /scenarioUsable \?/)
  assert.match(loader, /scenarioMatchesPackage/)
  assert.match(loader, /Cenário não disponível no servidor/)
  assert.match(loader, /Reprocessar pacote salvo/)
  assert.match(loader, /<FinalModelPlan finalDppAnalysis=\{finalDppAnalysis\} \/>/)
  assert.doesNotMatch(source('App.jsx'), /<FinalModelPlan\b/)
  assert.match(session, /visibilitychange/)
  assert.match(session, /pageshow/)
  assert.match(session, /focus/)
  assert.match(session, /cache: 'no-store'/)
  assert.match(session, /\/availability'/)
  assert.match(source('DashboardLoader.jsx'), /ensureScenarioAvailable=\{scenarioAccess\.check\}/)
})

test('dashboard stage one uses a responsive two-row composition without duplicating operational modules', () => {
  const loader = source('DashboardLoader.jsx')
  const layout = source('dashboard-hierarchy.css')
  const modal = source('InvestigationKpiPanel.jsx')
  assert.match(loader, /<div className="dashboard-operational-top">/)
  assert.match(loader, /<div className="dashboard-investigation-workspace">/)
  assert.match(loader, /<div className="dashboard-investigation-pair">/)
  assert.match(loader, /<PendingValidations\b/)
  assert.equal((loader.match(/<InvestigationOverview\b/g) || []).length, 1)
  assert.equal((loader.match(/<StockDivergenceInvestigation\b/g) || []).length, 1)
  assert.equal((loader.match(/<QualityInvestigation\b/g) || []).length, 1)
  assert.equal((loader.match(/<BulkDppFilePicker\b/g) || []).length, 2)
  assert.match(loader, /<FinalModelPlan finalDppAnalysis=\{finalDppAnalysis\} \/>/)
  assert.match(layout, /grid-template-columns:\s*minmax\(0, 0\.37fr\) minmax\(0, 0\.63fr\)/)
  assert.match(layout, /@container \(max-width:1100px\)/)
  assert.match(layout, /@container \(max-width:980px\)/)
  assert.doesNotMatch(layout, /^\s*order:\s*\d/m)
  assert.match(modal, /aria-haspopup="dialog"/)
  assert.match(modal, /aria-label=\{\x60\$\{metric\.label\}/)
  assert.doesNotMatch(modal, /<small>Ver itens e detalhes<\/small>/)
})


test('investigation dialogs lock background scrolling and retain accessible internal content', () => {
  const js = source('InvestigationKpiPanel.jsx')
  const lock = source('modal-scroll-lock.js')
  const modal = source('investigation-kpi-panel.css')
  assert.match(js, /acquirePageScrollLock\(\)/)
  assert.match(js, /releaseScrollLock\(\)/)
  assert.match(js, /role="region"/)
  assert.match(js, /tabIndex=\{0\}/)
  assert.match(modal, /\.orion-investigation-dialog-search \{ flex:0 0 auto;/)
  assert.match(modal, /@media \(prefers-reduced-transparency:reduce\)/)
  assert.match(lock, /body\.style\.position = 'fixed'/)
  assert.match(lock, /window\.scrollTo\(scrollX, scrollY\)/)
})


test('pending queue is a live read-only view with direct PN navigation', () => {
  const loader = source('DashboardLoader.jsx')
  const panel = source('PendingValidations.jsx')
  const stock = source('StockDivergenceInvestigation.jsx')
  const quality = source('QualityInvestigation.jsx')
  const modal = source('InvestigationKpiPanel.jsx')
  const layout = source('dashboard-hierarchy.css')
  assert.match(loader, /<PendingValidations scenario=\{generatedScenario\}/)
  assert.match(loader, /pendingRequest=\{pendingRequest\}/)
  assert.match(loader, /scenarioId: generatedScenario\.scenario_id/)
  assert.match(panel, /pendingInvestigationItems\(stock, 'stock'\)/)
  assert.match(panel, /qualityPendingItems\(stock, quality\)/)
  assert.match(panel, /onOpen\(area, item\.pn\)/)
  assert.match(panel, /onOpen\(area, ''\)/)
  assert.match(panel, /moduleKey="dashboard\.pending_validations"/)
  assert.match(stock, /pendingRequest\.area !== 'stock'/)
  assert.match(quality, /pendingRequest\.area !== 'quality'/)
  assert.match(stock, /pendingRequest\.scenarioId !== scenario\?\.scenario_id/)
  assert.match(quality, /pendingRequest\.scenarioId !== scenario\?\.scenario_id/)
  assert.match(stock, /openCategory\('pending', pendingRequest\.material\)/)
  assert.match(quality, /openCategory\('pending', pendingRequest\.material\)/)
  assert.match(modal, /initialQuery = ''/)
  assert.match(layout, /grid-template-columns:minmax\(0, 0\.62fr\) minmax\(0, 0\.38fr\)/)
  assert.match(layout, /\.dashboard-investigation-pair \{\s*grid-template-columns:minmax\(0,\s*1fr\)/)
  assert.doesNotMatch(panel, /fetch\(|\/api\//)
})

test('final dashboard visual audit keeps one layout owner and drops legacy-only stylesheet imports', () => {
  const entry = source('main.jsx')
  const layout = source('dashboard-hierarchy.css')
  const rhythm = source('dashboard-visual-rhythm.css')
  const pending = source('pending-validations.css')
  const plan = source('final-model-plan.css')

  for (const legacy of [
    'dashboard-kpi-polish.css',
    'dashboard-table-polish.css',
    'dashboard-operational-polish.css',
    'dashboard-theme-runtime-fixes.css',
  ]) {
    assert.doesNotMatch(entry, new RegExp(legacy.replaceAll('.', '\.') + "'"))
  }

  assert.match(layout, /dashboard-investigation-workspace/)
  assert.match(layout, /grid-template-columns:minmax\(0, 0\.62fr\) minmax\(0, 0\.38fr\)/)
  assert.match(layout, /@container \(max-width:980px\)/)
  assert.match(layout, /@container \(max-width:760px\)/)
  assert.match(layout, /dashboard-operational-top \.orion-investigation-overview-metric \{[^}]*border:0;/)
  assert.doesNotMatch(layout, /^\s*order:\s*\d/m)

  assert.match(rhythm, /\.orion-investigation-overview-metrics/)
  assert.doesNotMatch(rhythm, /\.orion-visual-coverage|\.orion-investigation-queue|\.dashboard-plan-overview/)
  assert.match(pending, /\.orion-pending-validations \.module-heading-with-info \{[^}]*border-bottom:1px solid var\(--orion-border\)/)
  assert.match(pending, /overflow-wrap:anywhere/)
  assert.doesNotMatch(plan, /^\s*order:\s*25;/m)
  assert.match(plan, /\.final-model-plan-sources \{[^}]*min-width: 0;/)
  assert.match(plan, /\.final-model-plan-source strong \{[^}]*overflow-wrap: anywhere;/)
})


test('dashboard module icons use one unboxed neutral SVG style in four approved headings', () => {
  const icons = source('DashboardModuleIcon.jsx')
  const css = source('dashboard-module-icons.css')
  const packagePicker = source('BulkDppFilePicker.jsx')
  const stock = source('StockDivergenceInvestigation.jsx')
  const quality = source('QualityInvestigation.jsx')
  const pending = source('PendingValidations.jsx')

  assert.match(packagePicker, /<DashboardModuleIcon name="files" \/>/)
  assert.match(stock, /<DashboardModuleIcon name="stock" \/>/)
  assert.match(quality, /<DashboardModuleIcon name="quality" \/>/)
  assert.match(pending, /<DashboardModuleIcon name="pending" \/>/)
  for (const name of ['files', 'stock', 'quality', 'pending']) {
    assert.match(icons, new RegExp('^  ' + name + ': <path ', 'm'))
  }
  assert.match(icons, /aria-hidden="true" focusable="false"/)
  assert.match(css, /stroke: currentColor;/)
  assert.match(css, /stroke-width: 1\.7;/)
  assert.match(css, /color: var\(--orion-text-secondary\);/)
  assert.match(css, /width: 20px;/)
  assert.match(css, /height: 20px;/)
  assert.doesNotMatch(css, /background(?:-color)?:|border(?:-radius)?:|box-shadow:|filter:/)
  assert.doesNotMatch(source('InvestigationOverview.jsx'), /DashboardModuleIcon/)
  assert.doesNotMatch(source('FinalModelPlan.jsx'), /DashboardModuleIcon/)
})
