import { randomUUID } from 'node:crypto'
import { mkdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DATA_MIGRATION_FORMAT_VERSION,
  DATA_MIGRATION_MAX_ENTRY_COUNT,
  DATA_MIGRATION_MAX_METADATA_BYTES,
  DATA_MIGRATION_MINIMUM_FREE_SPACE_RATIO,
  DataMigrationPackageEntrySchema,
  PackageRelativePathSchema,
  type DataMigrationManifestV1,
  type DataMigrationPackageEntry,
  type PackageRelativePath
} from '../../shared/data-migration'
import {
  readRcodepackEnvelopeHeader,
  verifyRcodepackPackage
} from './Rcodepack-container'
import { validateRcodepackPassphraseEncryption } from './Rcodepack-crypto'
import { readZip64Directory, type Zip64DirectoryEntry } from './Rcodepack-zip'

export type RcodepackInspectionBudget = {
  maximumEntries: number
  maximumExpandedBytes: number
  maximumEntryBytes: number
  maximumCompressionRatio: number
  maximumMetadataBytes: number
  minimumFreeSpaceRatio: number
}

export const DEFAULT_RCODEPACK_INSPECTION_BUDGET: RcodepackInspectionBudget = Object.freeze({
  maximumEntries: DATA_MIGRATION_MAX_ENTRY_COUNT,
  maximumExpandedBytes: 2 * 1024 * 1024 * 1024 * 1024,
  maximumEntryBytes: 512 * 1024 * 1024 * 1024,
  maximumCompressionRatio: 10_000,
  maximumMetadataBytes: DATA_MIGRATION_MAX_METADATA_BYTES,
  minimumFreeSpaceRatio: DATA_MIGRATION_MINIMUM_FREE_SPACE_RATIO
})

export type RcodepackHeaderInspection =
  | { kind: 'Rcodepack'; encrypted: boolean; formatVersion: number; passwordRequired: boolean }
  | { kind: 'not-Rcodepack'; message: string }

export type RcodepackInspectionResult = {
  manifest: DataMigrationManifestV1
  entries: DataMigrationPackageEntry[]
  expandedBytes: number
  compressedBytes: number
  warnings: string[]
}

export async function inspectRcodepackHeader(packagePath: string): Promise<RcodepackHeaderInspection> {
  try {
    const { header } = await readRcodepackEnvelopeHeader(packagePath)
    if (header.encryption.mode === 'passphrase') validateRcodepackPassphraseEncryption(header.encryption)
    return {
      kind: 'Rcodepack',
      encrypted: header.encryption.mode === 'passphrase',
      formatVersion: header.formatVersion,
      passwordRequired: header.encryption.mode === 'passphrase'
    }
  } catch (error) {
    return { kind: 'not-Rcodepack', message: error instanceof Error ? error.message : 'invalid Rcodepack package' }
  }
}

export async function inspectRcodepackPackage(input: {
  packagePath: string
  temporaryDirectory: string
  passphrase?: string
  budget?: Partial<RcodepackInspectionBudget>
  availableSpacePath?: string
  destinationSupportsLinks?: boolean
}): Promise<RcodepackInspectionResult> {
  const budget = { ...DEFAULT_RCODEPACK_INSPECTION_BUDGET, ...input.budget }
  const { header } = await readRcodepackEnvelopeHeader(input.packagePath)
  if (header.formatVersion > DATA_MIGRATION_FORMAT_VERSION) {
    throw new Error(`Rcodepack format version ${header.formatVersion} is newer than reader ${DATA_MIGRATION_FORMAT_VERSION}`)
  }
  if (header.encryption.mode === 'passphrase' && !input.passphrase) {
    throw new Error('Rcodepack passphrase is required')
  }
  await mkdir(input.temporaryDirectory, { recursive: true, mode: 0o700 })
  const zipPath = join(input.temporaryDirectory, `.inspect-${randomUUID()}.zip`)
  try {
    const verified = await verifyRcodepackPackage({
      packagePath: input.packagePath,
      materializedZipPath: zipPath,
      cleanupMaterialized: false,
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    })
    const directory = await readZip64Directory(zipPath)
    validateRcodepackArchiveDirectory(directory, verified.entries, budget)
    validateRcodepackLinkMetadata(verified.entries, { allowLinks: input.destinationSupportsLinks !== false })
    if (input.availableSpacePath) {
      await assertRcodepackInspectionDiskBudget({
        path: input.availableSpacePath,
        expandedBytes: verified.manifest.expandedBytes,
        budget
      })
    }
    const compressedBytes = directory.reduce((total, entry) => total + entry.compressedBytes, 0)
    return {
      manifest: verified.manifest,
      entries: verified.entries,
      expandedBytes: verified.manifest.expandedBytes,
      compressedBytes,
      warnings: header.encryption.mode === 'none'
        ? ['This unencrypted package has corruption detection but no sender authenticity.']
        : []
    }
  } finally {
    await rm(zipPath, { force: true }).catch(() => undefined)
  }
}

export function validateRcodepackArchiveDirectory(
  directory: readonly Zip64DirectoryEntry[],
  declarations: readonly DataMigrationPackageEntry[],
  budget: RcodepackInspectionBudget = DEFAULT_RCODEPACK_INSPECTION_BUDGET
): void {
  if (directory.length > budget.maximumEntries || declarations.length > budget.maximumEntries) {
    throw new Error(`Rcodepack entry count exceeds ${budget.maximumEntries}`)
  }
  const identityKeys = new Map<string, string>()
  let expandedBytes = 0
  for (const entry of directory) {
    if (entry.directory) throw new Error(`Rcodepack directory entries are not allowed: ${entry.path}`)
    const path = validateRcodepackEntryPath(entry.path)
    const identity = destinationIdentityKey(path)
    const collision = identityKeys.get(identity)
    if (collision) throw new Error(`Rcodepack contains an ambiguous path collision: ${collision} / ${path}`)
    identityKeys.set(identity, path)
    if (entry.encrypted) throw new Error(`nested ZIP encryption is not allowed: ${path}`)
    if (entry.logicalBytes > budget.maximumEntryBytes) throw new Error(`Rcodepack entry exceeds expanded byte limit: ${path}`)
    if ((path === 'manifest.json' || path === 'checksums.jsonl' || path.startsWith('catalog/')) && entry.logicalBytes > budget.maximumMetadataBytes) {
      throw new Error(`Rcodepack metadata entry exceeds read limit: ${path}`)
    }
    expandedBytes += entry.logicalBytes
    if (expandedBytes > budget.maximumExpandedBytes) throw new Error('Rcodepack expanded bytes exceed inspection budget')
    const ratio = entry.compressedBytes === 0
      ? (entry.logicalBytes === 0 ? 1 : Number.POSITIVE_INFINITY)
      : entry.logicalBytes / entry.compressedBytes
    if (ratio > budget.maximumCompressionRatio) throw new Error(`Rcodepack compression ratio exceeds limit: ${path}`)
  }
  for (const declaration of declarations) DataMigrationPackageEntrySchema.parse(declaration)
}

export function validateRcodepackEntryPath(value: string): PackageRelativePath {
  const path = PackageRelativePathSchema.parse(value)
  for (const segment of path.split('/')) {
    if (segment.includes(':') || [...segment].some((character) => character.charCodeAt(0) <= 0x1f)) {
      throw new Error(`Rcodepack entry contains an illegal or ADS path segment: ${value}`)
    }
    if (/[. ]$/.test(segment)) throw new Error(`Rcodepack entry contains a trailing dot or space: ${value}`)
    const stem = segment.split('.')[0]!.toLocaleLowerCase('en-US')
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem)) {
      throw new Error(`Rcodepack entry contains a reserved device name: ${value}`)
    }
    if (Buffer.byteLength(segment, 'utf8') > 255) throw new Error(`Rcodepack path component is too long: ${value}`)
  }
  if (Buffer.byteLength(path, 'utf8') > 32_767) throw new Error(`Rcodepack path is too long: ${value}`)
  return path
}

export function validateRcodepackLinkMetadata(
  entries: readonly DataMigrationPackageEntry[],
  options: { allowLinks?: boolean } = {}
): void {
  const links = new Map<string, string>()
  const paths = new Set(entries.map((entry) => entry.path))
  for (const entry of entries) {
    if (!entry.linkTarget) continue
    if (options.allowLinks === false) throw new Error(`destination does not support Rcodepack link metadata: ${entry.path}`)
    const target = PackageRelativePathSchema.parse(entry.linkTarget)
    if (!paths.has(target)) throw new Error(`Rcodepack link target is not a declared internal entry: ${entry.path}`)
    links.set(entry.path, target)
  }
  for (const start of links.keys()) {
    const seen = new Set<string>()
    let cursor: string | undefined = start
    while (cursor && links.has(cursor)) {
      if (seen.has(cursor)) throw new Error(`Rcodepack link metadata contains a loop: ${start}`)
      seen.add(cursor)
      cursor = links.get(cursor)
    }
  }
}

export async function assertRcodepackInspectionDiskBudget(input: {
  path: string
  expandedBytes: number
  budget?: RcodepackInspectionBudget
}): Promise<void> {
  const budget = input.budget ?? DEFAULT_RCODEPACK_INSPECTION_BUDGET
  const filesystem = await statfs(input.path)
  const freeBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
  const safetyMargin = Math.max(
    Math.ceil(input.expandedBytes * budget.minimumFreeSpaceRatio),
    256 * 1024 * 1024
  )
  if (input.expandedBytes + safetyMargin > freeBytes) {
    throw new Error(`Rcodepack import requires ${input.expandedBytes + safetyMargin} free bytes but only ${freeBytes} are available`)
  }
}

function destinationIdentityKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase('en-US')
}
