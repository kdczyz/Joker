import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUNDLED_EXTENSION_DEFINITIONS,
  bundledArchiveName,
  bundledCatalogEntry,
  bundledExtensionCatalog
} from './pack-bundled-extensions.mjs'

const digest = 'a'.repeat(64)

function manifest(name, overrides = {}) {
  return {
    publisher: 'Rcode-examples',
    name,
    version: '0.1.0',
    apiVersion: '1.0.0',
    engines: { Rcode: '>=0.1.0' },
    permissions: ['ui.views', 'workspace.read', 'ui.views'],
    ...overrides
  }
}

test('declares every product-owned default extension', () => {
  assert.deepEqual(
    BUNDLED_EXTENSION_DEFINITIONS.map((entry) => entry.id),
    [
      'Rcode-examples.Rcode-video-editor',
      'Rcode-examples.presentation-studio',
      'Rcode-examples.social-media-sidebar'
    ]
  )
})

test('derives bounded catalog entries from canonical manifests', () => {
  const definition = BUNDLED_EXTENSION_DEFINITIONS[1]
  assert.equal(
    bundledArchiveName(manifest('presentation-studio'), definition.name),
    'presentation-studio-0.1.0.Rcodex'
  )
  assert.deepEqual(
    bundledCatalogEntry(
      definition,
      manifest('presentation-studio'),
      'presentation-studio-0.1.0.Rcodex',
      digest
    ),
    {
      id: 'Rcode-examples.presentation-studio',
      version: '0.1.0',
      archive: 'presentation-studio-0.1.0.Rcodex',
      sha256: digest,
      enginesRcode: '>=0.1.0',
      apiVersion: '1.0.0',
      permissions: ['ui.views', 'workspace.read']
    }
  )
  assert.throws(
    () => bundledCatalogEntry(
      definition,
      manifest('other'),
      'presentation-studio-0.1.0.Rcodex',
      digest
    ),
    /Unexpected/
  )
})

test('sorts catalog entries and rejects duplicate extension ids', () => {
  const entries = BUNDLED_EXTENSION_DEFINITIONS.map((definition) => bundledCatalogEntry(
    definition,
    manifest(definition.name),
    `${definition.name}-0.1.0.Rcodex`,
    digest
  )).reverse()
  const catalog = bundledExtensionCatalog(entries)
  assert.deepEqual(
    catalog.extensions.map((entry) => entry.id),
    [
      'Rcode-examples.Rcode-video-editor',
      'Rcode-examples.presentation-studio',
      'Rcode-examples.social-media-sidebar'
    ]
  )
  assert.throws(
    () => bundledExtensionCatalog([entries[0], entries[0]]),
    /duplicate/
  )
})
