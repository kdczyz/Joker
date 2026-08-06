import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { InMemoryPublisherTrustStore, loadPublisherTrustStore } from './publisher-trust-store.js'

describe('publisher trust store', () => {
  it('exposes runtime-owned publisher keys without caller input', () => {
    const store = new InMemoryPublisherTrustStore({ Rcode: 'pem-1', empty: '' })
    expect(store.getPublisherKey('Rcode')).toBe('pem-1')
    expect(store.getPublisherKey('missing')).toBeUndefined()
    expect(store.trustedPublisherIds()).toEqual(['Rcode'])
  })

  it('loads a JSON key map and fails closed on missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'Rcode-trust-'))
    const file = join(dir, 'publishers.json')
    await writeFile(file, JSON.stringify({ Rcode: 'pem-1', ignored: 42 }), 'utf8')

    const loaded = await loadPublisherTrustStore(file)
    expect(loaded.getPublisherKey('Rcode')).toBe('pem-1')
    expect(loaded.trustedPublisherIds()).toEqual(['Rcode'])

    const missing = await loadPublisherTrustStore(join(dir, 'missing.json'))
    expect(missing.trustedPublisherIds()).toEqual([])
  })
})
