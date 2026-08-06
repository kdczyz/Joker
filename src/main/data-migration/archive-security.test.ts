import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DataMigrationManifestV1Schema, parsePackageRelativePath } from '../../shared/data-migration'
import {
  DEFAULT_RCODEPACK_INSPECTION_BUDGET,
  inspectRcodepackHeader,
  inspectRcodepackPackage,
  validateRcodepackArchiveDirectory,
  validateRcodepackEntryPath,
  validateRcodepackLinkMetadata
} from './archive-security'
import { createRcodepackPackage } from './Rcodepack-container'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function manifest() {
  return DataMigrationManifestV1Schema.parse({
    formatVersion: 1,
    minimumReaderVersion: 1,
    packageId: 'package_security',
    sourceInstallationId: 'installation_security',
    sourceAppVersion: 'test',
    sourceRuntimeVersion: 'test',
    sourcePlatform: 'linux',
    sourceArch: 'x64',
    createdAt: '2026-07-15T00:00:00.000Z',
    encryption: { mode: 'none' },
    componentVersions: {
      manifest: 1, workspace: 1, thread: 1, session: 1, event: 1, attachment: 1,
      artifact: 1, memory: 1, 'portable-settings': 1, 'renderer-state': 1, workflow: 1, schedule: 1
    },
    selection: {
      preset: 'complete', workspaceIds: [], threadIds: [], categories: ['workspace-files'],
      sensitiveContentAcknowledged: false, unencryptedPackageAcknowledged: true
    },
    counts: { workspaces: 0, threads: 0, entries: 0, attachments: 0, artifacts: 0, memories: 0 },
    expandedBytes: 0,
    catalogsSha256: '0'.repeat(64),
    checksumsSha256: '0'.repeat(64)
  })
}

describe('Rcodepack archive security', () => {
  it('identifies and inspects a verified package without importing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'Rcodepack-inspection-'))
    roots.push(root)
    const packagePath = join(root, 'sample.Rcodepack')
    await createRcodepackPackage({
      outputPath: packagePath,
      manifest: manifest(),
      catalogs: [{ path: parsePackageRelativePath('catalog/workspaces.json'), value: [] }],
      entries: [{
        path: parsePackageRelativePath('payload/workspaces/ws_test/files/readme.txt'),
        kind: 'workspace-file',
        ownerId: 'ws_test',
        source: { kind: 'buffer', data: Buffer.from('portable') }
      }]
    })
    expect(await inspectRcodepackHeader(packagePath)).toMatchObject({
      kind: 'Rcodepack', encrypted: false, passwordRequired: false
    })
    const inspected = await inspectRcodepackPackage({
      packagePath,
      temporaryDirectory: join(root, 'inspection')
    })
    expect(inspected.manifest.packageId).toBe('package_security')
    expect(inspected.entries).toHaveLength(2)
    expect(inspected.warnings[0]).toContain('no sender authenticity')
  })

  it('rejects zip-slip, absolute, drive, ADS, device, trailing-dot, and oversized paths', () => {
    const malicious = [
      '../escape', '/absolute/file', 'C:/drive/file', '\\\\server\\share',
      'safe/file:stream', 'safe/CON.txt', 'safe/trailing. ', `safe/${'a'.repeat(256)}`
    ]
    for (const path of malicious) expect(() => validateRcodepackEntryPath(path)).toThrow()
    expect(validateRcodepackEntryPath('payload/workspaces/ws_1/files/合法-name.txt')).toBe('payload/workspaces/ws_1/files/合法-name.txt')
  })

  it('rejects case/Unicode aliases and compression or expanded-size bombs', () => {
    const entry = (path: string, logicalBytes = 1, compressedBytes = 1) => ({
      path,
      logicalBytes,
      compressedBytes,
      compressionMethod: 8,
      encrypted: false,
      directory: false,
      mode: 0o100600,
      modifiedAt: '2026-07-15T00:00:00.000Z'
    })
    expect(() => validateRcodepackArchiveDirectory(
      [entry('payload/File.txt'), entry('payload/file.txt')],
      []
    )).toThrow('ambiguous path collision')
    expect(() => validateRcodepackArchiveDirectory(
      [entry('payload/café.txt'), entry('payload/cafe\u0301.txt')],
      []
    )).toThrow('ambiguous path collision')
    expect(() => validateRcodepackArchiveDirectory(
      [entry('payload/bomb.bin', 20_000, 1)],
      [],
      { ...DEFAULT_RCODEPACK_INSPECTION_BUDGET, maximumCompressionRatio: 100 }
    )).toThrow('compression ratio')
  })

  it('rejects external link targets and link loops', () => {
    const base = {
      kind: 'workspace-file' as const,
      logicalBytes: 0,
      sha256: '0'.repeat(64)
    }
    expect(() => validateRcodepackLinkMetadata([{
      ...base,
      path: parsePackageRelativePath('payload/link'),
      linkTarget: parsePackageRelativePath('payload/missing')
    }])).toThrow('not a declared internal entry')
    expect(() => validateRcodepackLinkMetadata([
      { ...base, path: parsePackageRelativePath('payload/a'), linkTarget: parsePackageRelativePath('payload/b') },
      { ...base, path: parsePackageRelativePath('payload/b'), linkTarget: parsePackageRelativePath('payload/a') }
    ])).toThrow('loop')
  })

  it('keeps parser behavior stable over generated unsafe path variants', () => {
    const stems = ['CON', 'aux.txt', 'name:ads', '..', 'trailing.', 'trailing ']
    for (let index = 0; index < 128; index += 1) {
      const stem = stems[index % stems.length]!
      expect(() => validateRcodepackEntryPath(`payload/${index}/${stem}`)).toThrow()
    }
  })

  it('rejects a million-entry small-file workload from its declared count before traversal', () => {
    const tooMany = new Array(DEFAULT_RCODEPACK_INSPECTION_BUDGET.maximumEntries + 1)
    expect(() => validateRcodepackArchiveDirectory(tooMany, [])).toThrow('entry count exceeds')
  })
})
