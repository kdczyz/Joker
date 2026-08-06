import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'Rcode-extension-packaging-'))
  temporaryRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
}

function packContext(root: string, platform: 'darwin' | 'win32' | 'linux') {
  return {
    appOutDir: join(root, platform),
    electronPlatformName: platform,
    packager: { appInfo: { productFilename: 'Rcode' } }
  }
}

function writeBundledExtensionResources(context: ReturnType<typeof packContext>): void {
  const root = join(afterPack._internals.packedResourcesDir(context), 'bundled-extensions')
  const extensions = [
    {
      id: 'Rcode-examples.Rcode-video-editor',
      archive: 'Rcode-video-editor-0.1.0.Rcodex'
    },
    {
      id: 'Rcode-examples.presentation-studio',
      archive: 'presentation-studio-0.1.0.Rcodex'
    },
    {
      id: 'Rcode-examples.social-media-sidebar',
      archive: 'social-media-sidebar-0.1.3.Rcodex'
    }
  ].map((entry) => {
    const bytes = Buffer.from(`deterministic bundled extension archive: ${entry.id}`)
    return {
      ...entry,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  })
  mkdirSync(root, { recursive: true })
  for (const extension of extensions) {
    writeFileSync(join(root, extension.archive), extension.bytes)
  }
  writeFileSync(join(root, 'catalog.json'), `${JSON.stringify({
    schemaVersion: 1,
    extensions: extensions.map((extension) => ({
      id: extension.id,
      version: '0.1.0',
      archive: extension.archive,
      sha256: extension.sha256
    }))
  }, null, 2)}\n`)
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('Extension Platform packaged release resources', () => {
  it('includes the public SDK schema, compatibility fixtures, and every scaffolder shape', () => {
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'packages/extension-api/package.json',
      'packages/extension-api/dist/**/*',
      'packages/extension-api/schema/**/*',
      'packages/extension-api/fixtures/**/*',
      'packages/create-Rcode-extension/package.json',
      'packages/create-Rcode-extension/src/**/*',
      'packages/create-Rcode-extension/templates/**/*'
    ]))

    expect(afterPack.RCODE_RUNTIME_REQUIRED_PATHS).toEqual(expect.arrayContaining([
      'Rcode/dist/cli/extension-cli.js',
      'Rcode/dist/extensions/host-runner.js',
      'packages/extension-api/schema/Rcode-extension.schema.json',
      'packages/extension-api/fixtures/api-major-negotiation.json',
      'packages/create-Rcode-extension/templates/node/src/extension.ts',
      'packages/create-Rcode-extension/templates/react/src/host/extension.ts',
      'packages/create-Rcode-extension/templates/react/src/webview/main.tsx',
      'packages/create-Rcode-extension/templates/webview/src/webview/main.ts'
    ]))
    expect(builderConfig.extraResources).toEqual(expect.arrayContaining([{
      from: 'resources/bundled-extensions',
      to: 'bundled-extensions',
      filter: ['catalog.json', '*.Rcodex']
    }]))
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).toContain(
      'Rcode-examples.Rcode-video-editor'
    )
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).toContain(
      'Rcode-examples.presentation-studio'
    )
    expect(afterPack.REQUIRED_BUNDLED_EXTENSION_IDS).toContain(
      'Rcode-examples.social-media-sidebar'
    )
  })

  it.each(['darwin', 'win32', 'linux'] as const)(
    'resolves and validates the %s packaged resource layout',
    (platform) => {
      const root = temporaryRoot()
      const context = packContext(root, platform)
      const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

      for (const relativePath of afterPack.RCODE_RUNTIME_REQUIRED_PATHS) {
        touch(join(unpackedRoot, relativePath))
      }
      touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))
      writeBundledExtensionResources(context)

      expect(() => afterPack._internals.validateBundledRcodeRuntime(context)).not.toThrow()
      expect(() => afterPack._internals.validateBundledExtensionResources(context)).not.toThrow()
      if (platform === 'darwin') {
        expect(unpackedRoot).toContain(join('Rcode.app', 'Contents', 'Resources', 'app.asar.unpacked'))
      } else {
        expect(unpackedRoot).toContain(join(platform, 'resources', 'app.asar.unpacked'))
      }
    }
  )

  it('fails packaged validation when bundled archive bytes no longer match the catalog', () => {
    const root = temporaryRoot()
    const context = packContext(root, 'darwin')
    writeBundledExtensionResources(context)
    writeFileSync(
      join(afterPack._internals.packedResourcesDir(context), 'bundled-extensions', 'Rcode-video-editor-0.1.0.Rcodex'),
      'tampered'
    )
    expect(() => afterPack._internals.validateBundledExtensionResources(context)).toThrow(
      /digest mismatch/
    )
  })
})
