import { useEffect, useMemo, useRef, useState } from 'react'
import { useDppWorkspace } from './DppWorkspaceContext'
import { buildStockInvestigationReportKey, fileIdentity } from './dpp-workspace-state'
import { InvestigationModal, InvestigationRecord } from './InvestigationKpiPanel'
import './dpp-gap-projection.css'

const display = value => value === null || value === undefined
  ? '—' : Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

function reviewSignature(report) {
  return (report?.materials || [])
    .flatMap(material => (material.candidates || [])
      .map(candidate => candidate.candidate_id + ':' + (candidate.validation?.id || 0)))
    .join('|')
}

function Count({ label, value, onClick }) {
  return <button type="button" className="orion-dpp-gap-count orion-kpi-tile"
    aria-haspopup="dialog" onClick={onClick}>
    <span>{label}</span><strong>{display(value)}</strong><small>Ver detalhes</small>
  </button>
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
  const [activeGroup, setActiveGroup] = useState('')
  const [approvedGroup, setApprovedGroup] = useState('')
  const approvedModalRef = useRef(null)
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

  useEffect(() => {
    const dialog = approvedModalRef.current
    if (approvedGroup && dialog && !dialog.open) dialog.showModal()
    if (!approvedGroup && dialog?.open) dialog.close()
  }, [approvedGroup])

  const result = snapshot?.signature === signature ? snapshot.data : null
  const applied = useMemo(() => (result?.materials || []).filter(item =>
    item.critical && (
      item.recovered_stock > 0 || item.recovered_cq > 0 ||
      item.justified_stock > 0 || item.justified_cq_rejection > 0 ||
      item.justified_cq_scrap > 0
    ),
  ), [result])
  const units = result?.summary?.units || []
  const gapGroups = useMemo(() => {
    const materials = result?.materials || []
    const changed = item => item.critical && (
      item.recovered_stock > 0 || item.recovered_cq > 0 ||
      item.justified_stock > 0 || item.justified_cq_rejection > 0 ||
      item.justified_cq_scrap > 0
    )
    return [
      { key: 'all', label: 'Materiais do DPP', items: materials },
      { key: 'critical', label: 'PNs críticos (UN)', items: materials.filter(item => item.critical) },
      { key: 'applied', label: 'PNs com quantidade aplicada ou justificada', items: materials.filter(changed) },
      { key: 'pending', label: 'PNs com validações pendentes', items: materials.filter(item => item.critical && item.pending_validations > 0) },
    ]
  }, [result])
  const selectedGap = gapGroups.find(group => group.key === activeGroup)


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
            <Count label="Materiais recalculados" value={approved.materials_total}
              onClick={() => setApprovedGroup('Materiais recalculados')} />
            <Count label="PNs com explicações registradas" value={approved.materials_with_applied_explanations}
              onClick={() => setApprovedGroup('PNs com explicações registradas')} />
            <Count label="PNs ainda sem explicação" value={approved.unresolved_materials}
              onClick={() => setApprovedGroup('PNs ainda sem explicação')} />
            <Count label="Validações pendentes na aprovação" value={approved.pending_validations_at_approval}
              onClick={() => setApprovedGroup('Validações pendentes na aprovação')} />
          </div>
          <p className="orion-dpp-gap-caption">
            Cenário original preservado: {approved.original_scenario_id}. Aplicação registrada em {approved.approved_at_utc}.
            O novo Excel mensal será gerado com esta versão, sem alterar os valores brutos do STK SAP.
          </p>
          <dialog ref={approvedModalRef} className="orion-dpp-gap-dialog"
            aria-label={approvedGroup || 'Auditoria do DPP aplicado'}
            onClose={() => setApprovedGroup('')}>
            <div className="orion-stock-review-heading">
              <h3>{approvedGroup}</h3>
              <button type="button" className="secondary-button"
                onClick={() => approvedModalRef.current?.close()}>Fechar</button>
            </div>
            <p>Registro de aplicação do DPP de {scenario.reference_month}. O cenário original permanece preservado.</p>
            <dl className="orion-dpp-gap-dialog-facts">
              <div><dt>Materiais recalculados</dt><dd>{display(approved.materials_total)}</dd></div>
              <div><dt>PNs com explicações</dt><dd>{display(approved.materials_with_applied_explanations)}</dd></div>
              <div><dt>PNs ainda sem explicação</dt><dd>{display(approved.unresolved_materials)}</dd></div>
              <div><dt>Validações pendentes quando aprovado</dt><dd>{display(approved.pending_validations_at_approval)}</dd></div>
            </dl>
            <div className="orion-dpp-gap-dialog-units">
              <strong>Acréscimos e faltas por unidade</strong>
              {(approved.recovered_by_unit || []).map(item => (
                <p key={item.unit}>{item.unit}: Estoque +{display(item.from_stock)} · CQ +{display(item.from_quality)} · Sem explicação {display(item.still_unexplained)}</p>
              ))}
            </div>
            <p>Cenário de origem: {approved.original_scenario_id}. Aplicado em: {approved.approved_at_utc}.</p>
          </dialog>
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
            <div className="orion-dpp-gap-overview" aria-label="Indicadores clicáveis da projeção">
              {gapGroups.map(group => (
                <Count key={group.key} label={group.label} value={group.items.length}
                  onClick={() => setActiveGroup(group.key)} />
              ))}
            </div>
            <p className="orion-dpp-gap-disclaimer">
              Apenas liberações validadas fora do DPP reduzem a falta física.
              Selecione um indicador para visualizar o detalhamento. Esta prévia não altera o DPP.
            </p>
          </>}
          {selectedGap && <InvestigationModal key={signature + ':' + activeGroup}
            modalKey={signature + ':' + activeGroup} title={selectedGap.label}
            items={selectedGap.items} onClose={() => setActiveGroup('')}>
            {visible => <>
              {activeGroup === 'all' && <>
                <h4>Falta por unidade de medida</h4>
                <p className="orion-dpp-gap-caption">Apenas faltas da mesma unidade podem ser somadas.</p>
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
              </>}
              {visible.map(item => (
                <InvestigationRecord key={item.material} material={item}
                  facts={[
                    { label: 'SALDO original', value: display(item.original_balance) + ' ' + item.unit },
                    { label: 'Falta inicial', value: display(item.initial_gap) + ' ' + item.unit },
                    { label: 'Estoque encontrado', value: display(item.found_stock) + ' ' + item.unit },
                    { label: 'Recuperado em Estoque', value: display(item.recovered_stock) + ' ' + item.unit },
                    { label: 'Liberação CQ', value: display(item.recovered_cq) + ' ' + item.unit },
                    { label: 'Indisponível justificada', value: display(item.justified_stock) + ' ' + item.unit },
                    { label: 'Reprovação/refugo justificados', value: display(item.justified_cq_rejection + item.justified_cq_scrap) + ' ' + item.unit },
                    { label: 'Gap físico após CQ', value: display(item.physical_gap_after_quality) + ' ' + item.unit },
                    { label: 'Falta sem explicação', value: display(item.unexplained_after_quality) + ' ' + item.unit },
                    { label: 'SALDO projetado', value: display(item.projected_balance) + ' ' + item.unit },
                    { label: 'Validações pendentes', value: display(item.pending_validations) },
                  ]}
                  status={item.provisional ? 'Projeção provisória, confirmação pendente' : ''}
                  note={item.critical ? 'Material crítico considerado pelo fluxo de Estoque e Qualidade.' : 'Material fora do escopo de recuperação automática destas investigações.'} />
              ))}
            </>}
          </InvestigationModal>}
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
