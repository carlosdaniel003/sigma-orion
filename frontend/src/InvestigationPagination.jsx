import { useEffect, useMemo, useState } from 'react'
import { PAGE_SIZES, paginateRows } from './investigation-pagination'

export function useInvestigationPagination(rows, reportKey) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])

  // Reconsultar ou trocar o cenário reinicia a navegação.
  // Uma revisão da validação preserva a página corrente.
  useEffect(() => setPage(1), [reportKey])
  const data = useMemo(() => paginateRows(rows, page, pageSize), [rows, page, pageSize])

  return {
    ...data,
    goToPage: (newPage) => setPage(Math.max(1, Math.min(newPage, data.pages))),
    changePageSize: (newSize) => {
      setPageSize(PAGE_SIZES.includes(Number(newSize)) ? Number(newSize) : PAGE_SIZES[0])
      setPage(1)
    },
  }
}

export default function InvestigationPagination({ value, label, onNavigate }) {
  if (!value.total) return null

  function goToPage(page) {
    if (page === value.page) return
    onNavigate?.()
    value.goToPage(page)
  }

  function changePageSize(event) {
    onNavigate?.()
    value.changePageSize(event.target.value)
  }

  return (
    <nav className="orion-investigation-pagination" aria-label={'Paginação — ' + label}>
      <span className="orion-investigation-range">
        Exibindo <strong>{value.first}–{value.last}</strong> de <strong>{value.total}</strong> registros
      </span>
      <label className="orion-investigation-per-page">
        Linhas por página
        <select value={value.pageSize} onChange={changePageSize}>
          {PAGE_SIZES.map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
      <div className="orion-investigation-page-buttons">
        <button type="button" className="secondary-button" onClick={() => goToPage(1)}
          disabled={value.page <= 1} aria-label={'Primeira página — ' + label}>Primeira</button>
        <button type="button" className="secondary-button" onClick={() => goToPage(value.page - 1)}
          disabled={value.page <= 1} aria-label={'Página anterior — ' + label}>Anterior</button>
        <span className="orion-investigation-page-status" aria-live="polite">
          Página {value.page} de {value.pages}
        </span>
        <button type="button" className="secondary-button" onClick={() => goToPage(value.page + 1)}
          disabled={value.page >= value.pages} aria-label={'Próxima página — ' + label}>Próxima</button>
        <button type="button" className="secondary-button" onClick={() => goToPage(value.pages)}
          disabled={value.page >= value.pages} aria-label={'Última página — ' + label}>Última</button>
      </div>
    </nav>
  )
}
