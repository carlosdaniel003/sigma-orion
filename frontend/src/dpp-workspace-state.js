import { classifyDppBundle } from './dpp-file-bundle'

export function fileIdentity(file) {
  return `${file?.name || ''}:${file?.size || 0}:${file?.lastModified || 0}`
}

export function scenarioValidationIdentity(scenario) {
  if (!scenario) return ''
  const models = (scenario.models || [])
    .map((model) => `${model?.name || ''}:${Number(model?.kit_pgd) || 0}:${Number(model?.real) || 0}`)
    .join('|')
  return `${scenario.scenario_id || ''}:${models}`
}

export function buildFinalDppSignature({ bundle, scenario, referenceMonth }) {
  const finalFile = bundle?.expectedDpp
  if (!finalFile || !scenario) return ''
  const month = referenceMonth || bundle?.referenceMonth || ''
  if (!month) return ''
  return `${month}|${fileIdentity(finalFile)}|${scenarioValidationIdentity(scenario)}`
}

export function buildDppWorkspaceState({
  files,
  referenceMonth,
  generatedScenario,
  generatedSignature,
  finalDppAnalysis,
  finalDppSignature,
  testResult,
  testSignature,
  workspaceReady,
}) {
  const bundle = classifyDppBundle(files, referenceMonth, 'generate')
  const testBundle = classifyDppBundle(files, referenceMonth, 'test')
  const currentMonth = referenceMonth
    || bundle.referenceMonth
    || generatedScenario?.reference_month
    || finalDppAnalysis?.column_comparison?.reference_month
    || ''
  const hasPackage = Boolean((files || []).length)
  const packageReady = Boolean(bundle.ready)

  const scenarioAvailable = Boolean(generatedScenario)
  const scenarioMonthMatches = !generatedScenario?.reference_month
    || !currentMonth
    || generatedScenario.reference_month === currentMonth
  const scenarioSignatureMatches = !hasPackage
    || (packageReady && Boolean(bundle.signature) && generatedSignature === bundle.signature)
  const scenarioCurrent = Boolean(
    workspaceReady
    && scenarioAvailable
    && scenarioMonthMatches
    && scenarioSignatureMatches,
  )

  let scenarioState = 'missing'
  if (!workspaceReady) scenarioState = 'restoring'
  else if (scenarioAvailable && scenarioCurrent) scenarioState = 'current'
  else if (scenarioAvailable) scenarioState = 'stale'

  const expectedFinalDppSignature = buildFinalDppSignature({
    bundle,
    scenario: generatedScenario,
    referenceMonth: currentMonth,
  })
  const finalFileAvailable = Boolean(bundle.expectedDpp)
  const finalAnalysisAvailable = Boolean(finalDppAnalysis)
  const finalSignatureMatches = Boolean(
    expectedFinalDppSignature
    && finalDppSignature
    && expectedFinalDppSignature === finalDppSignature,
  )
  const finalCurrent = Boolean(
    workspaceReady
    && scenarioCurrent
    && finalFileAvailable
    && finalAnalysisAvailable
    && finalSignatureMatches,
  )

  let finalState = 'missing-file'
  if (!workspaceReady) finalState = 'restoring'
  else if (!finalFileAvailable) finalState = 'missing-file'
  else if (!scenarioCurrent) finalState = 'waiting-scenario'
  else if (finalAnalysisAvailable && finalCurrent) finalState = 'current'
  else if (finalAnalysisAvailable) finalState = 'stale'
  else finalState = 'pending'

  const testCurrent = Boolean(
    workspaceReady
    && testResult
    && testBundle.ready
    && testBundle.signature
    && testSignature === testBundle.signature,
  )

  return {
    bundle,
    testBundle,
    currentMonth,
    hasPackage,
    packageReady,
    packageState: !workspaceReady
      ? 'restoring'
      : !hasPackage
        ? 'empty'
        : packageReady
          ? 'ready'
          : 'incomplete',
    scenario: {
      state: scenarioState,
      available: scenarioAvailable,
      current: scenarioCurrent,
      monthMatches: scenarioMonthMatches,
      signatureMatches: scenarioSignatureMatches,
    },
    finalDpp: {
      state: finalState,
      fileAvailable: finalFileAvailable,
      analysisAvailable: finalAnalysisAvailable,
      current: finalCurrent,
      signatureMatches: finalSignatureMatches,
      expectedSignature: expectedFinalDppSignature,
    },
    test: {
      current: testCurrent,
    },
  }
}
