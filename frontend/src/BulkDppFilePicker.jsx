import { useMemo, useState } from 'react'
import { classifyDppBundle, FILE_LABELS } from './dpp-file-bundle'
import './bulk-file-picker.css'

const DISPLAY_ORDER = ['baseDpp', 'expectedDpp', 'stock', 'explosion', 'openFile', 'pgd', 'wiu']

function BulkDppFilePicker({ mode = 'generate', referenceMonth = '', onBundle, compact = false, title = 'Adicionar arquivos em massa' }) {
  const [selectedFiles, setSelectedFiles] = useState([])
  const report = useMemo(
    () => classifyDppBundle(selectedFiles, referenceMonth, mode),
    [selectedFiles, referenceMonth, mode],
  )

  function selectFiles(event) {
    const files = Array.from(event.target.files || [])
    setSelectedFiles(files)
    const next = classifyDppBundle(files, referenceMonth, mode)
    onBundle?.(next)
  }

  const missingLabels = report.missing.map((key) => FILE_LABELS[key])

  return (
    <section className={`bulk-file-picker ${compact ? 'compact' : ''}`}>
      <div className="bulk-file-picker-head">
        <div>
          <span className="eyebrow">PACOTE DO MÊS</span>
          <h3>{title}</h3>
          <p>Selecione todos os arquivos de uma vez. O ORION identifica automaticamente DPP anterior, DPP final, STK, Explosão, OPEN, PGD e WIU pelo nome do arquivo.</p>
        </div>
        <label className="bulk-file-button">
          <input type="file" accept=".xlsx,.xlsm" multiple onChange={selectFiles} />
          <span>{selectedFiles.length ? 'Trocar pacote' : 'Selecionar arquivos'}</span>
        </label>
      </div>

      {selectedFiles.length > 0 && (
        <>
          <div className={`bulk-package-status ${report.ready ? 'ready' : 'missing'}`}>
            <strong>{report.ready ? 'Pacote completo' : `Faltam ${report.missing.length} arquivo(s) obrigatório(s)`}</strong>
            <span>
              {report.ready
                ? `${report.recognized} arquivo(s) reconhecido(s) automaticamente.`
                : missingLabels.join(' · ')}
            </span>
          </div>

          <div className="bulk-file-checks">
            {DISPLAY_ORDER.map((key) => {
              const file = report[key]
              const required = report.requiredKeys.includes(key)
              if (!required && key === 'expectedDpp' && mode === 'generate' && !file) return null
              return (
                <div className={`bulk-file-check ${file ? 'found' : required ? 'missing' : 'optional'}`} key={key}>
                  <span className="bulk-check-icon">{file ? '✓' : required ? '!' : '–'}</span>
                  <div>
                    <strong>{FILE_LABELS[key]}</strong>
                    <small>{file ? file.name : required ? 'Não encontrado' : 'Opcional / não carregado'}</small>
                  </div>
                </div>
              )
            })}
          </div>

          {(report.unknown.length > 0 || report.duplicates.length > 0) && (
            <div className="bulk-file-note">
              {report.unknown.length > 0 && <span>{report.unknown.length} arquivo(s) não reconhecido(s): {report.unknown.map((file) => file.name).join(', ')}</span>}
              {report.duplicates.length > 0 && <span>{report.duplicates.length} arquivo(s) duplicado(s) para a mesma categoria foram ignorados.</span>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default BulkDppFilePicker
