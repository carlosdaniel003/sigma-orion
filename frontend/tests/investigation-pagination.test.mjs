import assert from 'node:assert/strict'
import test from 'node:test'
import { paginateRows } from '../src/investigation-pagination.js'

test('estoque: 91 PNs em 10 páginas sem omissão ou duplicata', () => {
  const rows = Array.from({ length: 91 }, (_, i) => 'PN-' + (i + 1))
  const pages = Array.from({ length: 10 }, (_, i) => paginateRows(rows, i + 1, 10))
  assert.equal(pages[0].first, 1)
  assert.equal(pages[0].last, 10)
  assert.equal(pages[9].first, 91)
  assert.equal(pages[9].last, 91)
  assert.deepEqual(pages.flatMap((part) => part.rows), rows)
})

test('qualidade: 82 PNs em páginas de 25 ou 50 linhas', () => {
  const rows = Array.from({ length: 82 }, (_, i) => i)
  const twentyFive = paginateRows(rows, 4, 25)
  assert.equal(twentyFive.pages, 4)
  assert.deepEqual(twentyFive.rows, [75, 76, 77, 78, 79, 80, 81])
  assert.equal(twentyFive.first, 76)
  assert.equal(twentyFive.last, 82)
  const fifty = paginateRows(rows, 2, 50)
  assert.equal(fifty.pages, 2)
  assert.equal(fifty.rows.length, 32)
})

test('lista vazia, página acima do total e tamanho inválido', () => {
  assert.deepEqual(paginateRows([], 3, 10).rows, [])
  assert.equal(paginateRows([], 3, 10).first, 0)
  assert.equal(paginateRows([], 3, 10).pages, 1)
  assert.equal(paginateRows([1, 2, 3], 99, 10).page, 1)
  assert.equal(paginateRows(Array.from({ length: 21 }, (_, i) => i), -2, 10).page, 1)
  assert.equal(paginateRows(Array.from({ length: 21 }, (_, i) => i), 3, 13).page, 1)
})

test('registros por depósito preservam identidade e validação', () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({
    id: 'candidate-' + (i + 1),
    validation: i % 2 === 0 ? { decision: 'AVAILABLE' } : null,
  }))
  const second = paginateRows(rows, 2, 10)
  assert.deepEqual(second.rows, rows.slice(10, 20))
  assert.equal(second.rows[0].id, 'candidate-11')
  assert.equal(second.rows[0].validation, null)
  assert.equal(second.rows[1].validation.decision, 'AVAILABLE')
})
