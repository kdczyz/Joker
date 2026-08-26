import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { InMemoryPublisherTrustStore, loadPublisherTrustStore } from './publisher-trust-store.js'

describe('publisher trust store', () => {
  it('exposes runtime-owned publisher keys without caller input', () => {
    const store = new InMemoryPublisherTrustStore({ Joker: 'pem-1', empty: '' })
    expect(store.getPublisherKey('Joker')).toBe('pem-1')
    expect(store.getPublisherKey('missing')).toBeUndefined()
    expect(store.trustedPublisherIds()).toEqual(['Joker'])
  })

  it('loads a JSON key map and fails closed on missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'Joker-trust-'))
    const file = join(dir, 'publishers.json')
    await writeFile(file, JSON.stringify({ Joker: 'pem-1', ignored: 42 }), 'utf8')

    const loaded = await loadPublisherTrustStore(file)
    expect(loaded.getPublisherKey('Joker')).toBe('pem-1')
    expect(loaded.trustedPublisherIds()).toEqual(['Joker'])

    const missing = await loadPublisherTrustStore(join(dir, 'missing.json'))
    expect(missing.trustedPublisherIds()).toEqual([])
  })
})
