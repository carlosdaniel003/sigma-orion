import { useMemo, useState } from 'react'
import './dpp.css'

const PAGE_SIZE = 100

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function formatNumber(value, maximumFractionDigits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('pt-BR', {
    maximumFractionDigits,
  })
}

function sourceLabel(item) {
  if (item?.source?.reference) return item.source.reference
  if (item?.source?.sheet && item?.source?.row) return `${item.source.sheet} · linha ${item.source.row}`
  return '—'
}

function matchesFilters(item, filters) {
  const search = normalizeText(filters.search)
  if (search) {
    const searchable = `${item.material || ''} ${item.description || ''} ${item.source?.reference || ''} ${item.source?.row || ''}`.toLowerCase()
    if (!searchable.includes(search)) return false
  }
  if (filters.model && !(item.used_models || []).includes(filters.model)) return false
  if (filters.origin && item.group_origin !== filters.origin) return false
  if (filters.um && item.um !== filters.um) return false
  if (filters.status && filters.status !== 'ALL' && item.status !== filters.status) return false
  return true
}

function DppAnalysis({ apiUrl }) {
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [filters, setFilters] = useState({
    search: '',
    model: '',
    origin: '',
    um: '',
    status: 'ALL',
  })

  const materials = result?.materials || []
  const divergences = result?.divergences || []

  const origins = useMemo(
    () => [...new Set(materials.map((item) => item.group_origin).filter(Boolean))].sort(),
    [materials],
  )
  const units = useMemo(
    () => [...new Set(materials.map((item) => item.um).filter(Boolean))].sort(),
    [materials],
  )

  const filteredMaterials = useMemo(
    () => materials.filter((item) => matchesFilters(item, filters)),
    [materials, filters],
  )

  const filteredDivergences = useMemo(
    () => divergences.filter((item) => matchesFilters({ ...item, status: 'INVESTIGAR' }, filters)),
    [divergences, filters],
  )

  const totalPages = Math.max(1, Math.ceil(filteredMaterials.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleMaterials = filteredMaterials.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const selectedDivergence = divergences.find((item) => item.material === selectedMaterial) || null

  function changeFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setPage(1)
  }

  function clearFilters() {
    setFilters({ search: '', model: '', origin: '', um: '', status: 'ALL' })
    setPage(1)
  }

  async function analyzeDpp() {
    if (!file) return
    setLoading(true)
    setError('')
    setResult(null)
    setSelectedMaterial('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${apiUrl}/api/dpp/analyze?divergence_limit=500`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Não foi possível analisar o DPP.')
      setResult(data)
      setSelectedMaterial(data.divergences?.[0]?.material || '')
      setPage(1)
    } catch (requestError) {
      setError(requestError.message || 'Falha ao analisar o DPP.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <span className="eyebrow">MOTOR DETERMINÍSTICO</span>
          <h2>Análise DPP</h2>
          <p>Recalcule o DPP em Python, confira a equivalência com o Excel e investigue os saldos negativos.</p>
        </div>
        <span className="status">Python × Excel</span>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="panel dpp-upload-panel">
        <div className="dpp-upload-row">
          <label className="upload-box dpp-upload-box">
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <strong>Selecionar DPP</strong>
            <span>{file ? file.name : 'Selecione um arquivo .xlsx ou .xlsm'}</span>
          </label>
          <button className="primary-button" type="button" onClick={analyzeDpp} disabled={!file || loading}>
            {loading ? 'Analisando DPP...' : 'Analisar DPP'}
          </button>
        </div>
        <p className="dpp-scope-note">
          Nesta etapa, WIU, Explosão, PGD e BOM são considerados apenas pelos valores já consolidados dentro do DPP.
        </p>
      </section>

      {result && (
        <>
          <section className="metrics-grid dpp-metrics">
            <DppMetric label="Materiais" value={result.summary.total_materials} />
            <DppMetric label="Investigar" value={result.summary.materials_to_investigate} tone="critical" />
            <DppMetric label="Com OPC" value={result.summary.optional_material_links} tone="attention" />
            <DppMetric label="Modelos" value={result.structure.model_count} tone="ok" />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Validação Python × Excel</h3>
                <p>Os cálculos são comparados linha a linha com os valores consolidados no DPP enviado.</p>
              </div>
              <span className="status">{result.filename}</span>
            </div>
            <div className="validation-grid">
              <ValidationCard label="NEC" data={result.summary.validation.nec} />
              <ValidationCard label="STK TTL" data={result.summary.validation.stk_total} />
              <ValidationCard label="SALDO" data={result.summary.validation.saldo} />
              <ValidationCard label="Amount" data={result.summary.validation.amount} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Filtros da análise</h3>
                <p>Os mesmos filtros controlam a tabela de materiais e a lista de divergências. A busca também aceita linha ou referência do Excel, como DPP!A10.</p>
              </div>
              <button className="secondary-button" type="button" onClick={clearFilters}>Limpar filtros</button>
            </div>
            <div className="dpp-filters">
              <label>
                <span>Material / descrição / linha</span>
                <input
                  value={filters.search}
                  onChange={(event) => changeFilter('search', event.target.value)}
                  placeholder="Código, descrição, linha ou DPP!A10"
                />
              </label>
              <label>
                <span>Modelo</span>
                <select value={filters.model} onChange={(event) => changeFilter('model', event.target.value)}>
                  <option value="">Todos</option>
                  {(result.models || []).map((model) => (
                    <option key={`${model.column}-${model.name}`} value={model.name}>
                      {model.name} {model.code ? `· ${model.code}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Origem</span>
                <select value={filters.origin} onChange={(event) => changeFilter('origin', event.target.value)}>
                  <option value="">Todas</option>
                  {origins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
                </select>
              </label>
              <label>
                <span>UM</span>
                <select value={filters.um} onChange={(event) => changeFilter('um', event.target.value)}>
                  <option value="">Todas</option>
                  {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}>
                  <option value="ALL">Todos</option>
                  <option value="INVESTIGAR">Investigar</option>
                  <option value="OK">Sem saldo negativo</option>
                </select>
              </label>
            </div>
          </section>

          <section className="panel dpp-table-panel">
            <div className="panel-header">
              <div>
                <h3>Materiais do DPP</h3>
                <p>{filteredMaterials.length.toLocaleString('pt-BR')} de {materials.length.toLocaleString('pt-BR')} materiais no filtro atual.</p>
              </div>
              <span className="status">Página {safePage} de {totalPages}</span>
            </div>
            <div className="table-scroll">
              <table className="dpp-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Fonte Excel</th>
                    <th>Descrição</th>
                    <th>UM</th>
                    <th>Origem</th>
                    <th>Modelos</th>
                    <th>NEC</th>
                    <th>STK TTL</th>
                    <th>SALDO</th>
                    <th>OPC</th>
                    <th>Status</th>
                    <th>Cálculo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMaterials.map((item) => (
                    <tr key={`${item.material}-${item.source?.row || ''}`} className={item.status === 'INVESTIGAR' ? 'row-investigate' : ''}>
                      <td className="material-code">{item.material}</td>
                      <td className="material-code" title={`Aba ${item.source?.sheet || '—'}, linha ${item.source?.row || '—'}`}>{sourceLabel(item)}</td>
                      <td>{item.description || '—'}</td>
                      <td>{item.um || '—'}</td>
                      <td>{item.group_origin || '—'}</td>
                      <td className="models-cell" title={(item.used_models || []).join(' · ')}>
                        {(item.used_models || []).length ? `${item.used_models.length} modelo(s)` : '—'}
                      </td>
                      <td className="number-cell">{formatNumber(item.nec)}</td>
                      <td className="number-cell">{formatNumber(item.stock_total)}</td>
                      <td className={`number-cell ${item.balance < 0 ? 'negative-number' : ''}`}>{formatNumber(item.balance)}</td>
                      <td>{item.optional_material || '—'}</td>
                      <td><StatusBadge status={item.status} /></td>
                      <td><ValidationBadge ok={item.validation_ok} /></td>
                    </tr>
                  ))}
                  {visibleMaterials.length === 0 && (
                    <tr><td colSpan="12" className="empty-table">Nenhum material encontrado com os filtros atuais.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="secondary-button" type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
                Anterior
              </button>
              <span>{((safePage - 1) * PAGE_SIZE + 1).toLocaleString('pt-BR')}–{Math.min(safePage * PAGE_SIZE, filteredMaterials.length).toLocaleString('pt-BR')} de {filteredMaterials.length.toLocaleString('pt-BR')}</span>
              <button className="secondary-button" type="button" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>
                Próxima
              </button>
            </div>
          </section>

          <section className="panel dpp-table-panel">
            <div className="panel-header">
              <div>
                <h3>Itens para investigar</h3>
                <p>Saldo negativo é uma divergência matemática a investigar; não representa automaticamente necessidade de compra.</p>
              </div>
              <span className="status">{filteredDivergences.length} item(ns)</span>
            </div>
            <div className="table-scroll divergence-table-scroll">
              <table className="dpp-table divergence-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Fonte Excel</th>
                    <th>Descrição</th>
                    <th>UM</th>
                    <th>Origem</th>
                    <th>SALDO</th>
                    <th>Comentário</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDivergences.map((item) => (
                    <tr key={`${item.material}-${item.source?.row || ''}`} className={selectedMaterial === item.material ? 'selected-row' : ''}>
                      <td className="material-code">{item.material}</td>
                      <td className="material-code">{sourceLabel(item)}</td>
                      <td>{item.description || '—'}</td>
                      <td>{item.um || '—'}</td>
                      <td>{item.group_origin || '—'}</td>
                      <td className="number-cell negative-number">{formatNumber(item.python.balance)}</td>
                      <td>{item.comments || '—'}</td>
                      <td>
                        <button className="secondary-button compact-button" type="button" onClick={() => setSelectedMaterial(item.material)}>
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredDivergences.length === 0 && (
                    <tr><td colSpan="8" className="empty-table">Nenhuma divergência encontrada com os filtros atuais.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {selectedDivergence && (
            <DivergenceDetail item={selectedDivergence} />
          )}
        </>
      )}
    </>
  )
}

function DppMetric({ label, value, tone = '' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{Number(value || 0).toLocaleString('pt-BR')}</strong>
    </article>
  )
}

function ValidationCard({ label, data }) {
  const checked = data?.checked || 0
  const matches = data?.matches || 0
  const mismatches = data?.mismatches || 0
  const percentage = checked ? (matches / checked) * 100 : 0
  return (
    <article className={`validation-card ${mismatches ? 'has-error' : ''}`}>
      <div className="validation-card-header">
        <strong>{label}</strong>
        <ValidationBadge ok={mismatches === 0} />
      </div>
      <div className="validation-percentage">{formatNumber(percentage, 2)}%</div>
      <small>{matches.toLocaleString('pt-BR')} / {checked.toLocaleString('pt-BR')} iguais · {mismatches} divergente(s)</small>
    </article>
  )
}

function StatusBadge({ status }) {
  const investigate = status === 'INVESTIGAR'
  return <span className={`dpp-badge ${investigate ? 'badge-investigate' : 'badge-ok'}`}>{investigate ? 'Investigar' : 'OK'}</span>
}

function ValidationBadge({ ok }) {
  return <span className={`dpp-badge ${ok ? 'badge-ok' : 'badge-error'}`}>{ok ? 'Validado' : 'Divergente'}</span>
}

function ComparisonValue({ label, excel, python, valid }) {
  return (
    <div className="comparison-card">
      <div className="comparison-title">
        <strong>{label}</strong>
        <ValidationBadge ok={valid !== false} />
      </div>
      <div className="comparison-values">
        <span><small>Excel</small><b>{formatNumber(excel)}</b></span>
        <span><small>Python</small><b>{formatNumber(python)}</b></span>
      </div>
    </div>
  )
}

function DivergenceDetail({ item }) {
  return (
    <section className="panel divergence-detail">
      <div className="panel-header">
        <div>
          <span className="eyebrow">DETALHE DA DIVERGÊNCIA</span>
          <h3>{item.material} — {item.description}</h3>
          <p>{item.um || 'UM não informada'} · {item.group_origin || 'Origem não informada'}</p>
          <p><strong>Fonte Excel:</strong> {sourceLabel(item)}</p>
        </div>
        <StatusBadge status="INVESTIGAR" />
      </div>

      <div className="comparison-grid">
        <ComparisonValue label="NEC" excel={item.excel.nec} python={item.python.nec} valid={item.validation.nec} />
        <ComparisonValue label="STK TTL" excel={item.excel.stock_total} python={item.python.stock_total} valid={item.validation.stock_total} />
        <ComparisonValue label="SALDO" excel={item.excel.balance} python={item.python.balance} valid={item.validation.balance} />
        <ComparisonValue label="Amount" excel={item.excel.amount} python={item.python.amount} valid={item.validation.amount} />
      </div>

      <div className="detail-grid">
        <div className="detail-block">
          <small>Rastreabilidade Excel</small>
          <p>Aba: <strong>{item.source?.sheet || '—'}</strong></p>
          <p>Linha original: <strong>{item.source?.row || '—'}</strong></p>
          <p>Célula do material: <strong>{item.source?.material_cell || '—'}</strong></p>
          <p>Referência: <strong>{item.source?.reference || '—'}</strong></p>
        </div>
        <div className="detail-block">
          <small>Composição do estoque</small>
          <p>STK: <strong>{formatNumber(item.excel.stock)}</strong></p>
          <p>Explosão: <strong>{formatNumber(item.excel.explosion)}</strong></p>
          <p>STK OP: <strong>{formatNumber(item.excel.optional_stock)}</strong></p>
          <p>OPC: <strong>{item.optional_material || '—'}</strong></p>
        </div>
        <div className="detail-block">
          <small>Modelos que utilizam o material</small>
          <p>{(item.used_models || []).join(' · ') || 'Nenhum modelo identificado.'}</p>
        </div>
        <div className="detail-block">
          <small>Check</small>
          <p>{item.check || '—'}</p>
        </div>
        <div className="detail-block">
          <small>WIU</small>
          <p>{item.wiu || '—'}</p>
        </div>
        <div className="detail-block detail-comment">
          <small>Comentário da análise</small>
          <p>{item.comments || 'Sem comentário registrado nesta linha.'}</p>
        </div>
      </div>
    </section>
  )
}

export default DppAnalysis
