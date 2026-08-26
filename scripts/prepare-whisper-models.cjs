#!/usr/bin/env node

/**
 * Vendor the bundled (built-in) Whisper models into resources/whisper/models so
 * the packaged app ships them and end users never have to download separately.
 *
 * The canonical model list of record lives in src/shared/local-whisper.ts
 * (entries with `bundled: true`). Keep the entries below in sync with it — this
 * script only knows about the `bundled` models so the installer stays lean.
 */

const { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, dirname, basename } = require('node:path')
const { createHash } = require('node:crypto')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const ROOT = require('path').resolve(__dirname, '..')
const MODELS_DIR = join(ROOT, 'resources', 'whisper', 'models')

const CONNECT_TIMEOUT_MS = 20_000
const STALL_TIMEOUT_MS = 30_000

// Source of truth: src/shared/local-whisper.ts — only `bundled: true` entries.
const BUNDLED_MODELS = [
  {
    id: 'whisper-small-q5_1',
    fileName: 'ggml-small-q5_1.bin',
    sizeBytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
    downloadUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    mirrors: [
      {
        id: 'hf-mirror',
        label: 'HF-Mirror',
        url: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
      },
      {
        id: 'hf-sufy',
        label: 'HF CDN',
        url: 'https://hf-cdn.sufy.com/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin'
      }
    ]
  }
]

function usage() {
  console.log(`Usage:
  node scripts/prepare-whisper-models.cjs [--model <id>] [--force]

Downloads every model flagged \`bundled: true\` in src/shared/local-whisper.ts
into resources/whisper/models/<id>/<file>. Skips models that are already present
with a matching checksum unless --force is given.
`)
}

function readArgs(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      flags.help = true
      continue
    }
    if (arg === '--force') {
      flags.force = true
      continue
    }
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    flags[arg.slice(2)] = value
    i += 1
  }
  return flags
}

function fileSha256(path) {
  const hash = createHash('sha256')
  const fd = require('node:fs').openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    let bytesRead
    while ((bytesRead = require('node:fs').readSync(fd, buffer, 0, buffer.length)) > 0) {
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    require('node:fs').closeSync(fd)
  }
  return hash.digest('hex')
}

async function fetchWithTimeout(url, signal) {
  const controller = new AbortController()
  const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'Joker local-whisper prepare', Range: 'bytes=0-' },
      signal: controller.signal
    })
  } finally {
    clearTimeout(connectTimer)
    if (signal) signal.addEventListener?.('abort', () => controller.abort(), { once: true })
  }
}

async function downloadModel(model, force) {
  const target = join(MODELS_DIR, model.id, model.fileName)
  if (existsSync(target) && !force) {
    const info = statSync(target)
    if (info.size === model.sizeBytes && fileSha256(target) === model.sha256) {
      console.log(`[prepare-whisper-models] Reusing existing ${target}`)
      return
    }
    console.log(`[prepare-whisper-models] Existing ${target} mismatched; re-downloading`)
  }
  mkdirSync(dirname(target), { recursive: true })
  const tempPath = `${target}.download`
  rmSync(tempPath, { force: true })

  const sources = [
    { id: 'huggingface', label: 'Hugging Face', url: model.downloadUrl },
    ...(model.mirrors ?? [])
  ]
  let lastError = null
  for (const source of sources) {
    try {
      console.log(`[prepare-whisper-models] Downloading ${model.id} from ${source.label} (${source.url})`)
      await downloadFile(source.url, tempPath, model)
      const info = statSync(tempPath)
      if (info.size !== model.sizeBytes) {
        throw new Error(`size mismatch: expected ${model.sizeBytes}, got ${info.size}`)
      }
      const actualSha = fileSha256(tempPath)
      if (actualSha !== model.sha256) {
        throw new Error(`checksum mismatch: expected ${model.sha256}, got ${actualSha}`)
      }
      renameSync(tempPath, target)
      console.log(`[prepare-whisper-models] Installed ${target}`)
      return
    } catch (error) {
      lastError = error
      console.warn(`[prepare-whisper-models] ${source.label} failed: ${error.message}`)
      rmSync(tempPath, { force: true })
    }
  }
  throw new Error(`failed to download ${model.id}: ${lastError?.message ?? 'unknown error'}`)
}

async function streamDownload(url, tempPath, model) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Joker local-whisper prepare' },
    signal: abortOnStall()
  })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  const total = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  if (total > 0 && total !== model.sizeBytes) {
    throw new Error(`content-length ${total} != expected ${model.sizeBytes}`)
  }
  await pipeline(Readable.fromWeb(response.body), writeFileStream(tempPath))
}

function hasCurl() {
  try {
    execFileSync('curl', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Prefer curl: it automatically honors HTTP_PROXY/HTTPS_PROXY, which Node's
 * global fetch ignores. Behind a corporate/campus proxy, curl is the only
 * path that reaches Hugging Face. Falls back to Node fetch otherwise.
 */
async function downloadFile(url, tempPath, model) {
  if (hasCurl()) {
    try {
      downloadWithCurl(url, tempPath)
      return
    } catch (error) {
      console.warn(`[prepare-whisper-models] curl failed (${error.message}); falling back to fetch`)
    }
  }
  await streamDownload(url, tempPath, model)
}

function downloadWithCurl(url, tempPath) {
  execFileSync(
    'curl',
    [
      '-L',
      '-f',
      '--connect-timeout',
      '30',
      '--max-time',
      '1200',
      '-o',
      tempPath,
      url
    ],
    { stdio: 'inherit' }
  )
}

function abortOnStall() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

function writeFileStream(path) {
  const { createWriteStream } = require('node:fs')
  return createWriteStream(path)
}

async function main() {
  const flags = readArgs(process.argv.slice(2))
  if (flags.help) {
    usage()
    return
  }
  const requested = flags.model
  const models = requested
    ? BUNDLED_MODELS.filter((m) => m.id === requested)
    : BUNDLED_MODELS
  if (requested && models.length === 0) {
    throw new Error(`Unknown bundled model: ${requested}`)
  }
  for (const model of models) {
    await downloadModel(model, flags.force)
  }
  console.log('[prepare-whisper-models] Done.')
}

try {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
