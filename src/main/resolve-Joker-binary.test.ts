import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildJokerServeArgs,
  resolveJokerExecutable,
  shouldRunJokerServeAsElectronChild,
  type JokerBinaryResolution
} from './resolve-Joker-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'Joker-resolver-'))
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

describe('resolveJokerExecutable', () => {
  it('resolves the built Joker entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'Joker/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveJokerExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'Joker/src/cli/serve-entry.ts'))

    const resolution = resolveJokerExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'Joker/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a Joker package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveJokerExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveJokerExecutable('/app', '/usr/local/bin/Joker')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/Joker',
      args: [],
      dataDir: ''
    })
  })
})

describe('buildJokerServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: JokerBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/Joker/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildJokerServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 18899,
      dataDir: '/tmp/Joker',
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

describe('shouldRunJokerServeAsElectronChild', () => {
  it('uses the Electron child path only for macOS dev computer-use launches', () => {
    expect(shouldRunJokerServeAsElectronChild({
      platform: 'darwin',
      isPackaged: false,
      computerUseEnabled: true
    })).toBe(true)

    expect(shouldRunJokerServeAsElectronChild({
      platform: 'darwin',
      isPackaged: true,
      computerUseEnabled: true
    })).toBe(false)
  })

  it('keeps the regular Node helper path when computer-use is disabled or off macOS', () => {
    expect(shouldRunJokerServeAsElectronChild({
      platform: 'darwin',
      isPackaged: false,
      computerUseEnabled: false
    })).toBe(false)

    expect(shouldRunJokerServeAsElectronChild({
      platform: 'linux',
      isPackaged: false,
      computerUseEnabled: true
    })).toBe(false)
  })
})
