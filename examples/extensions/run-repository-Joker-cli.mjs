#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function resolveRepositoryRoot(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..')
}

export function resolveRepositoryJokerCli(moduleUrl = import.meta.url) {
  return resolve(resolveRepositoryRoot(moduleUrl), 'Joker', 'dist', 'cli', 'serve-entry.js')
}

export function runRepositoryJokerCli({
  args = process.argv.slice(2),
  cliPath = resolveRepositoryJokerCli(),
  cwd = process.cwd(),
  exists = existsSync,
  spawn = spawnSync
} = {}) {
  if (args.length === 0) {
    throw new Error('Usage: run-repository-Joker-cli.mjs <Joker arguments...>')
  }
  if (!exists(cliPath)) {
    throw new Error(
      `Repository Joker CLI is unavailable at ${cliPath}.\n` +
      'Run `npm run build:Joker` from the repository root before using the example scripts.\n' +
      'For a standalone extension, use the Joker CLI shipped with Joker and install published ' +
      '@Joker packages by name; do not install the unrelated npm package named `Joker`.'
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
    process.exitCode = runRepositoryJokerCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
