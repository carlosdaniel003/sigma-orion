import { useEffect, useMemo, useRef } from 'react'
import { classifyDppBundle, FILE_LABELS } from './dpp-file-bundle'
import { useDppWorkspace } from './DppWorkspaceContext'
import './bulk-file-picker.css'

const DISPLAY_ORDER = ['baseDpp', 'expectedDpp', 'stock', 'explosion', 'openFile', 'pgd', 'wiu']

function fileIdentity(file) {
  return `${file?.name || ''}:${file?.size || 0}:${file?.lastModified || 0}`
}

function mergeFiles(currentFiles, newFiles) {
  const merged = [...currentFiles]
  const known = new Set(currentFiles.map(fileIdentity))

  for (const file of newFiles) {
    const identity = fileIdentity(file)
    if (known.has(identity)) continue
    known.add(identity)
    merged.push(file)
  }

  return merged
}

function BulkDppFilePicker({ mode = 'generate', referenceMonth = '', onBundle, compact = false, processing = false, title = 'Adicionar arquivos em massa' }) {
  const { files: selectedFiles, setFiles, referenceMonth: sharedReferenceMonth, setReferenceMonth: setSharedReferenceMonth } = useDppWorkspace()
  const onBundleRef = useRef(onBundle)
  const effectiveReferenceMonth = referenceMonth || sharedReferenceMonth
  const report = useMemo(
    () => classifyDppBundle(selectedFiles, effectiveReferenceMonth, mode),
    [selectedFiles, effectiveReferenceMonth, mode],
  )

  useEffect(() => {
    onBundleRef.current = onBundle
  }, [onBundle])

  useEffect(() => {
    onBundleRef.current?.(report)
  }, [report])

  useEffect(() => {
    if (report.referenceMonth && report.referenceMonth !== sharedReferenceMonth) {
      setSharedReferenceMonth(report.referenceMonth)
    }
  }, [report.referenceMonth, sharedReferenceMonth, setSharedReferenceMonth])

  function addFiles(event) {
    const incomingFiles = Array.from(event.target.files || [])
    if (!incomingFiles.length || processing) return

    setFiles((current) => mergeFiles(current, incomingFiles))
    event.target.value = ''
  }

  function clearFiles() {
    if (processing) return
    setFiles([])
    setSharedReferenceMonth('')
  }

  const missingLabels = report.missing.map((key) => FILE_LABELS[key])
  const primaryActionLabel = processing
    ? 'Processando...'
    : selectedFiles.length
      ? report.ready
        ? 'Adicionar mais arquivos'
        : 'Adicionar arquivos faltantes'
      : 'Selecionar arquivos'

  return (
    <section className={`bulk-file-picker ${compact ? 'compact' : ''} ${processing ? 'is-processing' : ''}`}>
      <div className="bulk-file-picker-head">
        <div>
          <span className="eyebrow">PACOTE DO MÊS</span>
          <h3>{title}</h3>
          <p>Selecione o pacote uma única vez. Os mesmos arquivos permanecem disponíveis no Dashboard, Gerar DPP e Testes enquanto o SIGMA-S ORION estiver aberto.</p>
        </div>
        <div className="bulk-file-actions">
          <label className={`bulk-file-button ${processing ? 'disabled' : ''}`}>
            <input type="file" accept=".xlsx,.xlsm" multiple onChange={addFiles} disabled={processing} />
            <span>{primaryActionLabel}</span>
          </label>
          {selectedFiles.length > 0 && (
            <button className="bulk-file-clear" type="button" onClick={clearFiles} disabled={processing}>Limpar pacote</button>
          )}
        </div>
      </div>

      {selectedFiles.length > 0 && (
        <>
          <div className={`bulk-package-status ${processing ? 'processing' : report.ready ? 'ready' : 'missing'}`}>
            <strong>{processing ? 'ORION processando o pacote' : report.ready ? 'Pacote completo' : `Faltam ${report.missing.length} arquivo(s) obrigatório(s)`}</strong>
            <span>
              {processing
                ? 'A análise já foi iniciada. O resultado será exibido automaticamente.'
                : report.ready
                  ? `${report.recognized} arquivo(s) reconhecido(s). O pacote está disponível para todas as telas do DPP.`
                  : `${missingLabels.join(' · ')} — adicione somente o que falta sem perder os arquivos já carregados.`}
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
                    <small>{file ? file.name : required ? 'Não encontrado — adicione este arquivo ao pacote' : 'Opcional / não carregado'}</small>
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
