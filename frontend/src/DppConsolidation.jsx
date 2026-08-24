import { useMemo, useState } from 'react'
import './dpp-consolidation.css'

const PAGE_SIZE = 80

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits })
}

function DppConsolidation({ apiUrl }) {
  const [wiu, setWiu] = useState(null)
  const [explosion, setExplosion] = useState(null)
  const [stock, setStock] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('summary')
  const [search, setSearch] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedMaterial, setSelectedMaterial] = useState(null)

  const materials = result?.materials || []
  const models = result?.models || []
  const filteredMaterials = useMemo(() => {
    const term = search.trim().toLowerCase()
    return materials.filter((item) => {
      if (term) {
        const text = `${item.material || ''} ${item.description || ''} ${item.um || ''}`.toLowerCase()
        if (!text.includes(term)) return false
      }
      if (modelFilter && !(item.used_models || []).includes(modelFilter)) return false
      return true
    })
  }, [materials, search, modelFilter])

  const totalPages = Math.max(1, Math.ceil(filteredMaterials.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleMaterials = filteredMaterials.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function updateSearch(value) {
    setSearch(value)
    setPage(1)
  }

  function updateModel(value) {
    setModelFilter(value)
    setPage(1)
  }

  async function consolidate() {
    if (!wiu || !explosion) return
    setLoading(true)
    setError('')
    setResult(null)
    setSelectedMaterial(null)

    const form = new FormData()
    form.append('wiu', wiu)
    form.append('explosion', explosion)
    if (stock) form.append('stock', stock)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/consolidate`, { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível consolidar as fontes do DPP.')
      setResult(data)
      setActiveTab('summary')
      setPage(1)
    } catch (requestError) {
      setError(requestError.message || 'Falha na consolidação mensal.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="page-header consolidation-header">
        <div>
          <span className="eyebrow">FLUXO MENSAL REAL</span>
          <h2>Consolidar DPP</h2>
          <p>Monte a base do DPP diretamente dos arquivos de origem, sem depender do DPP pronto.</p>
        </div>
        <span className="status">Fontes → Python → DPP</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="source-workspace">
        <SourceCard title="WIU" subtitle="Estrutura Material × Modelo" required file={wiu} accept=".xlsx,.xlsm" onChange={setWiu} />
        <SourceCard title="Explosão de Placas" subtitle="EXPLOSÃO consolidada por material" required file={explosion} accept=".xlsx,.xlsm" onChange={setExplosion} />
        <SourceCard title="STK SAP" subtitle="Snapshot do 1º dia do mês" file={stock} accept=".xlsx,.xlsm" onChange={setStock} pendingLabel="Pode ser adicionado depois" />
      </section>

      <section className="panel consolidation-action-panel">
        <div>
          <strong>Consolidação mensal</strong>
          <p>WIU e Explosão já são suficientes para gerar a estrutura consolidada atual. O STK será incorporado automaticamente quando estiver disponível.</p>
        </div>
        <button className="primary-button consolidation-button" type="button" onClick={consolidate} disabled={!wiu || !explosion || loading}>
          {loading ? 'Consolidando fontes...' : 'Gerar DPP consolidado'}
        </button>
      </section>

      {result && (
        <>
          <section className="metrics-grid consolidation-metrics">
            <Metric label="Materiais" value={result.summary.materials} />
            <Metric label="Modelos" value={result.summary.models} />
            <Metric label="Com Explosão" value={result.summary.explosion_matches} tone="ok" />
            <Metric label="STK SAP" value={result.summary.stock_loaded ? result.summary.stock_matches : 'Aguardando'} tone={result.summary.stock_loaded ? 'ok' : 'attention'} />
          </section>

          <section className="consolidation-tabs" aria-label="Seções da consolidação">
            <Tab active={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>Resumo</Tab>
            <Tab active={activeTab === 'materials'} onClick={() => setActiveTab('materials')}>Materiais</Tab>
            <Tab active={activeTab === 'models'} onClick={() => setActiveTab('models')}>Modelos</Tab>
            <Tab active={activeTab === 'sources'} onClick={() => setActiveTab('sources')}>Fontes e pendências</Tab>
          </section>

          {activeTab === 'summary' && <SummaryTab result={result} />}
          {activeTab === 'materials' && (
            <MaterialsTab materials={materials} models={models} visibleMaterials={visibleMaterials} filteredMaterials={filteredMaterials} search={search} modelFilter={modelFilter} updateSearch={updateSearch} updateModel={updateModel} page={safePage} totalPages={totalPages} setPage={setPage} selectedMaterial={selectedMaterial} setSelectedMaterial={setSelectedMaterial} />
          )}
          {activeTab === 'models' && <ModelsTab models={models} />}
          {activeTab === 'sources' && <SourcesTab result={result} />}
        </>
      )}
    </>
  )
}

function SourceCard({ title, subtitle, required = false, file, onChange, accept, pendingLabel }) {
  return (
    <article className={`source-card ${file ? 'source-ready' : ''}`}>
      <div className="source-card-topline">
        <span className={`source-state ${file ? 'ready' : required ? 'required' : 'optional'}`}>{file ? 'Carregado' : required ? 'Obrigatório' : 'Preparado'}</span>
        <small>{required ? 'Fonte mensal' : 'Integração prevista'}</small>
      </div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
      <label className="source-file-control">
        <input type="file" accept={accept} onChange={(event) => onChange(event.target.files?.[0] || null)} />
        <span>{file ? file.name : 'Selecionar arquivo'}</span>
      </label>
      {!file && pendingLabel && <small className="source-pending-text">{pendingLabel}</small>}
    </article>
  )
}

function SummaryTab({ result }) {
  const stockLoaded = result.summary.stock_loaded
  return (
    <div className="consolidation-grid-two">
      <section className="panel">
        <div className="panel-header">
          <div><h3>Pipeline da consolidação</h3><p>O ORION mostra claramente o que já veio das fontes e o que ainda depende de dados mensais.</p></div>
          <span className={`consolidation-status ${stockLoaded ? 'partial-ready' : 'partial'}`}>{result.status}</span>
        </div>
        <div className="pipeline-list">
          <PipelineStep title="WIU → matriz Material × Modelo" state="done" text={`${result.summary.materials.toLocaleString('pt-BR')} materiais importados e ${result.summary.models} modelos estruturados.`} />
          <PipelineStep title="Explosão → material" state="done" text={`${result.summary.explosion_matches.toLocaleString('pt-BR')} materiais da base receberam a explosão consolidada.`} />
          <PipelineStep title="STK SAP → estoque inicial" state={stockLoaded ? 'done' : 'waiting'} text={stockLoaded ? `${result.summary.stock_matches.toLocaleString('pt-BR')} materiais localizados no snapshot SAP.` : 'Aguardando o arquivo extraído no 1º dia do mês.'} />
          <PipelineStep title="NEC e SALDO" state="blocked" text="Serão habilitados quando a fonte/regra de REAL/KIT PGD estiver definida." />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><h3>Campos já reconstruídos</h3><p>Sem usar o arquivo DPP pronto como entrada.</p></div></div>
        <div className="capability-list">
          <Capability label="Material, descrição, UM e origem" enabled />
          <Capability label="73 colunas Material × Modelo" enabled={result.capabilities.material_model_matrix} />
          <Capability label="Check derivado do WIU" enabled={result.capabilities.check_from_wiu} />
          <Capability label="EXPLOSÃO" enabled={result.capabilities.explosion} />
          <Capability label="STK SAP" enabled={result.capabilities.stock_sap} />
          <Capability label="Base disponível = STK + Explosão" enabled={result.capabilities.available_base} />
          <Capability label="NEC" enabled={result.capabilities.nec} />
          <Capability label="SALDO" enabled={result.capabilities.balance} />
        </div>
      </section>
    </div>
  )
}

function MaterialsTab({ models, visibleMaterials, filteredMaterials, search, modelFilter, updateSearch, updateModel, page, totalPages, setPage, selectedMaterial, setSelectedMaterial }) {
  return (
    <section className="panel consolidated-materials-panel">
      <div className="panel-header">
        <div><h3>Materiais consolidados</h3><p>{filteredMaterials.length.toLocaleString('pt-BR')} material(is) no filtro atual.</p></div>
        <span className="status">Página {page} de {totalPages}</span>
      </div>

      <div className="consolidation-filters">
        <label><span>Buscar material</span><input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Código ou descrição" /></label>
        <label>
          <span>Modelo</span>
          <select value={modelFilter} onChange={(event) => updateModel(event.target.value)}>
            <option value="">Todos os modelos</option>
            {models.map((model) => <option key={`${model.name}-${model.code || ''}`} value={model.name}>{model.name} {model.code ? `· ${model.code}` : ''}</option>)}
          </select>
        </label>
      </div>

      <div className={`material-workspace ${selectedMaterial ? 'with-detail' : ''}`}>
        <div className="table-scroll">
          <table className="dpp-table consolidated-table">
            <thead><tr><th>Material</th><th>Descrição</th><th>UM</th><th>Modelos</th><th>Explosão</th><th>STK SAP</th><th>Base disponível</th><th></th></tr></thead>
            <tbody>
              {visibleMaterials.map((item) => (
                <tr key={item.material} className={selectedMaterial?.material === item.material ? 'selected-row' : ''}>
                  <td className="material-code">{item.material}</td><td>{item.description || '—'}</td><td>{item.um || '—'}</td><td>{item.used_models?.length || 0}</td>
                  <td className="number-cell">{formatNumber(item.explosion)}</td><td className="number-cell">{formatNumber(item.stock_sap)}</td><td className="number-cell">{formatNumber(item.available_base)}</td>
                  <td><button type="button" className="secondary-button compact-button" onClick={() => setSelectedMaterial(item)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedMaterial && <MaterialDetail item={selectedMaterial} onClose={() => setSelectedMaterial(null)} />}
      </div>

      <div className="pagination">
        <button className="secondary-button" type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Anterior</button>
        <span>{Math.min((page - 1) * PAGE_SIZE + 1, filteredMaterials.length).toLocaleString('pt-BR')}–{Math.min(page * PAGE_SIZE, filteredMaterials.length).toLocaleString('pt-BR')} de {filteredMaterials.length.toLocaleString('pt-BR')}</span>
        <button className="secondary-button" type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Próxima</button>
      </div>
    </section>
  )
}

function MaterialDetail({ item, onClose }) {
  return (
    <aside className="material-detail-panel">
      <div className="material-detail-header"><div><span className="eyebrow">MATERIAL CONSOLIDADO</span><h3>{item.material}</h3></div><button type="button" className="detail-close" onClick={onClose}>Fechar</button></div>
      <p className="detail-description">{item.description || 'Sem descrição'}</p>
      <div className="detail-kpis"><DetailValue label="Explosão" value={formatNumber(item.explosion)} /><DetailValue label="STK SAP" value={formatNumber(item.stock_sap)} /><DetailValue label="Base disponível" value={formatNumber(item.available_base)} /></div>
      <div className="detail-section"><small>Identificação</small><p>UM: <strong>{item.um || '—'}</strong></p><p>Origem: <strong>{item.group_origin || '—'}</strong></p><p>Modelos: <strong>{item.used_models?.length || 0}</strong></p></div>
      <div className="detail-section"><small>Rastreabilidade</small><p>WIU: <strong>{item.source?.sheet || '—'} · linha inicial {item.source?.first_row || '—'}</strong></p><p>Ocorrências no WIU: <strong>{item.source?.occurrences || 0}</strong></p><p>Explosão: <strong>{item.explosion_source ? `${item.explosion_source.sheet}!${item.explosion_source.cell}` : 'Sem registro; valor 0'}</strong></p><p>STK: <strong>{item.stock_source ? `${item.stock_source.sheet}!${item.stock_source.cell}` : 'Aguardando/sem registro'}</strong></p></div>
      <div className="detail-section"><small>Modelos que utilizam o material</small><div className="model-chip-list">{(item.used_models || []).map((model) => <span key={model}>{model}</span>)}{!item.used_models?.length && <p>Nenhum modelo com consumo maior que zero.</p>}</div></div>
    </aside>
  )
}

function ModelsTab({ models }) {
  return (
    <section className="panel">
      <div className="panel-header"><div><h3>Modelos encontrados no WIU</h3><p>A estrutura é gerada diretamente da fonte mensal e já está pronta para receber plano/REAL posteriormente.</p></div><span className="status">{models.length} modelos</span></div>
      <div className="model-card-grid">{models.map((model) => <article className="model-card" key={`${model.name}-${model.code || ''}`}><small>{model.code || 'Código não informado'}</small><strong>{model.name}</strong><span>{model.material_count.toLocaleString('pt-BR')} materiais</span></article>)}</div>
    </section>
  )
}

function SourcesTab({ result }) {
  return (
    <div className="consolidation-grid-two">
      <section className="panel"><h3>Arquivos utilizados</h3><div className="source-result-list">{result.sources.map((source) => <article key={source.id}><span className={`source-state ${source.loaded ? 'ready' : 'optional'}`}>{source.loaded ? 'Carregado' : 'Aguardando'}</span><div><strong>{source.label}</strong><p>{source.filename || 'Nenhum arquivo enviado'}</p><small>{source.detail}</small></div></article>)}</div></section>
      <section className="panel"><h3>Pendências para o DPP completo</h3><div className="pending-list">{result.pending.map((item) => <div key={item}>{item}</div>)}</div><p className="scope-note">{result.scope}</p></section>
    </div>
  )
}

function PipelineStep({ title, text, state }) {
  return <div className={`pipeline-step pipeline-${state}`}><span className="pipeline-marker" /><div><strong>{title}</strong><p>{text}</p></div></div>
}

function Capability({ label, enabled }) {
  return <div className={enabled ? 'capability-ready' : 'capability-pending'}><span>{enabled ? 'Disponível' : 'Pendente'}</span><strong>{label}</strong></div>
}

function Metric({ label, value, tone = '' }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</strong></article>
}

function DetailValue({ label, value }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

function Tab({ active, children, onClick }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>
}

export default DppConsolidation
