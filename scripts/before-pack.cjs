const { execFileSync } = require('node:child_process')
const { existsSync, statSync, readdirSync } = require('node:fs')
const { join } = require('node:path')

const WHISPER_RESOURCES_DIR = join(__dirname, '..', 'resources', 'whisper')

function normalizePlatform(platform) {
  if (platform === 'mac') return 'darwin'
  if (platform === 'win') return 'win32'
  return platform
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[before-pack] Unsupported Whisper runner arch: ${arch}`)
}

// ---------------------------------------------------------------------------
// Stale-build guard
//
// electron-vite dev mode serves the renderer from an in-memory Vite server and
// never writes out/renderer to disk, while electron-builder blindly zips up
// whatever is already in out/. If someone packages via a sub-script (e.g.
// `npm run dist:mac:arm64:dmg`) without first running `npm run build`, the dmg
// ships a STALE renderer/main/preload. This check fails the packaging fast
// instead of silently producing an outdated app.
// ---------------------------------------------------------------------------
const BUILD_FRESHNESS_PAIRS = [
  {
    output: join(__dirname, '..', 'out', 'renderer', 'index.html'),
    source: join(__dirname, '..', 'src', 'renderer', 'src'),
    label: 'renderer'
  },
  {
    output: join(__dirname, '..', 'out', 'main', 'index.js'),
    source: join(__dirname, '..', 'src', 'main'),
    label: 'main'
  },
  {
    // electron-vite preload config uses entryFileNames: '[name].cjs', so the
    // emitted file is index.cjs (not index.js). Adjust if that config changes.
    output: join(__dirname, '..', 'out', 'preload', 'index.cjs'),
    source: join(__dirname, '..', 'src', 'preload'),
    label: 'preload'
  },
  {
    output: join(__dirname, '..', 'Joker', 'dist', 'cli', 'serve-entry.js'),
    source: join(__dirname, '..', 'Joker', 'src'),
    label: 'Joker runtime'
  }
]

// Recursively find files newer than `threshold` using pure Node.js
// (cross-platform: works on macOS, Linux, and Windows).
function findNewerFiles(dir, threshold, ignoreDirs) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue
      results.push(...findNewerFiles(fullPath, threshold, ignoreDirs))
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath)
        if (stat.mtimeMs > threshold) results.push(fullPath)
      } catch {
        // skip unreadable files
      }
    }
  }
  return results
}

const IGNORE_DIRS = new Set(['node_modules', '.git', '.DS_Store'])

function assertBuildFreshness() {
  for (const { output, source, label } of BUILD_FRESHNESS_PAIRS) {
    if (!existsSync(output)) {
      throw new Error(
        `[before-pack] Stale build: ${label} output is missing (${output}).\n` +
        'Packaging would ship outdated code. Run `npm run build`, or simply use\n' +
        '`npm run dist:mac:arm64` (it builds before packaging).'
      )
    }
    if (!existsSync(source)) continue
    const outputMtime = statSync(output).mtimeMs
    const staleFiles = findNewerFiles(source, outputMtime, IGNORE_DIRS)
    if (staleFiles.length > 0) {
      throw new Error(
        `[before-pack] Stale build: ${label} output (${output}) is older than source in\n` +
        `${source} (${staleFiles.length} newer file(s), e.g. ${staleFiles[0]}).\n` +
        'Packaging would ship outdated code. Run `npm run build`, or simply use\n' +
        '`npm run dist:mac:arm64` (it builds before packaging).'
      )
    }
  }
}

async function beforePack(context) {
  assertBuildFreshness()
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  if (process.env.JOKER_SKIP_WHISPER_RUNNER === '1') {
    console.warn(`[before-pack] Skipping bundled Whisper runner for ${platform}-${arch}.`)
    return
  }
  execFileSync(
    process.execPath,
    [
      join(__dirname, 'prepare-whisper-runner.cjs'),
      '--platform',
      platform,
      '--arch',
      arch
    ],
    {
      cwd: join(__dirname, '..'),
      stdio: 'inherit'
    }
  )
}

exports._internals = {
  normalizePlatform,
  normalizeArch
}
exports.default = beforePack
