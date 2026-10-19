import assert from 'node:assert/strict'
import test from 'node:test'
import { evidenceCoveragePercent } from '../src/investigation-visual-metrics.js'

test('source evidence is capped for display and never represents released inventory', () => {
  assert.equal(evidenceCoveragePercent(3, 12), 25)
  assert.equal(evidenceCoveragePercent(20, 12), 100)
  assert.equal(evidenceCoveragePercent(0, 12), 0)
})
test('invalid and empty baselines do not create fake percentage', () => {
  assert.equal(evidenceCoveragePercent(10, 0), 0)
  assert.equal(evidenceCoveragePercent(-1, 5), 0)
  assert.equal(evidenceCoveragePercent('indefinido', 5), 0)
})
