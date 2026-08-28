import InfoHint from './InfoHint'
import './dpp-column-comparison.css'

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 3,
})

function isZero(value) {
  return Math.abs(Number(value) || 0) <= 1e-4
}

function formatAggregate(column, value) {
  if (value === null || value === undefined) return '—'
  if (column.kind === 'count') return `${NUMBER_FORMAT.format(value)} itens`
  return NUMBER_FORMAT.format(value)
}

function formatDelta(column) {
  if (!column.supported || column.delta === null || column.delta === undefined) return '—'
  const numeric = Number(column.delta) || 0
  if (isZero(numeric)) return column.kind === 'count' ? '0 itens' : '0'
  const sign = numeric > 0 ? '+' : '−'
  const value = NUMBER_FORMAT.format(Math.abs(numeric))
  return column.kind === 'count' ? `${sign}${value} itens` : `${sign}${value}`
}

function differenceLabel(count) {
  const numeric = Number(count) || 0
  return `${NUMBER_FORMAT.format(numeric)} ${numeric === 1 ? 'valor divergente' : 'valores divergentes'}`
}

function DppColumnComparison({ finalDppAnalysis }) {
  const comparison = finalDppAnalysis?.column_comparison
  if (!comparison?.columns?.length) return null

  return (
    <section className="dpp-column-comparison" aria-labelledby="dpp-column-comparison-title">
      <div className="dpp-column-comparison-heading">
        <div>
          <div className="dpp-column-comparison-title-row">
            <h3 id="dpp-column-comparison-title">Comparativo completo das colunas do DPP</h3>
            <InfoHint
              title="Comparativo completo das colunas do DPP"
              what="Mostra todas as colunas da aba DPP em três linhas: total do DPP Final, total do Cenário ORION e diferença entre os dois. A linha de diferença também informa quantos valores da coluna não coincidem, sem abrir os materiais individualmente."
              source="DPP Final: valores lidos diretamente do arquivo consolidado. Cenário ORION: materiais, matriz Material × Modelo e campos calculados pelo motor Python do cenário mensal."
              purpose="Localizar rapidamente em quais colunas a reconstrução do ORION ainda difere do DPP Final antes de investigar item a item."
              align="right"
            />
          </div>
          <p>
            Texto é resumido por quantidade de itens preenchidos; colunas numéricas são resumidas pela soma. A diferença é calculada como DPP Final − Cenário ORION.
          </p>
        </div>
        <div className="dpp-column-comparison-summary" aria-label="Resumo do comparativo por coluna">
          <span>{comparison.columns_total} colunas</span>
          <span>{comparison.comparable_columns} comparáveis</span>
          <span>{comparison.divergent_columns} com divergência</span>
          {comparison.unsupported_columns > 0 && (
            <span>{comparison.unsupported_columns} ainda não calculadas pelo ORION</span>
          )}
        </div>
      </div>

      <div
        className="dpp-column-comparison-scroll"
        role="region"
        aria-label="Tabela horizontal de comparação de todas as colunas do DPP"
        tabIndex="0"
      >
        <table className="dpp-column-comparison-table">
          <thead>
            <tr>
              <th className="dpp-column-scenario-column" scope="col">Cenário</th>
              {comparison.columns.map((column) => (
                <th scope="col" key={`${column.column}-${column.name}`}>
                  <span>{column.name}</span>
                  <small>{column.aggregation_label}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="dpp-column-scenario-column" scope="row">
                <strong>DPP Final</strong>
                <small>Arquivo consolidado</small>
              </th>
              {comparison.columns.map((column) => (
                <td className="number-cell" key={`final-${column.column}`}>
                  {formatAggregate(column, column.final_total)}
                </td>
              ))}
            </tr>

            <tr>
              <th className="dpp-column-scenario-column" scope="row">
                <strong>Cenário ORION</strong>
                <small>Motor Python</small>
              </th>
              {comparison.columns.map((column) => (
                <td className="number-cell" key={`orion-${column.column}`}>
                  {column.supported ? formatAggregate(column, column.orion_total) : 'Não calculado'}
                </td>
              ))}
            </tr>

            <tr className="dpp-column-difference-row">
              <th className="dpp-column-scenario-column" scope="row">
                <strong>Diferença</strong>
                <small>Final − ORION</small>
              </th>
              {comparison.columns.map((column) => {
                const divergent = column.supported && (
                  !isZero(column.delta) || Number(column.difference_count) > 0
                )
                const state = !column.supported ? 'unsupported' : divergent ? 'warning' : 'stable'

                return (
                  <td className="dpp-column-difference-cell" data-state={state} key={`diff-${column.column}`}>
                    <span className="dpp-column-state-marker" aria-hidden="true" />
                    <div>
                      <strong>{column.supported ? formatDelta(column) : 'Não calculado'}</strong>
                      <small>
                        {column.supported
                          ? differenceLabel(column.difference_count)
                          : column.note || 'Sem cálculo equivalente no cenário ORION'}
                      </small>
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="dpp-column-comparison-note">
        Colunas como Preço, Amount e Coments permanecem visíveis porque existem no DPP Final, mas são marcadas como não calculadas enquanto o motor ORION não produzir esses campos diretamente.
      </p>
    </section>
  )
}

export default DppColumnComparison
