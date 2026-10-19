import assert from 'node:assert/strict'
import test from 'node:test'
import { investigationUnits, stockFound, qualityFound, pendingRecords, filterFound } from '../src/investigation-view-model.js'

const stock = {
  materials: [
    { material: 'A', unit: 'UN', negative_balance: 8, recovered_quantity_applied: 3,
      projected_gap_remaining: 5, unexplained_quantity: 5,
      candidates: [{ candidate_id: 'a', depot: 'M221', quantity: 10 }] },
    { material: 'B', unit: 'UN', negative_balance: 5, recovered_quantity_applied: 0,
      projected_gap_remaining: 5, unexplained_quantity: 2,
      candidates: [{ candidate_id: 'b', depot: 'P277', quantity: 2, validation: { decision: 'UNAVAILABLE' } }] },
  ],
  unmatched_materials: [{ material: 'C', unit: 'UN', negative_balance: 4 }],
}
const quality = { materials: [
  { material: 'C', unit: 'UN', gap_from_41: 4, quality_released_applied: 1, unexplained_after_quality: 3,
    candidates: [{ candidate_id: 'c', depot: 'Q239', quantity: 6 }] },
  { material: 'D', unit: 'UN', gap_from_41: 5, unexplained_after_quality: 5, candidates: [] },
] }

test('estoque: mostra somente PNs com registros, prioriza pendentes e mantém busca', () => {
  const found = stockFound(stock)
  assert.deepEqual(found.map(m => m.material), ['A', 'B'])
  assert.deepEqual(pendingRecords(found).map(p => p.candidate.candidate_id), ['a'])
  assert.deepEqual(filterFound(found, 'M221', 'all').map(m => m.material), ['A'])
  assert.deepEqual(filterFound(found, 'p277', 'reviewed').map(m => m.material), ['B'])
  assert.deepEqual(filterFound(found, '', 'pending').map(m => m.material), ['A'])
})

test('qualidade: lista somente encontrados Q239 ou Q273, sem inventar confirmações', () => {
  assert.deepEqual(qualityFound(quality).map(m => m.material), ['C'])
  assert.equal(pendingRecords(qualityFound(quality)).length, 1)
})

test('totais respeitam unidades, estoque e déficit dos PNs sem registros', () => {
  const totals = investigationUnits(stock, quality)
  assert.equal(totals.length, 1)
  assert.equal(totals[0].deficit, 17)
  assert.equal(totals[0].foundStock, 12)
  assert.equal(totals[0].potentialStock, 10)
  assert.equal(totals[0].appliedStock, 3)
  assert.equal(totals[0].gapStock, 14)
  assert.equal(totals[0].unexplainedStock, 11)
  assert.equal(totals[0].foundQuality, 6)
  assert.equal(totals[0].unexplainedQuality, 8)
})

test('sem consulta, não presumir números nem listar itens inexistentes', () => {
  assert.deepEqual(stockFound(null), [])
  assert.deepEqual(qualityFound(null), [])
  assert.deepEqual(investigationUnits(null, null), [])
})
