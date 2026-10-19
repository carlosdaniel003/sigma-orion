import { useEffect, useMemo, useRef, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import './dpp-gap-projection.css'

const display = value => value === null || value === undefined
  ? '—' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function reviewSignature(report) {
  return (report?.materials || [])
    .flatMap(material => (material.candidates || [])
      .map(candidate => candidate.candidate_id + ':' + (candidate.validation?.id || 0)))
    .join('|')
}

function Count({ label, value }) {
  return <div className="orion-dpp-gap-count">
    <span>{label}</span><strong>{display(value)}</strong>
  </div>
}

export default function DppGapProjection({
  scenario, stockFile, apiUrl = '', onApplied,
}) {
  const { stockInvestigation, qualityInvestigation, workspaceReady, dppState } = useDppWorkspace()
  const packageKey = workspaceReady && stockFile && dppState.bundle.signature
    ? dppState.bundle.signature + '|' + fileIdentity(stockFile) : ''
  const stockKey = buildStockInvestigationReportKey(packageKey, scenario)
  const stock = stockInvestigation?.reportKey === stockKey
    && stockInvestigation?.packageKey === packageKey
    ? stockInvestigation.result : null
  const stockRevision = useMemo(() => reviewSignature(stock), [stock])
  const expectedQualityKey = stock ? stockKey + '|quality-4.2-v2|' + stockRevision : ''
  const quality = expectedQualityKey && qualityInvestigation?.reportKey === expectedQualityKey
    ? qualityInvestigation.result : null
  const qualityRevision = useMemo(() => reviewSignature(quality), [quality])
  const signature = stock && !scenario?.gap_approval
    ? stockKey + '|full-dpp-gap-v1|' + stockRevision + '|cq:' + qualityRevision : ''

  const [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [approval, setApproval] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [acknowledgedUnresolved, setAcknowledgedUnresolved] = useState(false)
  const modalRef = useRef(null)

  useEffect(() => {
    if (!signature || !scenario?.scenario_id || !stockFile) return undefined
    const controller = new AbortController()
    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)
    setLoading(true)
    setError('')
    fetch(apiUrl + '/api/dpp/monthly/gap/recalculate', {
      method: 'POST', body: form, signal: controller.signal,
    }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível recalcular a prévia.')
      if (!controller.signal.aborted) setSnapshot({ signature, data })
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message || 'Falha no recálculo.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [signature, refresh, scenario?.scenario_id, stockFile, apiUrl])

  useEffect(() => {
    if (approval && modalRef.current && !modalRef.current.open) {
      modalRef.current.showModal()
    }
  }, [approval])

  const result = snapshot?.signature === signature ? snapshot.data : null
  const applied = useMemo(() => (result?.materials || []).filter(item =>
    item.critical && (
      item.recovered_stock > 0 || item.recovered_cq > 0 ||
      item.justified_stock > 0 || item.justified_cq_rejection > 0 ||
      item.justified_cq_scrap > 0
    ),
  ), [result])
  const units = result?.summary?.units || []

  function closeApproval() {
    if (applying) return
    modalRef.current?.close()
    setApproval(null)
    setAcknowledged(false)
    setAcknowledgedUnresolved(false)
  }

  function newForm() {
    const form = new FormData()
    form.append('scenario_id', scenario.scenario_id)
    form.append('stock', stockFile)
    return form
  }

  async function prepareApproval() {
    if (!stock || !stockFile || preparing || applying || loading) return
    setPreparing(true)
    setError('')
    try {
      const response = await fetch(apiUrl + '/api/dpp/monthly/gap/prepare', {
        method: 'POST', body: newForm(),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível conferir as validações.')
      setApproval(data)
      setAcknowledged(false)
      setAcknowledgedUnresolved(false)
    } catch (failure) {
      setError(failure.message || 'Não foi possível preparar a confirmação.')
    } finally {
      setPreparing(false)
    }
  }

  async function applyApproval() {
    if (!approval?.ready || !acknowledged || applying ||
        (approval.unresolved_materials > 0 && !acknowledgedUnresolved)) return
    setApplying(true)
    setError('')
    try {
      const form = newForm()
      form.append('approval_token', approval.approval_token)
      form.append('confirm', 'true')
      form.append('accept_unresolved', String(acknowledgedUnresolved))
      const response = await fetch(apiUrl + '/api/dpp/monthly/gap/apply', {
        method: 'POST', body: form,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível aplicar o gap ao DPP.')
      modalRef.current?.close()
      setApproval(null)
      onApplied?.(data.scenario)
    } catch (failure) {
      setError(failure.message || 'Falha ao aplicar o gap.')
      // The preview is no longer trustworthy if a review changed on the server.
      modalRef.current?.close()
      setApproval(null)
      setAcknowledged(false)
    } finally {
      setApplying(false)
    }
  }

  const approved = scenario?.gap_approval

  return (
    <section className="orion-stock-investigation orion-investigation-ui orion-dpp-gap"
      id="orion-dpp-gap-recalculation" aria-label="Gap do DPP">
      {approved ? (
        <>
          <header className="orion-stock-investigation-header">
            <div>
              <h3>Gap aplicado ao DPP</h3>
              <p>Versão aprovada do DPP de {scenario.reference_month}. As fórmulas do cenário e do Excel agora incluem somente os acréscimos comprovados em Estoque e Qualidade.</p>
            </div>
          </header>
          <div className="orion-dpp-gap-overview">
            <Count label="Materiais recalculados" value={approved.materials_total} />
            <Count label="PNs com explicações registradas" value={approved.materials_with_applied_explanations} />
            <Count label="PNs ainda sem explicação" value={approved.unresolved_materials} />
            <Count label="Validações pendentes na aprovação" value={approved.pending_validations_at_approval} />
          </div>
          <p className="orion-dpp-gap-caption">
            Cenário original preservado: {approved.original_scenario_id}. Aplicação registrada em {approved.approved_at_utc}.
            O novo Excel mensal será gerado com esta versão, sem alterar os valores brutos do STK SAP.
          </p>
          <div className="orion-dpp-gap-units">
            {(approved.recovered_by_unit || []).map(item => (
              <div key={item.unit} className="orion-dpp-gap-approved-unit">
                <strong>{item.unit}</strong>
                <span>Adicional em Estoque: {display(item.from_stock)}</span>
                <span>Adicional liberado no CQ: {display(item.from_quality)}</span>
                <span>Falta sem explicação: {display(item.still_unexplained)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <header className="orion-stock-investigation-header">
            <div>
              <h3>Gap recalculado do DPP</h3>
              <p>Prévia consolidada de Divergência de Estoque e Análise de Qualidade para os materiais do cenário.</p>
              <small>A prévia não altera o DPP. A aplicação definitiva exige validações concluídas e confirmação explícita.</small>
            </div>
            <div className="orion-investigation-actions">
              <button className="secondary-button" type="button"
                disabled={!signature || loading || preparing || applying}
                onClick={() => setRefresh(value => value + 1)} aria-busy={loading}>
                {loading ? 'Atualizando...' : 'Atualizar prévia'}
              </button>
              <button className="secondary-button" type="button"
                disabled={!result || loading || preparing || applying}
                onClick={prepareApproval} aria-busy={preparing}>
                {preparing ? 'Conferindo...' : 'Conferir e aplicar ao DPP'}
              </button>
            </div>
          </header>
          {!stock && <p role="status">Consulte primeiro a Divergência de Estoque para preparar a aplicação.</p>}
          {stock && loading && !result && <p role="status">Atualizando o gap projetado...</p>}
          {result && <>
            <div className="orion-dpp-gap-overview" aria-label="Resumo da projeção">
              <Count label="Materiais do DPP" value={result.summary.materials_total} />
              <Count label="PNs críticos (UN)" value={result.summary.critical_materials} />
              <Count label="PNs com quantidade aplicada ou justificada" value={result.summary.materials_with_applied_explanations} />
              <Count label="PNs com validações pendentes" value={result.summary.critical_materials_with_pending_validations} />
            </div>
            <h4>Falta por unidade de medida</h4>
            <p className="orion-dpp-gap-caption">Somente material disponível e liberado fora do DPP reduz a falta física; justificativas explicam a falta sem gerar estoque.</p>
            <div className="orion-dpp-gap-units">
              {units.filter(item => item.negative_materials > 0).map(item => (
                <section className="orion-dpp-gap-unit" key={item.unit}>
                  <div className="orion-dpp-gap-unit-header">
                    <strong>{item.unit}</strong>
                    <span>{display(item.negative_materials)} materiais negativos</span>
                  </div>
                  <dl>
                    <div><dt>Falta inicial</dt><dd>{display(item.initial_gap)}</dd></div>
                    <div><dt>Recuperado em Estoque</dt><dd>{display(item.recovered_stock)}</dd></div>
                    <div><dt>Gap após Estoque</dt><dd>{display(item.physical_gap_after_stock)}</dd></div>
                    <div><dt>Liberado pelo CQ</dt><dd>{display(item.recovered_cq)}</dd></div>
                    <div><dt>Gap físico após Qualidade</dt><dd>{display(item.physical_gap_after_quality)}</dd></div>
                    <div><dt>Falta sem explicação</dt><dd>{display(item.unexplained_after_quality)}</dd></div>
                  </dl>
                </section>
              ))}
            </div>
            {result.summary.negative_outside_scope > 0 && (
              <p className="orion-dpp-gap-caption">
                {display(result.summary.negative_outside_scope)} material(is) negativo(s) de outras unidades permanecem sem ajuste.
              </p>
            )}
            <div className="orion-dpp-gap-details-header">
              <div>
                <h4>Materiais com análise aplicada</h4>
                <p>{display(applied.length)} PN(s) com quantidades ou justificativas validadas. Os demais materiais permanecem nos totais.</p>
              </div>
              {applied.length > 0 && <button type="button" className="secondary-button"
                onClick={() => setExpanded(value => !value)}>
                {expanded ? 'Ocultar PNs' : 'Ver PNs com ajustes'}
              </button>}
            </div>
            {expanded && applied.length > 0 && (
              <div className="orion-dpp-gap-material-list">
                {applied.map(item => (
                  <details key={item.material}>
                    <summary>
                      <strong>{item.material}</strong>
                      <span>{display(item.initial_gap)} {item.unit} iniciais</span>
                      <span>{display(item.physical_gap_after_quality)} {item.unit} ainda em falta</span>
                    </summary>
                    <div>
                      <p>{item.description || 'Sem descrição'}</p>
                      <dl>
                        <div><dt>Estoque recuperado</dt><dd>{display(item.recovered_stock)} {item.unit}</dd></div>
                        <div><dt>CQ liberado</dt><dd>{display(item.recovered_cq)} {item.unit}</dd></div>
                        <div><dt>Indisponível justificado</dt><dd>{display(item.justified_stock)} {item.unit}</dd></div>
                        <div><dt>CQ justificado</dt><dd>{display(item.justified_cq_rejection + item.justified_cq_scrap)} {item.unit}</dd></div>
                        <div><dt>Falta sem explicação</dt><dd>{display(item.unexplained_after_quality)} {item.unit}</dd></div>
                        <div><dt>SALDO original</dt><dd>{display(item.original_balance)} {item.unit}</dd></div>
                        <div><dt>SALDO projetado</dt><dd>{display(item.projected_balance)} {item.unit}</dd></div>
                      </dl>
                      {item.provisional && <small>Prévia provisória: ainda há confirmações pendentes.</small>}
                    </div>
                  </details>
                ))}
              </div>
            )}
            <p className="orion-dpp-gap-disclaimer">
              O recálculo da prévia não altera o cenário. Clique em "Conferir e aplicar ao DPP"
              somente após todas as confirmações do Almoxarifado e Qualidade.
            </p>
          </>}
        </>
      )}

      {error && <p role="alert" className="orion-dpp-gap-error">{error}</p>}

      <dialog className="orion-dpp-gap-dialog" ref={modalRef}
        aria-labelledby="orion-dpp-gap-dialog-title"
        onCancel={event => { if (applying) event.preventDefault(); else closeApproval() }}>
        {approval && <>
          <h3 id="orion-dpp-gap-dialog-title">Confirmar aplicação ao DPP de {approval.reference_month}</h3>
          <p>Esta ação cria uma nova versão do DPP de julho com o SALDO e os cálculos derivados atualizados pelas liberações confirmadas. O cenário anterior permanece preservado.</p>
          <dl className="orion-dpp-gap-dialog-facts">
            <div><dt>Materiais no DPP</dt><dd>{display(approval.materials_total)}</dd></div>
            <div><dt>PNs críticos analisados</dt><dd>{display(approval.critical_materials)}</dd></div>
            <div><dt>Registros pendentes em Estoque</dt><dd>{display(approval.stock_pending)}</dd></div>
            <div><dt>Registros pendentes na Qualidade</dt><dd>{display(approval.quality_pending)}</dd></div>
            <div><dt>PNs ainda sem explicação</dt><dd>{display(approval.unresolved_materials)}</dd></div>
            <div><dt>PNs sem registros nas duas análises</dt><dd>{display(approval.unlocated_materials)}</dd></div>
          </dl>
          <div className="orion-dpp-gap-dialog-units">
            <strong>Acréscimos validados por unidade</strong>
            {approval.by_unit.map(unit => (
              <p key={unit.unit}>
                {unit.unit}: Estoque +{display(unit.from_stock)} · CQ +{display(unit.from_quality)} · Sem explicação {display(unit.still_unexplained)}
              </p>
            ))}
          </div>
          {!approval.ready ? (
            <div role="status" className="orion-dpp-gap-dialog-blocked">
              <strong>Aplicação bloqueada: confirmações pendentes.</strong>
              <ul>{approval.blockers.map(item => <li key={item}>{item}</li>)}</ul>
              <p>Conclua essas validações nas respectivas áreas antes de solicitar uma nova conferência.</p>
            </div>
          ) : (
            <>
              <label className="orion-dpp-gap-dialog-check">
                <input type="checkbox" checked={acknowledged}
                  onChange={event => setAcknowledged(event.target.checked)} />
                Revisei os impactos e autorizo a criação da nova versão do DPP.
              </label>
              {approval.unresolved_materials > 0 && (
                <label className="orion-dpp-gap-dialog-check">
                  <input type="checkbox" checked={acknowledgedUnresolved}
                    onChange={event => setAcknowledgedUnresolved(event.target.checked)} />
                  Estou ciente de que {approval.unresolved_materials} PN(s) ainda têm falta sem explicação. Nenhum estoque será criado para esses PNs.
                </label>
              )}
            </>
          )}
          <div className="orion-dpp-gap-dialog-actions">
            <button type="button" className="secondary-button" disabled={applying}
              onClick={closeApproval}>Cancelar</button>
            <button type="button" className="primary-button"
              disabled={!approval.ready || !acknowledged || applying ||
                (approval.unresolved_materials > 0 && !acknowledgedUnresolved)}
              onClick={applyApproval}>
              {applying ? 'Aplicando...' : 'Confirmar aplicação ao DPP'}
            </button>
          </div>
        </>}
      </dialog>
    </section>
  )
}
