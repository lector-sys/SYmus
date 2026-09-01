import test from 'node:test'
import assert from 'node:assert/strict'
import { ACCENTS, loadTheme } from '../src/renderer/src/theme.ts'

// applyTheme is not covered here on purpose: it only touches documentElement,
// which this runner has no DOM for. What is worth pinning is the read, because
// it runs at import time in the app and its inputs come off disk.

const store = (map: Record<string, string>): void => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => map[k] ?? null }
  })
}

test('no storage at all still resolves', () => {
  assert.deepEqual(loadTheme(), { mode: 'system', accent: 'classic' })
})

test('stored values round-trip', () => {
  store({ 'symus.theme': 'light', 'symus.accent': 'halide' })
  assert.deepEqual(loadTheme(), { mode: 'light', accent: 'halide' })
})

test('junk falls back instead of reaching the DOM', () => {
  store({ 'symus.theme': 'Light', 'symus.accent': 'ember' })
  assert.deepEqual(loadTheme(), { mode: 'system', accent: 'classic' })
})

test('a throwing localStorage is survivable', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied')
    }
  })
  assert.deepEqual(loadTheme(), { mode: 'system', accent: 'classic' })
})

test('every accent id has a swatch the settings page can render', () => {
  assert.equal(ACCENTS.length, 4)
  for (const a of ACCENTS) assert.match(a.swatch, /^#[0-9a-f]{6}$/)
})
