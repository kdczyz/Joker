import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildRcodeServeArgs,
  resolveRcodeExecutable,
  shouldRunRcodeServeAsElectronChild,
  type RcodeBinaryResolution
} from './resolve-Rcode-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'Rcode-resolver-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveRcodeExecutable', () => {
  it('resolves the built Rcode entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'Rcode/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveRcodeExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'Rcode/src/cli/serve-entry.ts'))

    const resolution = resolveRcodeExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'Rcode/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a Rcode package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveRcodeExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveRcodeExecutable('/app', '/usr/local/bin/Rcode')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/Rcode',
      args: [],
      dataDir: ''
    })
  })
})

describe('buildRcodeServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: RcodeBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/Rcode/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildRcodeServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/Rcode',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(args).not.toContain('--api-key')
    expect(args).not.toContain('--runtime-token')
    expect(args).not.toContain('--base-url')
    expect(args).not.toContain('--model-proxy-url')
    expect(args).not.toContain('--endpoint-format')
    expect(args).not.toContain('--model')
    expect(args).toContain('--token-economy-mode')
    expect(args).toContain('false')
  })
})

describe('shouldRunRcodeServeAsElectronChild', () => {
  it('uses the Electron child path only for macOS dev computer-use launches', () => {
    expect(shouldRunRcodeServeAsElectronChild({
      platform: 'darwin',
      isPackaged: false,
      computerUseEnabled: true
    })).toBe(true)

    expect(shouldRunRcodeServeAsElectronChild({
      platform: 'darwin',
      isPackaged: true,
      computerUseEnabled: true
    })).toBe(false)
  })

  it('keeps the regular Node helper path when computer-use is disabled or off macOS', () => {
    expect(shouldRunRcodeServeAsElectronChild({
      platform: 'darwin',
      isPackaged: false,
      computerUseEnabled: false
    })).toBe(false)

    expect(shouldRunRcodeServeAsElectronChild({
      platform: 'linux',
      isPackaged: false,
      computerUseEnabled: true
    })).toBe(false)
  })
})
