const { existsSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const REQUIRED_PATHS = [
  'Joker/package-lock.json',
  'Joker/node_modules/diff/package.json',
  'Joker/node_modules/semver/package.json',
  'Joker/node_modules/yauzl/package.json',
  'Joker/node_modules/yazl/package.json',
  'Joker/node_modules/zod/package.json',
  'Joker/node_modules/@modelcontextprotocol/sdk/package.json',
  'Joker/node_modules/@joker-code/extension-api/package.json',
  'Joker/node_modules/create-Joker-extension/package.json'
]
const JOKER_SQLITE_MODULE_PATH = 'Joker/node_modules/better-sqlite3'

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    }
  })
}

function ensureJokerInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path))) {
    const installJoker = run('npm', ['--prefix', 'Joker', 'ci'])
    if (installJoker.status !== 0) {
      process.exit(installJoker.status || 1)
    }
  }

  if (existsSync(JOKER_SQLITE_MODULE_PATH)) {
    rmSync(JOKER_SQLITE_MODULE_PATH, { recursive: true, force: true })
    return
  }
}

ensureJokerInstall()
