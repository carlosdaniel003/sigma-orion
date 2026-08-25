import { useMemo, useState } from 'react'
import BulkDppFilePicker from './BulkDppFilePicker'
import './dpp-consolidation.css'

const PAGE_SIZE = 80

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function DppConsolidation({ apiUrl }) {
  const [baseDpp, setBaseDpp] = useState(null)
  const [wiu, setWiu] = useState(null)
  const [explosion, setExplosion] = useState(null)
  const [stock, setStock] = useState(null)
  const [pgd, setPgd] = useState(null)
  const [openFile, setOpenFile] = useState(null)
  const [referenceMonth, setReferenceMonth] = useState('')
  const [result, setResult] = useState(null)
  const [realValues, setRealValues] = useState({})
  const [loading, setLoading] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('summary')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedMaterial, setSelectedMaterial] = useState(null)

  const materials = result?.materials || []
  const models = result?.models || []

  const filteredMaterials = useMemo(() => {
    const term = search.trim().toLowerCase()
    return materials.filter((item) => {
      if (term) {
        const text = `${item.material || ''} ${item.description || ''} ${item.optional_material || ''}`.toLowerCase()
        if (!text.includes(term)) return false
      }
      if (statusFilter && item.status !== statusFilter) return false
      return true
    })
  }, [materials, search, statusFilter])

  const openMaterials = useMemo(
    () => materials.filter((item) => (item.open_investigation?.pending_records || 0) > 0),
    [materials],
  )

  const totalPages = Math.max(1, Math.ceil(filteredMaterials.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleMaterials = filteredMaterials.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function resetPaging() {
    setPage(1)
    setSelectedMaterial(null)
  }

  function applyFileBundle(bundle) {
    setBaseDpp(bundle.baseDpp || null)
    setWiu(bundle.wiu || null)
    setExplosion(bundle.explosion || null)
    setStock(bundle.stock || null)
    setPgd(bundle.pgd || null)
    setOpenFile(bundle.openFile || null)
    if (bundle.referenceMonth) setReferenceMonth(bundle.referenceMonth)
    setError('')
  }

  async function generateMonthlyDpp() {
    if (!baseDpp || !wiu || !explosion || !stock || !pgd || !referenceMonth) return
    setLoading(true)
    setError('')
    setResult(null)
    setSelectedMaterial(null)

    const form = new FormData()
    form.append('base_dpp', baseDpp)
    form.append('wiu', wiu)
    form.append('explosion', explosion)
    form.append('stock', stock)
    form.append('pgd', pgd)
    form.append('reference_month', referenceMonth)
    if (openFile) form.append('open_orders', openFile)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/generate`, { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível gerar o novo DPP mensal.')
      setResult(data)
      setRealValues(Object.fromEntries((data.models || []).map((model) => [model.name, model.real ?? model.kit_pgd ?? 0])))
      setActiveTab('summary')
      resetPaging()
    } catch (requestError) {
      setError(requestError.message || 'Falha ao gerar o DPP mensal.')
    } finally {
      setLoading(false)
    }
  }

  async function recalculateReal() {
    if (!result?.scenario_id) return
    setRecalculating(true)
    setError('')
    try {
      const response = await fetch(`${apiUrl}/api/dpp/monthly/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: result.scenario_id, real_by_model: realValues }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível recalcular o cenário REAL.')
      setResult(data)
      setRealValues(Object.fromEntries((data.models || []).map((model) => [model.name, model.real ?? 0])))
      resetPaging()
    } catch (requestError) {
      setError(requestError.message || 'Falha no recálculo do REAL.')
    } finally {
      setRecalculating(false)
    }
  }

  const requiredReady = baseDpp && wiu && explosion && stock && pgd && referenceMonth

  return (
    <>
      <header className="page-header consolidation-header">
        <div>
          <span className="eyebrow">NOVO FLUXO MENSAL</span>
          <h2>Gerar novo DPP</h2>
          <p>Adicione o pacote mensal de arquivos; o ORION identifica cada fonte automaticamente e informa se algo obrigatório estiver faltando.</p>
        </div>
        <span className="status">Pacote → Check → Python → DPP</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="monthly-controls panel">
        <label>
          <span>Mês de referência</span>
          <input type="month" value={referenceMonth} onChange={(event) => setReferenceMonth(event.target.value)} />
        </label>
        <div>
          <strong>Identificação automática</strong>
          <p>O mês é inferido pelos nomes das fontes quando possível. Você ainda pode corrigi-lo manualmente antes de gerar.</p>
        </div>
      </section>

      <BulkDppFilePicker
        mode="generate"
        referenceMonth={referenceMonth}
        onBundle={applyFileBundle}
        title="Adicionar pacote mensal"
      />

      <section className="panel consolidation-action-panel">
        <div>
          <strong>{requiredReady ? 'Pacote pronto para processamento' : 'Aguardando arquivos obrigatórios'}</strong>
          <p>{requiredReady ? 'O ORION reconheceu todas as fontes necessárias para construir o novo DPP.' : 'Adicione os arquivos em massa; o check acima mostra exatamente o que ainda está faltando.'}</p>
        </div>
        <button className="primary-button consolidation-button" type="button" onClick={generateMonthlyDpp} disabled={!requiredReady || loading}>
          {loading ? 'Gerando novo DPP...' : 'Gerar novo DPP'}
        </button>
      </section>

      {result && (
        <>
          <section className="metrics-grid consolidation-metrics monthly-metrics">
            <Metric label="Materiais" value={result.summary.materials} />
            <Metric label="Históricos fora WIU" value={result.summary.historical_outside_wiu} />
            <Metric label="Novos do WIU" value={result.summary.new_materials_from_wiu} tone="ok" />
            <Metric label="OPCs herdados" value={result.summary.inherited_optional_materials} />
            <Metric label="Modelos" value={result.summary.models} />
            <Metric label="Investigar (UN)" value={result.summary.materials_to_investigate} tone={result.summary.materials_to_investigate ? 'attention' : 'ok'} />
          </section>

          <section className="consolidation-tabs" aria-label="Seções do novo DPP">
            <Tab active={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>Resumo</Tab>
            <Tab active={activeTab === 'real'} onClick={() => setActiveTab('real')}>REAL / Produção</Tab>
            <Tab active={activeTab === 'materials'} onClick={() => setActiveTab('materials')}>Materiais</Tab>
            <Tab active={activeTab === 'investigation'} onClick={() => setActiveTab('investigation')}>Investigação OPEN</Tab>
            <Tab active={activeTab === 'sources'} onClick={() => setActiveTab('sources')}>Fontes e regras</Tab>
          </section>

          {activeTab === 'summary' && <SummaryTab result={result} />}
          {activeTab === 'real' && <RealTab models={models} realValues={realValues} setRealValues={setRealValues} recalculate={recalculateReal} recalculating={recalculating} />}
          {activeTab === 'materials' && (
            <MaterialsTab
              materials={visibleMaterials}
              filteredCount={filteredMaterials.length}
              search={search}
              setSearch={(value) => { setSearch(value); resetPaging() }}
              statusFilter={statusFilter}
              setStatusFilter={(value) => { setStatusFilter(value); resetPaging() }}
              page={safePage}
              totalPages={totalPages}
              setPage={setPage}
              selectedMaterial={selectedMaterial}
              setSelectedMaterial={setSelectedMaterial}
            />
          )}
          {activeTab === 'investigation' && <InvestigationTab materials={openMaterials} loaded={result.summary.open_loaded} />}
          {activeTab === 'sources' && <SourcesTab result={result} />}
        </>
      )}
    </>
  )
}

function SummaryTab({ result }) {
  return (
    <div className="consolidation-grid-two">
      <section className="panel">
        <div className="panel-header"><div><h3>Pipeline do novo mês</h3><p>{result.scope}</p></div><span className="consolidation-status">{result.status}</span></div>
        <div className="pipeline-list">
          <PipelineStep title="DPP anterior → base histórica" text={`${result.summary.historical_materials.toLocaleString('pt-BR')} materiais herdados; ${result.summary.inherited_optional_materials.toLocaleString('pt-BR')} OPCs preservados.`} />
          <PipelineStep title="WIU → estrutura atual" text={`${result.summary.new_materials_from_wiu.toLocaleString('pt-BR')} materiais novos e ${result.summary.historical_outside_wiu.toLocaleString('pt-BR')} históricos fora do WIU atual.`} />
          <PipelineStep title="Explosão + STK + STK OP" text={`${result.summary.stock_matches.toLocaleString('pt-BR')} materiais encontrados no STK; ${result.summary.optional_materials_with_stock.toLocaleString('pt-BR')} OPCs com estoque localizado.`} />
          <PipelineStep title="PGD → KIT disponível" text={`${result.summary.pgd_positive_models.toLocaleString('pt-BR')} modelos positivos no PGD; ${result.summary.pgd_unresolved_positive.toLocaleString('pt-BR')} mapeamentos positivos pendentes.`} />
          <PipelineStep title="REAL → NEC → SALDO" text={`${result.summary.materials_to_investigate.toLocaleString('pt-BR')} materiais UN precisam de investigação no cenário atual.`} />
        </div>
      </section>

      <section className="panel">
        <h3>Estado do cenário</h3>
        <div className="capability-list">
          <Capability label="Base histórica" enabled={result.capabilities.historical_base} />
          <Capability label="Materiais acumulativos" enabled={result.capabilities.cumulative_materials} />
          <Capability label="OPC herdado" enabled={result.capabilities.inherited_opc} />
          <Capability label="KIT PGD" enabled={result.capabilities.pgd_kit} />
          <Capability label="REAL manual" enabled={result.capabilities.manual_real} />
          <Capability label="NEC / SALDO" enabled={result.capabilities.balance} />
          <Capability label="OPEN" enabled={result.capabilities.open_investigation} />
          <Capability label="Solver automático" enabled={result.capabilities.automatic_solver} />
        </div>
        <div className="rule-box warning-box">
          <strong>Escopo atual de julgamento</strong>
          <p>A classificação OK/INVESTIGAR segue o processo observado em materiais com UM = UN. Outras UMs continuam visíveis, mas não entram no julgamento automático enquanto a conversão não for confirmada.</p>
        </div>
      </section>
    </div>
  )
}

function RealTab({ models, realValues, setRealValues, recalculate, recalculating }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div><h3>REAL / Produção</h3><p>O KIT PGD é a referência. Ajuste o REAL como hoje é feito no Excel e recalcule NEC e SALDO em Python.</p></div>
        <button className="primary-button" type="button" onClick={recalculate} disabled={recalculating}>{recalculating ? 'Recalculando...' : 'Recalcular com REAL'}</button>
      </div>
      <div className="table-scroll">
        <table className="dpp-table real-table">
          <thead><tr><th>Modelo</th><th>Código</th><th>KIT PGD</th><th>REAL</th><th>Diferença</th><th>Fonte PGD</th></tr></thead>
          <tbody>
            {models.map((model) => (
              <tr key={`${model.name}-${model.code || ''}`} className={model.above_kit ? 'row-warning' : ''}>
                <td><strong>{model.name}</strong></td>
                <td>{model.code || '—'}</td>
                <td className="number-cell">{formatNumber(model.kit_pgd, 0)}</td>
                <td><input type="number" min="0" step="1" value={realValues[model.name] ?? 0} onChange={(event) => setRealValues((current) => ({ ...current, [model.name]: Number(event.target.value) }))} /></td>
                <td className="number-cell">{formatNumber((realValues[model.name] ?? 0) - (model.kit_pgd ?? 0), 0)}</td>
                <td>{model.pgd_source?.reference || 'Sem KIT positivo/mapeado'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function MaterialsTab({ materials, filteredCount, search, setSearch, statusFilter, setStatusFilter, page, totalPages, setPage, selectedMaterial, setSelectedMaterial }) {
  return (
    <section className="panel consolidated-materials-panel">
      <div className="panel-header"><div><h3>Materiais do novo DPP</h3><p>{filteredCount.toLocaleString('pt-BR')} material(is) no filtro atual.</p></div><span className="status">Página {page} de {totalPages}</span></div>
      <div className="consolidation-filters">
        <label><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, descrição ou OPC" /></label>
        <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos</option><option value="INVESTIGAR">Investigar</option><option value="OK">OK</option><option value="FORA_ESCOPO_UM">Fora do escopo UM</option></select></label>
      </div>
      <div className={`material-workspace ${selectedMaterial ? 'with-detail' : ''}`}>
        <div className="table-scroll">
          <table className="dpp-table consolidated-table">
            <thead><tr><th>Material</th><th>Descrição</th><th>UM</th><th>Base</th><th>OPC</th><th>STK</th><th>Explosão</th><th>STK OP</th><th>STK TTL</th><th>NEC</th><th>SALDO</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {materials.map((item) => (
                <tr key={item.material} className={item.status === 'INVESTIGAR' ? 'row-warning' : ''}>
                  <td className="material-code">{item.material}</td><td>{item.description || '—'}</td><td>{item.um || '—'}</td>
                  <td>{item.in_current_wiu ? 'WIU atual' : 'Histórico'}</td><td>{item.optional_material || '—'}</td>
                  <td className="number-cell">{formatNumber(item.stock_sap)}</td><td className="number-cell">{formatNumber(item.explosion)}</td><td className="number-cell">{formatNumber(item.stock_op)}</td><td className="number-cell">{formatNumber(item.stock_total)}</td><td className="number-cell">{formatNumber(item.nec)}</td><td className="number-cell">{formatNumber(item.balance)}</td><td><StatusBadge value={item.status} /></td>
                  <td><button className="secondary-button compact-button" type="button" onClick={() => setSelectedMaterial(item)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedMaterial && <MaterialDetail item={selectedMaterial} onClose={() => setSelectedMaterial(null)} />}
      </div>
      <div className="pagination"><button className="secondary-button" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {totalPages}</span><button className="secondary-button" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Próxima</button></div>
    </section>
  )
}

function MaterialDetail({ item, onClose }) {
  return (
    <aside className="material-detail-panel">
      <div className="material-detail-header"><div><span className="eyebrow">MATERIAL</span><h3>{item.material}</h3></div><button className="detail-close" type="button" onClick={onClose}>Fechar</button></div>
      <p className="detail-description">{item.description || 'Sem descrição'}</p>
      <div className="detail-kpis"><DetailValue label="STK TTL" value={formatNumber(item.stock_total)} /><DetailValue label="NEC" value={formatNumber(item.nec)} /><DetailValue label="SALDO" value={formatNumber(item.balance)} /></div>
      <div className="detail-section"><small>Histórico</small><p>Origem da base: <strong>{item.from_history ? 'DPP anterior' : 'Novo no WIU'}</strong></p><p>No WIU atual: <strong>{item.in_current_wiu ? 'Sim' : 'Não'}</strong></p><p>OPC herdado: <strong>{item.optional_material || '—'}</strong></p></div>
      <div className="detail-section"><small>Rastreabilidade</small><p>DPP anterior: <strong>{item.historical_source?.reference || '—'}</strong></p><p>WIU: <strong>{item.wiu_source ? `${item.wiu_source.sheet} · linha ${item.wiu_source.first_row}` : 'Sem ocorrência atual'}</strong></p><p>STK: <strong>{item.stock_source ? `${item.stock_source.sheet}!${item.stock_source.cell}` : 'Sem registro'}</strong></p><p>Explosão: <strong>{item.explosion_source ? `${item.explosion_source.sheet}!${item.explosion_source.cell}` : 'Sem registro'}</strong></p><p>STK OP: <strong>{item.stock_op_source ? `${item.stock_op_source.sheet}!${item.stock_op_source.cell}` : 'Sem registro'}</strong></p></div>
      <div className="detail-section"><small>Modelos atuais</small><div className="model-chip-list">{(item.used_models || []).map((model) => <span key={model}>{model}</span>)}{!item.used_models?.length && <p>Nenhum consumo no WIU atual.</p>}</div></div>
      <div className="detail-section"><small>OPEN</small><p>Registros pendentes: <strong>{item.open_investigation?.pending_records || 0}</strong></p>{(item.open_investigation?.entries || []).slice(0, 8).map((entry, index) => <article className="open-entry-card" key={`${entry.pi || ''}-${entry.po || ''}-${index}`}><strong>{entry.pi || 'Sem PI'}</strong><span>{entry.po || 'Sem PO'} · {formatNumber(entry.quantity)} {entry.um || ''}</span></article>)}</div>
    </aside>
  )
}

function InvestigationTab({ materials, loaded }) {
  if (!loaded) return <section className="panel"><h3>Investigação OPEN</h3><p>O OPEN não foi carregado. Ele é opcional e não altera o cálculo do DPP.</p></section>
  return <section className="panel"><div className="panel-header"><div><h3>Materiais com evidência OPEN</h3><p>Use esta visão depois que o SALDO indicar necessidade de investigação.</p></div><span className="status">{materials.length.toLocaleString('pt-BR')} materiais</span></div><div className="table-scroll"><table className="dpp-table"><thead><tr><th>Material</th><th>Descrição</th><th>SALDO</th><th>Registros pendentes</th><th>Quantidade OPEN</th><th>PIs</th></tr></thead><tbody>{materials.map((item) => <tr key={item.material}><td className="material-code">{item.material}</td><td>{item.description || '—'}</td><td className="number-cell">{formatNumber(item.balance)}</td><td>{item.open_investigation.pending_records}</td><td className="number-cell">{formatNumber(item.open_investigation.pending_quantity)}</td><td>{(item.open_investigation.entries || []).slice(0, 4).map((entry) => entry.pi).filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div></section>
}

function SourcesTab({ result }) {
  return (
    <div className="consolidation-grid-two">
      <section className="panel"><h3>Fontes utilizadas</h3><div className="source-result-list">{result.sources.map((source) => <article key={source.id}><span className={`source-state ${source.loaded ? 'ready' : 'optional'}`}>{source.loaded ? 'OK' : 'Opcional'}</span><div><strong>{source.label}</strong><p>{source.filename || 'Não carregado'}</p><small>{source.detail}</small></div></article>)}</div></section>
      <section className="panel"><h3>Regras e pendências</h3><div className="pending-list">{result.pending.map((item) => <div key={item}>{item}</div>)}</div><div className="rule-box"><strong>Mapeamento PGD</strong><p>Mapeados: {result.pgd_mapping.mapped.length}. Positivos sem variante resolvida: {result.pgd_mapping.unresolved_positive.length}. Positivos fora do escopo dos modelos atuais: {result.pgd_mapping.out_of_scope_positive.length}.</p></div>{result.pgd_mapping.unresolved_positive.length > 0 && <div className="rule-box warning-box"><strong>Revisar variantes</strong><p>{result.pgd_mapping.unresolved_positive.map((item) => `${item.name} → ${item.candidate_models.join(', ')}`).join(' | ')}</p></div>}</section>
    </div>
  )
}

function Metric({ label, value, tone = '' }) { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</strong></article> }
function Tab({ active, children, onClick }) { return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button> }
function PipelineStep({ title, text }) { return <div className="pipeline-step pipeline-done"><span className="pipeline-marker" /><div><strong>{title}</strong><p>{text}</p></div></div> }
function Capability({ label, enabled }) { return <div className={enabled ? 'capability-ready' : 'capability-pending'}><strong>{label}</strong><span>{enabled ? 'Disponível' : 'Depois'}</span></div> }
function DetailValue({ label, value }) { return <div><small>{label}</small><strong>{value}</strong></div> }
function StatusBadge({ value }) { const className = value === 'INVESTIGAR' ? 'warning' : value === 'OK' ? 'ok' : 'neutral'; return <span className={`unit-badge ${className}`}>{value}</span> }

export default DppConsolidation