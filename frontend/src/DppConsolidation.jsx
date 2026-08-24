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
  const [openFile, setOpenFile] = useState(null)
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

  const openMaterials = useMemo(
    () => materials
      .filter((item) => (item.open_investigation?.pending_records || 0) > 0)
      .sort((a, b) => (b.open_investigation?.pending_records || 0) - (a.open_investigation?.pending_records || 0)),
    [materials],
  )

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
    if (!wiu || !explosion || !stock) return
    setLoading(true)
    setError('')
    setResult(null)
    setSelectedMaterial(null)

    const form = new FormData()
    form.append('wiu', wiu)
    form.append('explosion', explosion)
    form.append('stock', stock)
    if (openFile) form.append('open_orders', openFile)

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
          <p>Monte a base do DPP diretamente das fontes mensais e mantenha a investigação separada do cálculo de estoque.</p>
        </div>
        <span className="status">WIU + Explosão + STK → DPP</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="source-workspace source-workspace-four">
        <SourceCard
          title="WIU"
          subtitle="Estrutura Material × Modelo e consumo da BOM"
          required
          file={wiu}
          accept=".xlsx,.xlsm"
          onChange={setWiu}
        />
        <SourceCard
          title="Explosão de Placas"
          subtitle="EXPLOSÃO consolidada por material"
          required
          file={explosion}
          accept=".xlsx,.xlsm"
          onChange={setExplosion}
        />
        <SourceCard
          title="STK SAP"
          subtitle="Snapshot do 1º dia do mês antes da movimentação"
          required
          file={stock}
          accept=".xlsx,.xlsm"
          onChange={setStock}
        />
        <SourceCard
          title="OPEN"
          subtitle="PI/PO pendentes para investigação; não soma ao estoque"
          file={openFile}
          accept=".xlsx,.xlsm"
          onChange={setOpenFile}
          pendingLabel="Opcional, mas recomendado para investigar faltas"
        />
      </section>

      <section className="panel consolidation-action-panel">
        <div>
          <strong>Consolidação mensal</strong>
          <p>WIU, Explosão e STK são obrigatórios. OPEN é uma evidência auxiliar e nunca altera STK, NEC ou SALDO.</p>
        </div>
        <button
          className="primary-button consolidation-button"
          type="button"
          onClick={consolidate}
          disabled={!wiu || !explosion || !stock || loading}
        >
          {loading ? 'Consolidando fontes...' : 'Gerar DPP consolidado'}
        </button>
      </section>

      {result && (
        <>
          <section className="metrics-grid consolidation-metrics">
            <Metric label="Materiais" value={result.summary.materials} />
            <Metric label="Modelos" value={result.summary.models} />
            <Metric label="STK encontrado" value={result.summary.stock_matches} tone="ok" />
            <Metric label="OPEN pendente" value={result.summary.open_loaded ? result.summary.open_pending_materials : 'Não carregado'} tone={result.summary.open_loaded ? 'attention' : ''} />
            <Metric label="Diferenças de UM" value={result.summary.unit_mismatches} tone={result.summary.unit_mismatches ? 'attention' : 'ok'} />
          </section>

          <section className="consolidation-tabs" aria-label="Seções da consolidação">
            <Tab active={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>Resumo</Tab>
            <Tab active={activeTab === 'materials'} onClick={() => setActiveTab('materials')}>Materiais</Tab>
            <Tab active={activeTab === 'models'} onClick={() => setActiveTab('models')}>Modelos</Tab>
            <Tab active={activeTab === 'investigation'} onClick={() => setActiveTab('investigation')}>Investigação OPEN</Tab>
            <Tab active={activeTab === 'sources'} onClick={() => setActiveTab('sources')}>Fontes e regras</Tab>
          </section>

          {activeTab === 'summary' && <SummaryTab result={result} />}
          {activeTab === 'materials' && (
            <MaterialsTab
              models={models}
              visibleMaterials={visibleMaterials}
              filteredMaterials={filteredMaterials}
              search={search}
              modelFilter={modelFilter}
              updateSearch={updateSearch}
              updateModel={updateModel}
              page={safePage}
              totalPages={totalPages}
              setPage={setPage}
              selectedMaterial={selectedMaterial}
              setSelectedMaterial={setSelectedMaterial}
            />
          )}
          {activeTab === 'models' && <ModelsTab models={models} />}
          {activeTab === 'investigation' && <InvestigationTab materials={openMaterials} openLoaded={result.summary.open_loaded} />}
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
        <span className={`source-state ${file ? 'ready' : required ? 'required' : 'optional'}`}>
          {file ? 'Carregado' : required ? 'Obrigatório' : 'Auxiliar'}
        </span>
        <small>{required ? 'Fonte mensal' : 'Investigação'}</small>
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
  const openLoaded = result.summary.open_loaded
  const unitConversionEnabled = result.capabilities.unit_conversion_enabled

  return (
    <div className="consolidation-grid-two">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Pipeline da consolidação</h3>
            <p>As três fontes físicas são obrigatórias; OPEN pertence à etapa de investigação.</p>
          </div>
          <span className="consolidation-status partial">{result.status}</span>
        </div>
        <div className="pipeline-list">
          <PipelineStep title="WIU → matriz Material × Modelo" state="done" text={`${result.summary.materials.toLocaleString('pt-BR')} materiais importados e ${result.summary.models} modelos estruturados.`} />
          <PipelineStep title="Explosão → material" state="done" text={`${result.summary.explosion_matches.toLocaleString('pt-BR')} materiais da base receberam a explosão consolidada.`} />
          <PipelineStep title="STK SAP → estoque inicial" state="done" text={`${result.summary.stock_matches.toLocaleString('pt-BR')} materiais foram encontrados no snapshot SAP.`} />
          <PipelineStep title="Normalização de códigos" state="done" text="Códigos numéricos e texto são convertidos para uma chave textual antes dos cruzamentos." />
          <PipelineStep title="OPEN → evidência de investigação" state={openLoaded ? 'done' : 'waiting'} text={openLoaded ? `${result.summary.open_pending_materials.toLocaleString('pt-BR')} materiais da base possuem registros pendentes no OPEN.` : 'Arquivo opcional não carregado. A consolidação física continua válida.'} />
          <PipelineStep title="Conversão de UM" state={unitConversionEnabled ? 'done' : 'waiting'} text={`${result.summary.unit_mismatches.toLocaleString('pt-BR')} materiais têm UM diferente entre WIU e STK. A conversão está deliberadamente desativada.`} />
          <PipelineStep title="NEC e SALDO" state="blocked" text="Dependem da regra/fonte de KIT PGD / REAL, ainda não fechada." />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Estado funcional</h3>
            <p>O sistema diferencia cálculo, qualidade do dado e evidência de investigação.</p>
          </div>
        </div>
        <div className="capability-list">
          <Capability label="Material × Modelo" enabled={result.capabilities.material_model_matrix} />
          <Capability label="EXPLOSÃO" enabled={result.capabilities.explosion} />
          <Capability label="STK SAP" enabled={result.capabilities.stock_sap} />
          <Capability label="Normalização de código" enabled={result.capabilities.material_code_normalization} />
          <Capability label="OPEN para investigação" enabled={result.capabilities.open_investigation} />
          <Capability label="Camada de conversão UM" enabled={result.capabilities.unit_conversion_layer} detail="Criada, não aplicada" />
          <Capability label="Conversão UM ativa" enabled={result.capabilities.unit_conversion_enabled} />
          <Capability label="NEC / SALDO" enabled={result.capabilities.balance} />
        </div>

        {!unitConversionEnabled && result.summary.unit_mismatches > 0 && (
          <div className="unit-warning">
            <strong>Conversão de unidade não aplicada</strong>
            <p>O ORION detectou {result.summary.unit_mismatches.toLocaleString('pt-BR')} diferenças de UM. {result.summary.convertible_unit_mismatches.toLocaleString('pt-BR')} delas têm fator conhecido na camada KG→G, M→CM ou L→ML, mas os valores continuam brutos até validação com a analista.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function MaterialsTab({ models, visibleMaterials, filteredMaterials, search, modelFilter, updateSearch, updateModel, page, totalPages, setPage, selectedMaterial, setSelectedMaterial }) {
  return (
    <section className="panel consolidated-materials-panel">
      <div className="panel-header">
        <div>
          <h3>Materiais consolidados</h3>
          <p>{filteredMaterials.length.toLocaleString('pt-BR')} material(is) no filtro atual.</p>
        </div>
        <span className="status">Página {page} de {totalPages}</span>
      </div>

      <div className="consolidation-filters">
        <label>
          <span>Buscar material</span>
          <input value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Código ou descrição" />
        </label>
        <label>
          <span>Modelo</span>
          <select value={modelFilter} onChange={(event) => updateModel(event.target.value)}>
            <option value="">Todos os modelos</option>
            {models.map((model) => (
              <option key={`${model.name}-${model.code || ''}`} value={model.name}>
                {model.name} {model.code ? `· ${model.code}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`material-workspace ${selectedMaterial ? 'with-detail' : ''}`}>
        <div className="table-scroll">
          <table className="dpp-table consolidated-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Descrição</th>
                <th>UM WIU</th>
                <th>Explosão</th>
                <th>STK SAP</th>
                <th>UM SAP</th>
                <th>Base atual</th>
                <th>OPEN pend.</th>
                <th>UM</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleMaterials.map((item) => (
                <tr key={item.material} className={selectedMaterial?.material === item.material ? 'selected-row' : ''}>
                  <td className="material-code">{item.material}</td>
                  <td>{item.description || '—'}</td>
                  <td>{item.um || '—'}</td>
                  <td className="number-cell">{formatNumber(item.explosion)}</td>
                  <td className="number-cell">{formatNumber(item.stock_sap)}</td>
                  <td>{item.stock_um || '—'}</td>
                  <td className="number-cell">{formatNumber(item.available_base)}</td>
                  <td className="number-cell">{item.open_investigation?.pending_records || 0}</td>
                  <td><UnitBadge conversion={item.unit_conversion} /></td>
                  <td>
                    <button type="button" className="secondary-button compact-button" onClick={() => setSelectedMaterial(item)}>Abrir</button>
                  </td>
                </tr>
              ))}
              {visibleMaterials.length === 0 && (
                <tr><td colSpan="10" className="empty-table">Nenhum material encontrado.</td></tr>
              )}
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

function UnitBadge({ conversion }) {
  if (!conversion || conversion.status === 'UNAVAILABLE') return <span className="unit-badge neutral">Sem UM</span>
  if (!conversion.mismatch) return <span className="unit-badge ok">OK</span>
  if (conversion.supported) return <span className="unit-badge warning">Não convertida</span>
  return <span className="unit-badge error">Incompatível</span>
}

function MaterialDetail({ item, onClose }) {
  const conversion = item.unit_conversion || {}
  const openInfo = item.open_investigation || {}

  return (
    <aside className="material-detail-panel">
      <div className="material-detail-header">
        <div>
          <span className="eyebrow">MATERIAL CONSOLIDADO</span>
          <h3>{item.material}</h3>
        </div>
        <button type="button" className="detail-close" onClick={onClose}>Fechar</button>
      </div>

      <p className="detail-description">{item.description || 'Sem descrição'}</p>

      <div className="detail-kpis">
        <DetailValue label="Explosão" value={formatNumber(item.explosion)} />
        <DetailValue label="STK SAP" value={formatNumber(item.stock_sap)} />
        <DetailValue label="Base atual" value={formatNumber(item.available_base)} />
      </div>

      <div className="detail-section">
        <small>Identificação</small>
        <p>UM WIU: <strong>{item.um || '—'}</strong></p>
        <p>UM SAP: <strong>{item.stock_um || '—'}</strong></p>
        <p>Origem: <strong>{item.group_origin || '—'}</strong></p>
        <p>Modelos: <strong>{item.used_models?.length || 0}</strong></p>
      </div>

      <div className={`detail-section unit-detail ${conversion.mismatch ? 'has-warning' : ''}`}>
        <small>Tratamento de unidade</small>
        <p>Status: <strong>{conversion.mismatch ? (conversion.supported ? 'Conversão conhecida, desativada' : 'Conversão não mapeada') : 'Mesma unidade'}</strong></p>
        {conversion.mismatch && (
          <>
            <p>Origem: <strong>{conversion.source_unit || '—'}</strong> → destino: <strong>{conversion.target_unit || '—'}</strong></p>
            <p>Fator potencial: <strong>{conversion.factor ?? 'Não definido'}</strong></p>
            <p>Aplicada: <strong>Não</strong></p>
          </>
        )}
      </div>

      <div className="detail-section">
        <small>Rastreabilidade</small>
        <p>WIU: <strong>{item.source?.sheet || '—'} · linha inicial {item.source?.first_row || '—'}</strong></p>
        <p>Ocorrências no WIU: <strong>{item.source?.occurrences || 0}</strong></p>
        <p>Explosão: <strong>{item.explosion_source ? `${item.explosion_source.sheet}!${item.explosion_source.cell}` : 'Sem registro; valor 0'}</strong></p>
        <p>STK: <strong>{item.stock_source ? `${item.stock_source.sheet}!${item.stock_source.cell}` : 'Sem registro; valor 0'}</strong></p>
      </div>

      <div className="detail-section">
        <small>OPEN / fornecimento pendente</small>
        <p>Registros pendentes: <strong>{openInfo.pending_records || 0}</strong></p>
        <p>Quantidade informada no OPEN: <strong>{formatNumber(openInfo.pending_quantity)}</strong></p>
        {(openInfo.entries || []).length > 0 && (
          <div className="open-entry-list">
            {openInfo.entries.map((entry, index) => (
              <article key={`${entry.pi || ''}-${entry.po || ''}-${entry.lot || ''}-${index}`}>
                <strong>{entry.pi || 'PI não informada'}</strong>
                <span>PO: {entry.po || '—'} · Lote: {entry.lot || '—'}</span>
                <span>Modelo: {entry.model || '—'}</span>
                <span>Qtd.: {formatNumber(entry.quantity)} {entry.um || ''}</span>
              </article>
            ))}
            {openInfo.truncated && <small>Lista resumida; existem mais registros para este material.</small>}
          </div>
        )}
        {!openInfo.pending_records && <p>Nenhuma evidência pendente carregada para este material.</p>}
      </div>

      <div className="detail-section">
        <small>Modelos que utilizam o material</small>
        <div className="model-chip-list">
          {(item.used_models || []).map((model) => <span key={model}>{model}</span>)}
          {!item.used_models?.length && <p>Nenhum modelo com consumo maior que zero.</p>}
        </div>
      </div>
    </aside>
  )
}

function InvestigationTab({ materials, openLoaded }) {
  if (!openLoaded) {
    return (
      <section className="panel">
        <h3>Investigação OPEN</h3>
        <p>Carregue o arquivo OPEN junto da consolidação para relacionar PIs/POs pendentes aos materiais. Esses dados são evidência de investigação e não entram no estoque.</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Materiais com fornecimento pendente</h3>
          <p>Visão auxiliar. Nenhum valor desta seção é somado ao STK ou à Explosão.</p>
        </div>
        <span className="status">{materials.length.toLocaleString('pt-BR')} materiais</span>
      </div>

      <div className="table-scroll">
        <table className="dpp-table open-investigation-table">
          <thead>
            <tr><th>Material</th><th>Descrição</th><th>Registros</th><th>Qtd. OPEN</th><th>Principais PIs</th></tr>
          </thead>
          <tbody>
            {materials.map((item) => (
              <tr key={item.material}>
                <td className="material-code">{item.material}</td>
                <td>{item.description || '—'}</td>
                <td className="number-cell">{item.open_investigation.pending_records}</td>
                <td className="number-cell">{formatNumber(item.open_investigation.pending_quantity)}</td>
                <td>
                  <div className="pi-chip-list">
                    {(item.open_investigation.entries || []).slice(0, 5).map((entry, index) => (
                      <span key={`${entry.pi || entry.po || 'registro'}-${index}`}>{entry.pi || entry.po || 'Sem PI/PO'}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {materials.length === 0 && (
              <tr><td colSpan="5" className="empty-table">Nenhum material da base possui registro pendente no OPEN carregado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ModelsTab({ models }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h3>Modelos encontrados no WIU</h3>
          <p>A estrutura é gerada diretamente da fonte mensal e já está pronta para receber plano/REAL posteriormente.</p>
        </div>
        <span className="status">{models.length} modelos</span>
      </div>
      <div className="model-card-grid">
        {models.map((model) => (
          <article className="model-card" key={`${model.name}-${model.code || ''}`}>
            <small>{model.code || 'Código não informado'}</small>
            <strong>{model.name}</strong>
            <span>{model.material_count.toLocaleString('pt-BR')} materiais</span>
          </article>
        ))}
      </div>
    </section>
  )
}

function SourcesTab({ result }) {
  return (
    <div className="consolidation-grid-two">
      <section className="panel">
        <h3>Arquivos utilizados</h3>
        <div className="source-result-list">
          {result.sources.map((source) => (
            <article key={source.id}>
              <span className={`source-state ${source.loaded ? 'ready' : source.required ? 'required' : 'optional'}`}>
                {source.loaded ? 'Carregado' : source.required ? 'Obrigatório' : 'Opcional'}
              </span>
              <div>
                <strong>{source.label}</strong>
                <p>{source.filename || 'Não carregado'}</p>
                <small>{source.detail}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Regras e pendências</h3>
        <div className="rule-box">
          <strong>Normalização de código: ativa</strong>
          <p>Todos os códigos são transformados em texto antes dos cruzamentos entre WIU, Explosão, STK e OPEN.</p>
        </div>
        <div className="rule-box warning-box">
          <strong>Conversão de UM: desativada</strong>
          <p>Camada preparada para KG→G, M→CM e L→ML, mas nenhum fator é aplicado até confirmação da analista.</p>
        </div>
        <div className="pending-list">
          {result.pending.map((item) => <div key={item}>{item}</div>)}
        </div>
        <p className="scope-note">{result.scope}</p>
      </section>
    </div>
  )
}

function Metric({ label, value, tone = '' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</strong>
    </article>
  )
}

function Tab({ active, children, onClick }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick}>{children}</button>
}

function PipelineStep({ title, text, state }) {
  return (
    <div className={`pipeline-step pipeline-${state}`}>
      <span className="pipeline-marker" />
      <div><strong>{title}</strong><p>{text}</p></div>
    </div>
  )
}

function Capability({ label, enabled, detail }) {
  return (
    <div className={enabled ? 'capability-ready' : 'capability-pending'}>
      <strong>{label}</strong>
      <span>{enabled ? 'Disponível' : 'Pendente'}</span>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function DetailValue({ label, value }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

export default DppConsolidation
