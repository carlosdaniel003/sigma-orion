import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'

/** Somente relatórios da identidade atual do pacote, cenário e revisão de Estoque. */
export function currentInvestigationReports({
  dppState, workspaceReady, stockFile, scenario, stockInvestigation, qualityInvestigation,
}) {
  const packageKey = workspaceReady && stockFile && dppState?.bundle?.signature
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile) : ''
  const stockKey = buildStockInvestigationReportKey(packageKey, scenario)
  const stock = stockKey && stockInvestigation?.reportKey === stockKey
    ? stockInvestigation.result : null
  const revisions = stock
    ? (stock.materials || []).flatMap(item =>
      (item.candidates || []).map(candidate =>
        candidate.candidate_id + ':' + (candidate.validation?.id || 0)),
    ).join(';') : ''
  const qualityKey = stock ? stockKey + '|quality-4.2-v2|' + revisions : ''
  const quality = qualityKey && qualityInvestigation?.reportKey === qualityKey
    ? qualityInvestigation.result : null
  return { stock, quality }
}
