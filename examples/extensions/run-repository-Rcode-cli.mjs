#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..')
}

export function resolveRepositoryRcodeCli(moduleUrl = import.meta.url) {
  return resolve(resolveRepositoryRoot(moduleUrl), 'Rcode', 'dist', 'cli', 'serve-entry.js')
}

export function runRepositoryRcodeCli({
  args = process.argv.slice(2),
  cliPath = resolveRepositoryRcodeCli(),
  cwd = process.cwd(),
  exists = existsSync,
  spawn = spawnSync
} = {}) {
  if (args.length === 0) {
    throw new Error('Usage: run-repository-Rcode-cli.mjs <Rcode arguments...>')
  }
  if (!exists(cliPath)) {
    throw new Error(
      `Repository Rcode CLI is unavailable at ${cliPath}.\n` +
      'Run `npm run build:Rcode` from the repository root before using the example scripts.\n' +
      'For a standalone extension, use the Rcode CLI shipped with Rcode and install published ' +
      '@Rcode packages by name; do not install the unrelated npm package named `Rcode`.'
    )
  }

  const result = spawn(process.execPath, [cliPath, ...args], {
    cwd,
    env: process.env,
    shell: false,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

function isMainModule(moduleUrl, argvEntry) {
  return Boolean(argvEntry) && pathToFileURL(resolve(argvEntry)).href === moduleUrl
}

if (isMainModule(import.meta.url, process.argv[1])) {
  try {
    process.exitCode = runRepositoryRcodeCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
