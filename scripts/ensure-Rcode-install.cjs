const { existsSync, rmSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const REQUIRED_PATHS = [
  'Rcode/package-lock.json',
  'Rcode/node_modules/diff/package.json',
  'Rcode/node_modules/semver/package.json',
  'Rcode/node_modules/yauzl/package.json',
  'Rcode/node_modules/yazl/package.json',
  'Rcode/node_modules/zod/package.json',
  'Rcode/node_modules/@modelcontextprotocol/sdk/package.json',
  'Rcode/node_modules/@Rcode/extension-api/package.json',
  'Rcode/node_modules/create-Rcode-extension/package.json'
]
const RCODE_SQLITE_MODULE_PATH = 'Rcode/node_modules/better-sqlite3'

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

function ensureRcodeInstall() {
  if (!REQUIRED_PATHS.every((path) => existsSync(path))) {
    const installRcode = run('npm', ['--prefix', 'Rcode', 'ci'])
    if (installRcode.status !== 0) {
      process.exit(installRcode.status || 1)
    }
  }

  if (existsSync(RCODE_SQLITE_MODULE_PATH)) {
    rmSync(RCODE_SQLITE_MODULE_PATH, { recursive: true, force: true })
    return
  }
}

ensureRcodeInstall()
