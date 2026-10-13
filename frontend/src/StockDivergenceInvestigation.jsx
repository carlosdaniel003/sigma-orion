import { useEffect, useRef, useState } from 'react'
import ModuleInfoHint from './ModuleInfoHint'
import './stock-divergence-investigation.css'

function formatQuantity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : '—'
}

function StockDivergenceInvestigation({ scenario, stockFile, apiUrl = '' }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controllerRef = useRef(null)

  useEffect(() => {
    controllerRef.current?.abort()
    setResult(null)
    setError('')
    setLoading(false)
    return () => controllerRef.current?.abort()
  }, [scenario, stockFile])

  async function investigate() {
    if (!scenario?.scenario_id || !stockFile || loading) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError('')
    setResult(null)

    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)

    try {
      const response = await fetch(apiUrl + '/api/dpp/investigations/stock-divergence', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || 'Falha ao consultar depósitos.')
      if (!controller.signal.aborted) setResult(payload)
    } catch (failure) {
      if (failure.name !== 'AbortError' && !controller.signal.aborted) {
        setError(failure.message || 'Não foi possível investigar o estoque.')
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setLoading(false)
      }
    }
  }

  const rows = (result?.materials || []).flatMap((material) =>
    material.candidates.map((candidate) => ({ material, candidate })),
  )

  return (
    <section className="orion-stock-investigation" aria-label="Investigação 4.1 — Divergência de estoque">
      <div className="orion-stock-investigation-header">
        <div>
          <div className="module-heading-with-info">
            <h3>4.1 — Divergência de estoque</h3>
            <ModuleInfoHint moduleKey="dashboard.stock_divergence" />
          </div>
          <p>Conferir PNs críticos nos depósitos M221, P277 e G702 da aba ORIGINAL do STK SAP.</p>
          <small>Consulta para validação do PCM com Almoxarifado. Não altera estoque, REAL ou SALDO.</small>
        </div>
        <button type="button" className="secondary-button" onClick={investigate}
          disabled={!scenario?.scenario_id || !stockFile || loading} aria-busy={loading}>
          {loading ? 'Consultando depósitos...' : result ? 'Consultar novamente' : 'Investigar depósitos'}
        </button>
      </div>

      {!stockFile && <p role="status">Adicione o arquivo STK SAP ao pacote para consultar os depósitos.</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <div className="orion-stock-investigation-summary" aria-live="polite">
            <span>PNs críticos: <strong>{result.summary.critical_materials}</strong></span>
            <span>PNs com registros: <strong>{result.summary.materials_with_candidates}</strong></span>
            <span>Sem registros para esses PNs: <strong>{result.summary.materials_without_candidates}</strong></span>
            <span>Depósitos sem registros no arquivo: <strong>{result.summary.depots_without_records.join(', ') || 'nenhum'}</strong></span>
          </div>
          {rows.length ? (
            <div className="orion-stock-investigation-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Material</th><th>Descrição</th><th>SALDO</th><th>Depósito</th><th>Centro</th>
                    <th>Qtd. sob verificação</th><th>Origem no Excel</th><th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ material, candidate }) => (
                    <tr key={[material.material, candidate.depot, candidate.center || '', candidate.unit].join('|')}>
                      <td>{material.material}</td>
                      <td>{material.description || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(material.balance)} {material.unit}</td>
                      <td>{candidate.depot}</td>
                      <td>{candidate.center || '—'}</td>
                      <td className="orion-stock-number">{formatQuantity(candidate.quantity)} {candidate.unit}</td>
                      <td>ORIGINAL · linhas {candidate.source_rows.join(', ')}</td>
                      <td>Aguardando PCM/Almoxarifado</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>Nenhum PN crítico foi encontrado nos depósitos da investigação.</p>}
          {Object.values(result.summary.ignored_records || {}).some((count) => count > 0) && (
            <p>Registros não somados por quantidade inválida, não positiva ou unidade divergente: {Object.entries(result.summary.ignored_records).map(([reason, count]) => reason.replaceAll('_', ' ') + ': ' + count).join(' · ')}.</p>
          )}
          <p className="orion-stock-investigation-note">{result.note}</p>
        </>
      )}
    </section>
  )
}

export default StockDivergenceInvestigation
