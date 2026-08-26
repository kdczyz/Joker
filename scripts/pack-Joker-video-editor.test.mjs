import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertStandaloneVideoEditorHostBundle,
  assertVideoEditorMatchesBundledArchive,
  assertDeterministicArchives,
  findReleaseArchive,
  videoEditorArchiveName,
  videoEditorBundledCatalog
} from './pack-Joker-video-editor.mjs'

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'Joker-video-editor-pack-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('derives the stable release asset name from the extension manifest', () => {
  assert.equal(
    videoEditorArchiveName({ name: 'Joker-video-editor', version: '0.1.0' }),
    'Joker-video-editor-0.1.0.Jokerx'
  )
  assert.throws(() => videoEditorArchiveName({ name: 'other', version: '0.1.0' }), /Expected/)
  assert.throws(
    () => videoEditorArchiveName({ name: 'Joker-video-editor', version: '../bad' }),
    /Invalid/
  )
})

test('requires standalone release bytes to match the product-bundled archive', async (t) => {
  const root = await temporaryRoot(t)
  const bundled = join(root, 'bundled')
  const release = join(root, 'Joker-video-editor-0.1.0.Jokerx')
  const archiveName = 'Joker-video-editor-0.1.0.Jokerx'
  await mkdir(bundled)
  await writeFile(release, 'same archive bytes')
  await writeFile(join(bundled, archiveName), 'same archive bytes')
  const identity = await assertDeterministicArchives(release, join(bundled, archiveName))
  await writeFile(join(bundled, 'catalog.json'), `${JSON.stringify({
    schemaVersion: 1,
    extensions: [{
      id: 'Joker-examples.Joker-video-editor',
      version: '0.1.0',
      archive: archiveName,
      sha256: identity.sha256
    }]
  })}\n`)
  await assert.doesNotReject(assertVideoEditorMatchesBundledArchive({
    archive: release,
    version: '0.1.0',
    sha256: identity.sha256,
    bundledDirectory: bundled
  }))
  await writeFile(join(bundled, archiveName), 'different archive bytes')
  await assert.rejects(assertVideoEditorMatchesBundledArchive({
    archive: release,
    version: '0.1.0',
    sha256: identity.sha256,
    bundledDirectory: bundled
  }), /archive bytes differ/)
})

test('derives a bounded bundled catalog from the canonical manifest and archive digest', () => {
  const digest = 'a'.repeat(64)
  assert.deepEqual(videoEditorBundledCatalog({
    publisher: 'Joker-examples',
    name: 'Joker-video-editor',
    version: '0.1.0',
    apiVersion: '1.2.0',
    engines: { Joker: '>=0.1.0' },
    permissions: ['ui.views', 'media.read', 'ui.views']
  }, 'Joker-video-editor-0.1.0.Jokerx', digest), {
    schemaVersion: 1,
    extensions: [{
      id: 'Joker-examples.Joker-video-editor',
      version: '0.1.0',
      archive: 'Joker-video-editor-0.1.0.Jokerx',
      sha256: digest,
      enginesJoker: '>=0.1.0',
      apiVersion: '1.2.0',
      permissions: ['media.read', 'ui.views']
    }]
  })
  assert.throws(() => videoEditorBundledCatalog({
    publisher: 'other',
    name: 'Joker-video-editor',
    version: '0.1.0',
    apiVersion: '1.2.0',
    engines: { Joker: '*' },
    permissions: []
  }, 'Joker-video-editor-0.1.0.Jokerx', digest), /Unexpected/)
})

test('accepts only byte-identical deterministic archives', async (t) => {
  const root = await temporaryRoot(t)
  const first = join(root, 'first.Jokerx')
  const second = join(root, 'second.Jokerx')
  await writeFile(first, 'same archive bytes')
  await writeFile(second, 'same archive bytes')
  const identity = await assertDeterministicArchives(first, second)
  assert.equal(identity.bytes, 18)
  assert.match(identity.sha256, /^[a-f0-9]{64}$/)

  await writeFile(second, 'different archive bytes')
  await assert.rejects(assertDeterministicArchives(first, second), /not deterministic/)
})

test('rejects Host bundles that retain repository-only runtime imports', async (t) => {
  const root = await temporaryRoot(t)
  const host = join(root, 'dist', 'host')
  await mkdir(host, { recursive: true })
  await writeFile(join(host, 'chunk.js'), 'export const value = 1\n')
  await writeFile(
    join(host, 'extension.js'),
    'import { createHash } from "node:crypto"\nexport { value } from "./chunk.js"\n'
  )
  await assert.doesNotReject(assertStandaloneVideoEditorHostBundle(host))

  await writeFile(
    join(host, 'extension.js'),
    'import { MediaAudioAnalysisResultSchema } from "@joker-code/extension-api"\n'
  )
  await assert.rejects(
    assertStandaloneVideoEditorHostBundle(host),
    /not standalone[\s\S]*@Joker\/extension-api/u
  )
})

test('finds exactly one regular release archive and rejects duplicate or linked trees', async (t) => {
  const root = await temporaryRoot(t)
  const name = 'Joker-video-editor-0.1.0.Jokerx'
  const release = join(root, name)
  await writeFile(release, 'archive')
  assert.equal(await findReleaseArchive(root, name), release)

  const nested = join(root, 'nested')
  await mkdir(nested)
  await writeFile(join(nested, name), 'duplicate')
  await assert.rejects(findReleaseArchive(root, name), /exactly one/)

  await rm(join(nested, name))
  await writeFile(join(nested, 'Joker-video-editor-9.9.9.Jokerx'), 'stale')
  await assert.rejects(findReleaseArchive(root, name), /unexpected Joker Video Editor archives/)

  await rm(join(nested, 'Joker-video-editor-9.9.9.Jokerx'))
  await symlink(release, join(nested, 'Joker-video-editor-9.9.9.Jokerx'))
  await assert.rejects(findReleaseArchive(root, name), /must not be a symlink/)
})
