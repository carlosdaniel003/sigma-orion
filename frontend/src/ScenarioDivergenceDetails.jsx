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

function value(current) {
  return current === null || current === undefined ? '—' : fmt.format(number(current))
}

function textValue(current) {
  const text = String(current || '').trim()
  return text || 'Não informado'
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
  const stock = material.stock ?? material.stock_sap_effective ?? material.stock_sap
  const explosion = material.explosion
  const stockOp = material.stock_op
  const critical = Boolean(material.critical ?? material.status === 'INVESTIGAR')
  if (unit !== 'UN') return `${origin}: UM = ${unit}. A regra de material crítico do ORION só classifica materiais com UM = UN.`
  if (balance === null || balance === undefined) return `${origin}: SALDO não está disponível para aplicar a regra de criticidade.`

  const hasStockBreakdown = [stock, explosion, stockOp].every((current) => current !== null && current !== undefined)
  const stockEquation = hasStockBreakdown
    ? `STK TTL = STK (${value(stock)}) + EXPLOSÃO (${value(explosion)}) + STK OP (${value(stockOp)}) = ${value(stockTotal)}. `
    : ''
  const balanceEquation = `SALDO = STK TTL (${value(stockTotal)}) − NEC (${value(nec)}) = ${value(balance)}.`
  return critical
    ? `${origin}: ${stockEquation}${balanceEquation} Como UM = UN e SALDO < −0,0001, o item é crítico.`
    : `${origin}: ${stockEquation}${balanceEquation} Como o SALDO não está abaixo de −0,0001, o item não é crítico.`
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

    const leftActive = Boolean(left && number(left.real) > 0)
    const rightActive = Boolean(right?.active)
    const leftRisk = Boolean(left && data.riskModels?.some((model) => key(model.name) === name))
    const rightRisk = Boolean(right?.at_risk)

    if (kind === 'active' && left && right && leftActive === rightActive) return []
    if (['coverage', 'risk'].includes(kind) && left && right && leftRisk === rightRisk && leftActive === rightActive) return []
    if (kind === 'exposed' && left && right) {
      const sameRiskState = leftRisk === rightRisk && leftActive === rightActive
      const sameExposedPgd = !leftRisk && !rightRisk ? true : same(left.kit_pgd, right.pgd)
      if (sameRiskState && sameExposedPgd) return []
    }

    const orionCritical = leftActive ? criticalMaterialsByModel(data.materials, left?.name || name) : []
    const finalCritical = rightActive ? criticalMaterialsByModel(finalDppAnalysis?.material_details, right?.name || name, true) : []

    if (kind === 'pgd') return [{ item: left?.name || right?.name || name, orion: `KIT PGD ${value(left?.kit_pgd)}`, final: `KIT PGD ${value(right?.pgd)}`, reason: !left || !right ? 'O modelo existe apenas em uma das bases.' : `O KIT disponível PGD difere em ${value(number(right.pgd) - number(left.kit_pgd))}.` }]
    if (kind === 'real') return [{ item: left?.name || right?.name || name, orion: `REAL ${value(left?.real)}`, final: `REAL ${value(right?.real)}`, reason: !left || !right ? 'O modelo existe apenas em uma das bases.' : `O REAL consolidado difere do REAL calculado pelo ORION em ${value(number(right.real) - number(left.real))}.` }]
    if (kind === 'active') return [{
      item: left?.name || right?.name || name,
      orion: `${leftActive ? 'Ativo' : 'Inativo'} · REAL ${value(left?.real)}`,
      final: `${rightActive ? 'Ativo' : 'Inativo'} · REAL ${value(right?.real)}`,
      reason: !left || !right
        ? 'O modelo existe apenas em uma das bases, portanto a composição dos modelos ativos não é a mesma.'
        : `O ORION considera modelo ativo quando REAL > 0. Neste modelo, o REAL passou de ${value(left.real)} no ORION para ${value(right.real)} no DPP Final, alterando sua condição de ${leftActive ? 'ativo' : 'inativo'} para ${rightActive ? 'ativo' : 'inativo'}.`,
    }]
    if (kind === 'gap') return [{ item: left?.name || right?.name || name, orion: `Gap ${value(number(left?.kit_pgd) - number(left?.real))}`, final: `Gap ${value(number(right?.pgd) - number(right?.real))}`, reason: 'Gap = KIT disponível PGD − REAL. A divergência nasce de KIT e/ou REAL diferentes neste modelo.' }]
    if (kind === 'exposed') return [{
      item: left?.name || right?.name || name,
      orion: `${leftRisk ? 'PGD exposto' : 'Fora da exposição'} · KIT PGD ${value(left?.kit_pgd)}`,
      final: `${rightRisk ? 'PGD exposto' : 'Fora da exposição'} · KIT PGD ${value(right?.pgd)}`,
      reason: leftRisk !== rightRisk
        ? `O modelo entra/sai do PGD exposto porque sua situação de risco mudou. Materiais críticos ORION: ${orionCritical.length}; DPP Final: ${finalCritical.length}.`
        : `O modelo permanece com a mesma situação de risco, mas o KIT PGD que compõe a exposição mudou de ${value(left?.kit_pgd)} para ${value(right?.pgd)}.`,
    }]

    return [{
      item: left?.name || right?.name || name,
      orion: `${leftRisk ? 'Em risco' : 'Coberto'}${orionCritical.length ? ` · ${orionCritical.slice(0, 4).join(', ')}` : ''}`,
      final: `${rightRisk ? 'Em risco' : 'Coberto'}${finalCritical.length ? ` · ${finalCritical.slice(0, 4).join(', ')}` : ''}`,
      reason: leftRisk !== rightRisk
        ? `O modelo muda de situação porque o conjunto de materiais críticos ligados ao REAL ativo é diferente. ORION: ${orionCritical.length}; DPP Final: ${finalCritical.length}.`
        : 'A atividade do modelo é diferente entre os cenários e altera o denominador/resultado do indicador.',
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

    if (kind === 'opc') {
      const leftOpc = key(left?.optional_material)
      const rightOpc = key(right?.optional_material)
      const missing = !left || !right
      if (!missing && leftOpc === rightOpc) return []
      return [{
        item: left?.material || right?.material || materialKey,
        description: left?.description || right?.description || '',
        orion: `OPC: ${textValue(left?.optional_material)}`,
        final: `OPC: ${textValue(right?.optional_material)}`,
        reason: missing
          ? `${!left ? 'O material não existe no Cenário ORION.' : 'O material existe no Cenário ORION.'} ${!right ? 'O material não existe no DPP Final.' : 'O material existe no DPP Final.'}`
          : `O material alternativo associado na coluna OPC é diferente. ORION: ${textValue(left?.optional_material)}; DPP Final: ${textValue(right?.optional_material)}.`,
      }]
    }

    const leftCritical = Boolean(left?.critical)
    const rightCritical = Boolean(right?.critical)
    const leftAffectedActive = Object.entries(left?.consumption_by_model || {})
      .filter(([modelName, usage]) => activeOrionModels.has(key(modelName)) && number(usage) > 0)
      .map(([modelName]) => modelName)
    const leftShared = leftCritical && leftAffectedActive.length > 1
    const rightShared = Boolean(right?.shared_critical)
    const missing = !left || !right
    const differs = kind === 'shared' ? leftShared !== rightShared : missing || leftCritical !== rightCritical
    if (!differs) return []

    return [{
      item: left?.material || right?.material || materialKey,
      description: left?.description || right?.description || '',
      orion: `${statusText(kind === 'shared' ? leftShared : leftCritical, kind === 'shared' ? 'Crítico compartilhado' : 'Crítico', left ? 'Não crítico' : 'Ausente')}
UM ${left?.um || '—'} · NEC ${value(left?.nec)} · STK TTL ${value(left?.stock_total)} · SALDO ${value(left?.balance)}`,
      final: `${statusText(kind === 'shared' ? rightShared : rightCritical, kind === 'shared' ? 'Crítico compartilhado' : 'Crítico', right ? 'Não crítico' : 'Ausente')}
UM ${right?.um || '—'} · NEC ${value(right?.nec)} · STK TTL ${value(right?.stock_total)} · SALDO ${value(right?.balance)}`,
      reason: missing
        ? `${!left ? 'O material não existe no Cenário ORION.' : 'O material existe no Cenário ORION.'} ${!right ? 'O material não existe no DPP Final.' : 'O material existe no DPP Final.'} ${criticalExplanation(left, 'ORION')} ${criticalExplanation(right, 'DPP Final')}`
        : kind === 'shared'
          ? `Crítico compartilhado exige material crítico afetando mais de um modelo ativo. ORION: ${leftShared ? `sim (${leftAffectedActive.join(', ')})` : 'não'}; DPP Final: ${rightShared ? `sim (${(right?.affected_models || []).join(', ')})` : 'não'}. ${criticalExplanation(left, 'ORION')} ${criticalExplanation(right, 'DPP Final')}`
          : `${criticalExplanation(left, 'ORION')} ${criticalExplanation(right, 'DPP Final')}`,
    }]
  })
}

function ScenarioDivergenceDetails({ kind, data, finalDppAnalysis }) {
  const rule = finalDppAnalysis?.critical_rule
  const rows = ['critical', 'shared', 'opc'].includes(kind)
    ? buildMaterialRows(kind, data, finalDppAnalysis)
    : buildModelRows(kind, data, finalDppAnalysis)

  return (
    <div className="scenario-divergence-detail" role="region" aria-label="Detalhes da divergência">
      <div className="scenario-divergence-rule">
        <strong>Como o ORION decide</strong>
        {['critical', 'coverage', 'risk', 'exposed', 'shared'].includes(kind) ? (
          <p>{rule?.definition || 'Material crítico: UM = UN e SALDO negativo.'} {rule?.formula}</p>
        ) : kind === 'opc' ? (
          <p>OPC representa o material alternativo associado ao material principal. Há divergência quando o código/presença do OPC no Cenário ORION não corresponde ao DPP Final, mesmo que a quantidade total de OPCs seja igual.</p>
        ) : kind === 'active' ? (
          <p>O ORION considera um modelo ativo quando o REAL do modelo é maior que zero. A divergência mostra quais modelos mudaram de ativo para inativo, ou o inverso, entre o Cenário ORION e o DPP Final.</p>
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
