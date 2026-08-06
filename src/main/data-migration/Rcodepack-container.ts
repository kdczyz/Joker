import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import {
  DATA_MIGRATION_FORMAT_VERSION,
  DATA_MIGRATION_MAX_METADATA_BYTES,
  DataMigrationEnvelopeHeaderV1Schema,
  DataMigrationManifestV1Schema,
  DataMigrationPackageEntrySchema,
  PackageRelativePathSchema,
  parsePackageRelativePath,
  type DataMigrationEncryption,
  type DataMigrationEnvelopeHeaderV1,
  type DataMigrationManifestV1,
  type DataMigrationPackageEntry,
  type PackageRelativePath
} from '../../shared/data-migration'
import {
  createRcodepackPassphraseEncryption,
  decryptRcodepackFramesToFile,
  encryptRcodepackFileToHandle,
  type RcodepackFramedEncryptionResult
} from './Rcodepack-crypto'
import {
  prepareZip64ArchiveEntries,
  readZip64EntryBuffer,
  sha256File,
  verifyZip64ArchiveEntries,
  writeZip64Archive,
  type PreparedZip64ArchiveEntry,
  type Zip64ArchiveEntryInput
} from './Rcodepack-zip'

export const RCODEPACK_MAGIC = Buffer.from('RCODEPACK\0', 'ascii')
export const RCODEPACK_PREFIX_BYTES = RCODEPACK_MAGIC.length + 4
export const RCODEPACK_MAX_HEADER_BYTES = 64 * 1024
export const RCODEPACK_MANIFEST_PATH = parsePackageRelativePath('manifest.json')
export const RCODEPACK_CHECKSUMS_PATH = parsePackageRelativePath('checksums.jsonl')

export type RcodepackCatalogInput = {
  path: PackageRelativePath
  value: unknown
  ownerId?: string
}

export type CreateRcodepackPackageInput = {
  outputPath: string
  manifest: DataMigrationManifestV1
  catalogs: readonly RcodepackCatalogInput[]
  entries: readonly Zip64ArchiveEntryInput[]
  passphrase?: string
  encryptionSettings?: Extract<DataMigrationEncryption, { mode: 'passphrase' }>
  createdAt?: string
}

export type CreatedRcodepackPackage = {
  path: string
  header: DataMigrationEnvelopeHeaderV1
  manifest: DataMigrationManifestV1
  entries: DataMigrationPackageEntry[]
}

export type ReadRcodepackEnvelopeResult = {
  header: DataMigrationEnvelopeHeaderV1
  headerBytes: Buffer
  payloadOffset: number
}

export function canonicalizeRcodepackJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Rcodepack canonical JSON does not support non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : canonicalizeRcodepackJson(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      sorted[key] = canonicalizeRcodepackJson(record[key])
    }
    return sorted
  }
  throw new Error(`Rcodepack canonical JSON does not support ${typeof value}`)
}

export function serializeRcodepackJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalizeRcodepackJson(value))}\n`, 'utf8')
}

export function serializeRcodepackChecksums(entries: readonly DataMigrationPackageEntry[]): Buffer {
  const lines = [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => JSON.stringify(canonicalizeRcodepackJson(entry)))
  return Buffer.from(lines.length === 0 ? '' : `${lines.join('\n')}\n`, 'utf8')
}

export function parseRcodepackChecksums(contents: Buffer): DataMigrationPackageEntry[] {
  const entries: DataMigrationPackageEntry[] = []
  for (const line of contents.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    entries.push(DataMigrationPackageEntrySchema.parse(JSON.parse(line)))
  }
  const paths = new Set<string>()
  for (const entry of entries) {
    if (paths.has(entry.path)) throw new Error(`duplicate Rcodepack checksum declaration: ${entry.path}`)
    paths.add(entry.path)
  }
  return entries
}

export async function createRcodepackPackage(input: CreateRcodepackPackageInput): Promise<CreatedRcodepackPackage> {
  const outputDirectory = dirname(input.outputPath)
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  if (await lstat(input.outputPath).then(() => true).catch(() => false)) {
    throw new Error(`Rcodepack destination already exists: ${input.outputPath}`)
  }

  const encryption: DataMigrationEncryption = input.passphrase
    ? input.encryptionSettings ?? createRcodepackPassphraseEncryption()
    : { mode: 'none' }
  if (!input.passphrase && input.encryptionSettings) {
    throw new Error('Rcodepack encryption settings require a passphrase')
  }

  const packageToken = `${process.pid}.${randomUUID()}`
  const zipPath = join(outputDirectory, `.Rcodepack-${packageToken}.zip.tmp`)
  const packagePath = join(outputDirectory, `.Rcodepack-${packageToken}.tmp`)
  const verificationZipPath = join(outputDirectory, `.Rcodepack-${packageToken}.verify.zip.tmp`)
  try {
    const catalogInputs: Zip64ArchiveEntryInput[] = input.catalogs.map((catalog) => {
      PackageRelativePathSchema.parse(catalog.path)
      if (!catalog.path.startsWith('catalog/')) throw new Error(`Rcodepack catalog path must be under catalog/: ${catalog.path}`)
      return {
        path: catalog.path,
        kind: 'catalog',
        ...(catalog.ownerId ? { ownerId: catalog.ownerId } : {}),
        source: { kind: 'buffer', data: serializeRcodepackJson(catalog.value) }
      }
    })
    const payloadEntries = await prepareZip64ArchiveEntries([...catalogInputs, ...input.entries])
    const checksumContents = serializeRcodepackChecksums(payloadEntries.map((entry) => entry.metadata))
    const catalogDigest = digestRcodepackCatalogs(payloadEntries)
    const manifest = DataMigrationManifestV1Schema.parse({
      ...input.manifest,
      formatVersion: DATA_MIGRATION_FORMAT_VERSION,
      encryption,
      counts: {
        ...input.manifest.counts,
        entries: payloadEntries.length
      },
      expandedBytes: payloadEntries.reduce((total, entry) => total + entry.metadata.logicalBytes, 0),
      catalogsSha256: catalogDigest,
      checksumsSha256: sha256Buffer(checksumContents)
    })

    const structuralEntries = await prepareZip64ArchiveEntries([
      {
        path: RCODEPACK_MANIFEST_PATH,
        kind: 'catalog',
        source: { kind: 'buffer', data: serializeRcodepackJson(manifest) }
      },
      {
        path: RCODEPACK_CHECKSUMS_PATH,
        kind: 'catalog',
        source: { kind: 'buffer', data: checksumContents }
      }
    ])
    await writeZip64Archive({ outputPath: zipPath, entries: [...structuralEntries, ...payloadEntries] })
    const header = await writeRcodepackEnvelope({
      zipPath,
      outputPath: packagePath,
      encryption,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
      createdAt: input.createdAt ?? new Date().toISOString()
    })
    await verifyRcodepackPackage({
      packagePath,
      materializedZipPath: verificationZipPath,
      ...(input.passphrase ? { passphrase: input.passphrase } : {})
    })
    await publishWithoutOverwrite(packagePath, input.outputPath)
    return {
      path: input.outputPath,
      header,
      manifest,
      entries: payloadEntries.map((entry) => entry.metadata)
    }
  } finally {
    await Promise.all([
      rm(zipPath, { force: true }),
      rm(packagePath, { force: true }),
      rm(verificationZipPath, { force: true })
    ]).catch(() => undefined)
  }
}

export async function writeRcodepackEnvelope(input: {
  zipPath: string
  outputPath: string
  encryption: DataMigrationEncryption
  passphrase?: string
  createdAt: string
}): Promise<DataMigrationEnvelopeHeaderV1> {
  const zipStats = await stat(input.zipPath)
  if (!zipStats.isFile()) throw new Error('Rcodepack payload must be a regular file')
  const header = DataMigrationEnvelopeHeaderV1Schema.parse({
    envelopeVersion: 1,
    payloadFormat: 'zip64',
    formatVersion: DATA_MIGRATION_FORMAT_VERSION,
    createdAt: input.createdAt,
    plainPayloadBytes: zipStats.size,
    plainPayloadSha256: await sha256File(input.zipPath),
    encryption: input.encryption
  })
  const headerBytes = serializeRcodepackJson(header)
  if (headerBytes.length > RCODEPACK_MAX_HEADER_BYTES) throw new Error('Rcodepack envelope header is too large')
  const prefix = Buffer.allocUnsafe(RCODEPACK_PREFIX_BYTES)
  RCODEPACK_MAGIC.copy(prefix, 0)
  prefix.writeUInt32BE(headerBytes.length, RCODEPACK_MAGIC.length)
  const output = await open(input.outputPath, 'wx', 0o600)
  try {
    await output.write(prefix, 0, prefix.length, 0)
    await output.write(headerBytes, 0, headerBytes.length, prefix.length)
    const payloadPosition = prefix.length + headerBytes.length
    if (header.encryption.mode === 'passphrase') {
      if (!input.passphrase) throw new Error('Rcodepack passphrase is required')
      await encryptRcodepackFileToHandle({
        inputPath: input.zipPath,
        output,
        outputPosition: payloadPosition,
        passphrase: input.passphrase,
        settings: header.encryption,
        authenticatedHeader: headerBytes
      })
      await output.sync()
      return header
    }
  } catch (error) {
    await output.close().catch(() => undefined)
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await output.close().catch(() => undefined)
  }

  try {
    await pipeline(
      createReadStream(input.zipPath),
      createWriteStream(input.outputPath, { flags: 'a', mode: 0o600 })
    )
    return header
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function readRcodepackEnvelopeHeader(packagePath: string): Promise<ReadRcodepackEnvelopeResult> {
  const handle = await open(packagePath, 'r')
  try {
    const prefix = Buffer.allocUnsafe(RCODEPACK_PREFIX_BYTES)
    const prefixRead = await handle.read(prefix, 0, prefix.length, 0)
    if (prefixRead.bytesRead !== prefix.length || !prefix.subarray(0, RCODEPACK_MAGIC.length).equals(RCODEPACK_MAGIC)) {
      throw new Error('file is not a Rcodepack package')
    }
    const headerLength = prefix.readUInt32BE(RCODEPACK_MAGIC.length)
    if (headerLength < 2 || headerLength > RCODEPACK_MAX_HEADER_BYTES) {
      throw new Error('Rcodepack envelope header length is invalid')
    }
    const headerBytes = Buffer.allocUnsafe(headerLength)
    const headerRead = await handle.read(headerBytes, 0, headerLength, prefix.length)
    if (headerRead.bytesRead !== headerLength) throw new Error('Rcodepack envelope header is truncated')
    const header = DataMigrationEnvelopeHeaderV1Schema.parse(JSON.parse(headerBytes.toString('utf8')))
    return { header, headerBytes, payloadOffset: prefix.length + headerLength }
  } finally {
    await handle.close()
  }
}

export async function materializeRcodepackZip(input: {
  packagePath: string
  outputZipPath: string
  passphrase?: string
}): Promise<{ header: DataMigrationEnvelopeHeaderV1; framing?: RcodepackFramedEncryptionResult }> {
  const envelope = await readRcodepackEnvelopeHeader(input.packagePath)
  await mkdir(dirname(input.outputZipPath), { recursive: true, mode: 0o700 })
  let framing: RcodepackFramedEncryptionResult | undefined
  if (envelope.header.encryption.mode === 'passphrase') {
    if (!input.passphrase) throw new Error('Rcodepack passphrase is required')
    framing = await decryptRcodepackFramesToFile({
      packagePath: input.packagePath,
      payloadOffset: envelope.payloadOffset,
      outputPath: input.outputZipPath,
      passphrase: input.passphrase,
      settings: envelope.header.encryption,
      authenticatedHeader: envelope.headerBytes
    })
  } else {
    try {
      await pipeline(
        createReadStream(input.packagePath, { start: envelope.payloadOffset }),
        createWriteStream(input.outputZipPath, { flags: 'wx', mode: 0o600 })
      )
    } catch (error) {
      await rm(input.outputZipPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
  const details = await stat(input.outputZipPath)
  const digest = await sha256File(input.outputZipPath)
  if (details.size !== envelope.header.plainPayloadBytes || digest !== envelope.header.plainPayloadSha256) {
    await rm(input.outputZipPath, { force: true }).catch(() => undefined)
    throw new Error('Rcodepack payload integrity check failed')
  }
  return { header: envelope.header, ...(framing ? { framing } : {}) }
}

export async function verifyRcodepackPackage(input: {
  packagePath: string
  materializedZipPath: string
  passphrase?: string
  cleanupMaterialized?: boolean
}): Promise<{ header: DataMigrationEnvelopeHeaderV1; manifest: DataMigrationManifestV1; entries: DataMigrationPackageEntry[] }> {
  const { header } = await materializeRcodepackZip({
    packagePath: input.packagePath,
    outputZipPath: input.materializedZipPath,
    ...(input.passphrase ? { passphrase: input.passphrase } : {})
  })
  try {
    const manifestBytes = await readZip64EntryBuffer(
      input.materializedZipPath,
      RCODEPACK_MANIFEST_PATH,
      DATA_MIGRATION_MAX_METADATA_BYTES
    )
    const checksumsBytes = await readZip64EntryBuffer(
      input.materializedZipPath,
      RCODEPACK_CHECKSUMS_PATH,
      DATA_MIGRATION_MAX_METADATA_BYTES
    )
    const manifest = DataMigrationManifestV1Schema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (manifest.formatVersion !== header.formatVersion) throw new Error('Rcodepack envelope and manifest versions differ')
    if (canonicalEncryption(manifest.encryption) !== canonicalEncryption(header.encryption)) {
      throw new Error('Rcodepack envelope and manifest encryption settings differ')
    }
    if (sha256Buffer(checksumsBytes) !== manifest.checksumsSha256) {
      throw new Error('Rcodepack checksum catalog digest mismatch')
    }
    const entries = parseRcodepackChecksums(checksumsBytes)
    if (entries.length !== manifest.counts.entries) throw new Error('Rcodepack entry count differs from manifest')
    const expandedBytes = entries.reduce((total, entry) => total + entry.logicalBytes, 0)
    if (expandedBytes !== manifest.expandedBytes) throw new Error('Rcodepack expanded bytes differ from manifest')
    const catalogs = entries.filter((entry) => entry.kind === 'catalog')
    const catalogPrepared: PreparedZip64ArchiveEntry[] = []
    for (const catalog of catalogs) {
      const contents = await readZip64EntryBuffer(
        input.materializedZipPath,
        catalog.path,
        DATA_MIGRATION_MAX_METADATA_BYTES
      )
      catalogPrepared.push({
        path: catalog.path,
        kind: catalog.kind,
        ...(catalog.ownerId ? { ownerId: catalog.ownerId } : {}),
        source: { kind: 'buffer', data: contents },
        metadata: catalog
      })
    }
    if (digestRcodepackCatalogs(catalogPrepared) !== manifest.catalogsSha256) {
      throw new Error('Rcodepack catalog digest mismatch')
    }
    await verifyZip64ArchiveEntries(
      input.materializedZipPath,
      entries,
      new Set([RCODEPACK_MANIFEST_PATH, RCODEPACK_CHECKSUMS_PATH])
    )
    return { header, manifest, entries }
  } finally {
    if (input.cleanupMaterialized !== false) {
      await rm(input.materializedZipPath, { force: true }).catch(() => undefined)
    }
  }
}

function digestRcodepackCatalogs(entries: readonly PreparedZip64ArchiveEntry[]): string {
  const digest = createHash('sha256')
  for (const entry of entries
    .filter((candidate) => candidate.metadata.kind === 'catalog')
    .sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(entry.path)
    digest.update('\0')
    digest.update(entry.metadata.sha256)
    digest.update('\0')
    digest.update(String(entry.metadata.logicalBytes))
    digest.update('\n')
  }
  return digest.digest('hex')
}

function canonicalEncryption(encryption: DataMigrationEncryption): string {
  return serializeRcodepackJson(encryption).toString('utf8')
}

function sha256Buffer(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function publishWithoutOverwrite(temporaryPath: string, outputPath: string): Promise<void> {
  try {
    await link(temporaryPath, outputPath)
    await rm(temporaryPath, { force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM' && (error as NodeJS.ErrnoException).code !== 'ENOTSUP') {
      throw error
    }
    const reservation = await open(outputPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    await reservation.close()
    try {
      await rename(temporaryPath, outputPath)
    } catch (renameError) {
      await rm(outputPath, { force: true }).catch(() => undefined)
      throw renameError
    }
  }
}

export async function writeCanonicalRcodepackJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, serializeRcodepackJson(value), { mode: 0o600, flag: 'wx' })
}

export async function readCanonicalRcodepackJson(path: string): Promise<unknown> {
  const details = await stat(path)
  if (!details.isFile() || details.size > DATA_MIGRATION_MAX_METADATA_BYTES) {
    throw new Error('Rcodepack JSON metadata exceeds allowed size')
  }
  return JSON.parse(await readFile(path, 'utf8'))
}
