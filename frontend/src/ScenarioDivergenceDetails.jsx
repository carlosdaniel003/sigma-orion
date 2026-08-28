import './scenario-divergence-details.css'

const TOLERANCE = 1e-4
const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function same(left, right) {
  return Math.abs(number(left) - number(right)) <= TOLERANCE
}

function key(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR')
}

function value(value) {
  return value === null || value === undefined ? '—' : fmt.format(number(value))
}

function statusText(flag, positive = 'Crítico', negative = 'Não crítico') {
  return flag ? positive : negative
}

function criticalExplanation(material, origin) {
  if (!material) return `${origin}: item não encontrado nesta base.`
  const unit = String(material.um || '—').toUpperCase()
  const balance = material.balance
  const stockTotal = material.stock_total
  const nec = material.nec
  const critical = Boolean(material.critical ?? material.status === 'INVESTIGAR')
  if (unit !== 'UN') return `${origin}: UM = ${unit}. A regra de material crítico do ORION só classifica materiais com UM = UN.`
  if (balance === null || balance === undefined) return `${origin}: SALDO não está disponível para aplicar a regra de criticidade.`
  const equation = `SALDO = STK TTL (${value(stockTotal)}) − NEC (${value(nec)}) = ${value(balance)}.`
  return critical
    ? `${origin}: ${equation} Como UM = UN e SALDO < −0,0001, o item é crítico.`
    : `${origin}: ${equation} Como o SALDO não está abaixo de −0,0001, o item não é crítico.`
}

function materialMap(items, final = false) {
  return new Map((items || []).map((item) => [key(item.material || item.material_key), {
    ...item,
    critical: final ? Boolean(item.critical) : item.status === 'INVESTIGAR',
    shared_critical: final ? Boolean(item.shared_critical) : undefined,
  }]))
}

function modelMap(items) {
  return new Map((items || []).map((item) => [key(item.name), item]))
}

function criticalMaterialsByModel(materials, modelName, final = false) {
  return (materials || []).filter((material) => {
    const critical = final ? material.critical : material.status === 'INVESTIGAR'
    if (!critical) return false
    if (final) return (material.affected_models || []).some((name) => key(name) === key(modelName))
    return Object.entries(material.consumption_by_model || {}).some(([name, usage]) => key(name) === key(modelName) && number(usage) > 0)
  }).map((material) => material.material || material.material_key).filter(Boolean)
}

function buildModelRows(kind, data, finalDppAnalysis) {
  const orion = modelMap(data.models)
  const final = modelMap(finalDppAnalysis?.models)
  const names = [...new Set([...orion.keys(), ...final.keys()])]
  return names.flatMap((name) => {
    const left = orion.get(name)
    const right = final.get(name)
    if (kind === 'pgd' && left && right && same(left.kit_pgd, right.pgd)) return []
    if (kind === 'real' && left && right && same(left.real, right.real)) return []
    if (kind === 'gap' && left && right && same(number(left.kit_pgd) - number(left.real), number(right.pgd) - number(right.real))) return []

    const leftRisk = Boolean(left && data.riskModels.some((model) => key(model.name) === name))
    const rightRisk = Boolean(right?.at_risk)
    if (['coverage', 'risk', 'exposed'].includes(kind) && left && right && leftRisk === rightRisk && Boolean(number(left.real) > 0) === Boolean(right.active)) return []

    const orionCritical = criticalMaterialsByModel(data.materials, left?.name || name)
    const finalCritical = criticalMaterialsByModel(finalDppAnalysis?.material_details, right?.name || name, true)

    if (kind === 'pgd') return [{ item: left?.name || right?.name || name, orion: `KIT PGD ${value(left?.kit_pgd)}`, final: `KIT PGD ${value(right?.pgd)}`, reason: !left || !right ? 'O modelo existe apenas em uma das bases.' : `O KIT disponível PGD difere em ${value(number(right.pgd) - number(left.kit_pgd))}.` }]
    if (kind === 'real') return [{ item: left?.name || right?.name || name, orion: `REAL ${value(left?.real)}`, final: `REAL ${value(right?.real)}`, reason: !left || !right ? 'O modelo existe apenas em uma das bases.' : `O REAL consolidado difere do REAL calculado pelo ORION em ${value(number(right.real) - number(left.real))}.` }]
    if (kind === 'gap') return [{ item: left?.name || right?.name || name, orion: `Gap ${value(number(left?.kit_pgd) - number(left?.real))}`, final: `Gap ${value(number(right?.pgd) - number(right?.real))}`, reason: 'Gap = KIT disponível PGD − REAL. A divergência nasce de KIT e/ou REAL diferentes neste modelo.' }]

    return [{
      item: left?.name || right?.name || name,
      orion: `${leftRisk ? 'Em risco' : 'Coberto'}${orionCritical.length ? ` · ${orionCritical.slice(0, 4).join(', ')}` : ''}`,
      final: `${rightRisk ? 'Em risco' : 'Coberto'}${finalCritical.length ? ` · ${finalCritical.slice(0, 4).join(', ')}` : ''}`,
      reason: leftRisk !== rightRisk
        ? `O modelo muda de situação porque o conjunto de materiais críticos ligados ao REAL ativo é diferente. ORION: ${orionCritical.length}; DPP Final: ${finalCritical.length}.`
        : 'A atividade do modelo ou sua contribuição ao indicador agregado é diferente entre os cenários.',
    }]
  })
}

function buildMaterialRows(kind, data, finalDppAnalysis) {
  const orion = materialMap(data.materials)
  const final = materialMap(finalDppAnalysis?.material_details, true)
  const activeOrionModels = new Set((data.activeModels || []).map((model) => key(model.name)))
  const keys = [...new Set([...orion.keys(), ...final.keys()])]

  return keys.flatMap((materialKey) => {
    const left = orion.get(materialKey)
    const right = final.get(materialKey)
    const leftCritical = Boolean(left?.critical)
    const rightCritical = Boolean(right?.critical)
    const leftAffectedActive = Object.entries(left?.consumption_by_model || {})
      .filter(([modelName, usage]) => activeOrionModels.has(key(modelName)) && number(usage) > 0)
      .map(([modelName]) => modelName)
    const leftShared = leftCritical && leftAffectedActive.length > 1
    const rightShared = Boolean(right?.shared_critical)
    const differs = kind === 'shared' ? leftShared !== rightShared : leftCritical !== rightCritical
    if (!differs) return []

    return [{
      item: left?.material || right?.material || materialKey,
      description: left?.description || right?.description || '',
      orion: `${statusText(kind === 'shared' ? leftShared : leftCritical, kind === 'shared' ? 'Crítico compartilhado' : 'Crítico', 'Não classificado')}
UM ${left?.um || '—'} · NEC ${value(left?.nec)} · STK TTL ${value(left?.stock_total)} · SALDO ${value(left?.balance)}`,
      final: `${statusText(kind === 'shared' ? rightShared : rightCritical, kind === 'shared' ? 'Crítico compartilhado' : 'Crítico', 'Não classificado')}
UM ${right?.um || '—'} · NEC ${value(right?.nec)} · STK TTL ${value(right?.stock_total)} · SALDO ${value(right?.balance)}`,
      reason: kind === 'shared'
        ? `Crítico compartilhado exige material crítico afetando mais de um modelo ativo. ORION: ${leftShared ? `sim (${leftAffectedActive.join(', ')})` : 'não'}; DPP Final: ${rightShared ? `sim (${(right?.affected_models || []).join(', ')})` : 'não'}. ${criticalExplanation(left, 'ORION')} ${criticalExplanation(right, 'DPP Final')}`
        : `${criticalExplanation(left, 'ORION')} ${criticalExplanation(right, 'DPP Final')}`,
    }]
  })
}

function ScenarioDivergenceDetails({ kind, data, finalDppAnalysis }) {
  const rule = finalDppAnalysis?.critical_rule
  const rows = ['critical', 'shared'].includes(kind)
    ? buildMaterialRows(kind, data, finalDppAnalysis)
    : buildModelRows(kind, data, finalDppAnalysis)

  return (
    <div className="scenario-divergence-detail" role="region" aria-label="Detalhes da divergência">
      <div className="scenario-divergence-rule">
        <strong>Como o ORION decide</strong>
        {['critical', 'coverage', 'risk', 'exposed', 'shared'].includes(kind) ? (
          <p>{rule?.definition || 'Material crítico: UM = UN e SALDO negativo.'} {rule?.formula}</p>
        ) : kind === 'gap' ? (
          <p>Gap = KIT disponível PGD − REAL. A análise compara essa mesma relação modelo a modelo nos dois cenários.</p>
        ) : (
          <p>O indicador é comparado modelo a modelo usando os valores calculados no Cenário ORION e os valores lidos diretamente do DPP Final.</p>
        )}
      </div>

      {rows.length ? (
        <div className="scenario-divergence-table-wrap">
          <table className="scenario-divergence-table">
            <thead><tr><th>Item</th><th>Cenário ORION</th><th>DPP Final</th><th>Por que é divergente</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.item}-${index}`}>
                  <th scope="row"><strong>{row.item}</strong>{row.description && <small>{row.description}</small>}</th>
                  <td>{row.orion}</td><td>{row.final}</td><td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="scenario-divergence-empty">Nenhum item individual diferente foi encontrado para este indicador; a diferença está apenas no agregado.</p>}
    </div>
  )
}

export default ScenarioDivergenceDetails
