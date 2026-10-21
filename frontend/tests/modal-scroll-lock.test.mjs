import assert from 'node:assert/strict'
import test from 'node:test'
import { acquirePageScrollLock } from '../src/modal-scroll-lock.js'

function mockPage() {
  const savedWindow = globalThis.window
  const savedDocument = globalThis.document
  const scrollCalls = []

  const root = { style: { overflow: 'auto' }, clientWidth: 1183 }
  const body = { style: { overflow: '', position: 'relative', top: '',
    left: '', width: '' } }

  globalThis.window = {
    scrollX: 14,
    scrollY: 620,
    innerWidth: 1200,
    scrollTo(x, y) { scrollCalls.push([x, y]) },
  }
  globalThis.document = { documentElement: root, body }

  return {
    root, body, scrollCalls,
    restore() {
      globalThis.window = savedWindow
      globalThis.document = savedDocument
    },
  }
}

test('bloqueia a página e restaura estilos e posição anterior ao fechar', () => {
  const page = mockPage()
  try {
    const unlock = acquirePageScrollLock()
    assert.equal(page.root.style.overflow, 'hidden')
    assert.equal(page.body.style.overflow, 'hidden')
    assert.equal(page.body.style.position, 'fixed')
    assert.equal(page.body.style.top, '-620px')
    assert.equal(page.body.style.left, '-14px')
    assert.equal(page.body.style.width, 'calc(100% - 17px)')
    unlock()
    assert.equal(page.root.style.overflow, 'auto')
    assert.equal(page.body.style.overflow, '')
    assert.equal(page.body.style.position, 'relative')
    assert.equal(page.body.style.top, '')
    assert.equal(page.body.style.left, '')
    assert.equal(page.body.style.width, '')
    assert.deepEqual(page.scrollCalls, [[14, 620]])
  } finally {
    page.restore()
  }
})

test('fechamentos múltiplos e repetição do StrictMode não deixam scroll preso', () => {
  const page = mockPage()
  try {
    const unlock1 = acquirePageScrollLock()
    const unlock2 = acquirePageScrollLock()
    unlock1()
    unlock1()
    assert.equal(page.body.style.position, 'fixed')
    assert.deepEqual(page.scrollCalls, [])
    unlock2()
    assert.equal(page.body.style.position, 'relative')
    assert.deepEqual(page.scrollCalls, [[14, 620]])
    const releaseReplay = acquirePageScrollLock()
    releaseReplay()
    assert.equal(page.root.style.overflow, 'auto')
    assert.deepEqual(page.scrollCalls, [[14, 620], [14, 620]])
  } finally {
    page.restore()
  }
})
