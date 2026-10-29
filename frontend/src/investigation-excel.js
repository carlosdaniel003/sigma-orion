/** Download the current investigation as a server-recomputed Excel workbook. */
export async function downloadInvestigationExcel({ apiUrl = '', endpoint, scenario, stockFile }) {
  if (!scenario?.scenario_id || !stockFile) {
    throw new Error('O cenário e o arquivo STK SAP precisam estar carregados.')
  }

  const body = new FormData()
  body.append('scenario_id', scenario.scenario_id)
  body.append('stock', stockFile)
  const response = await fetch(apiUrl + endpoint, { method: 'POST', body })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.detail || 'Não foi possível gerar o Excel desta investigação.')
  }

  const fallback = endpoint.includes('/quality/') ? 'ORION_Qualidade_Investigacao.xlsx' : 'ORION_Estoque_Investigacao.xlsx'
  const disposition = response.headers.get('Content-Disposition') || ''
  const matches = disposition.match(/filename="?([^";]+)"?/i)
  const filename = matches ? matches[1].replace(/[\\/:*?"<>|]/g, '_') : fallback
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
}
