import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  describeRcodeStartupTimeout,
  RcodeRuntimeHealthMonitor,
  resolveRcodeStartupTimeoutMs,
  waitForRcodeStartup
} from './Rcode-runtime-health-monitor'

function fakeChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough()
  }) as unknown as ChildProcess
}

describe('Rcode runtime health monitor', () => {
  it('clamps configured startup timeouts and keeps platform defaults', () => {
    expect(resolveRcodeStartupTimeoutMs('linux', { RCODE_STARTUP_TIMEOUT_MS: '1000' })).toBe(15_000)
    expect(resolveRcodeStartupTimeoutMs('linux', { RCODE_STARTUP_TIMEOUT_MS: '120000' })).toBe(120_000)
    expect(resolveRcodeStartupTimeoutMs('win32', {})).toBe(90_000)
    expect(resolveRcodeStartupTimeoutMs('darwin', {})).toBe(60_000)
  })

  it('requires health when a port is present even after the ready marker', async () => {
    const process = fakeChild()
    const probeHealth = vi.fn(async () => false)
    const waiting = waitForRcodeStartup(process, 18899, {
      timeoutMs: 30,
      healthPollMs: 1,
      probeHealth
    })
    ;(process.stdout as PassThrough | null)?.write(
      'RCODE_READY {"service":"Rcode","mode":"serve","port":18899}\n'
    )

    await expect(waiting).rejects.toThrow('reported ready but did not pass health checks')
    expect(probeHealth).toHaveBeenCalled()
  })

  it('settles when the health endpoint succeeds', async () => {
    const process = fakeChild()
    await expect(waitForRcodeStartup(process, 18899, {
      timeoutMs: 100,
      healthPollMs: 1,
      probeHealth: async () => true
    })).resolves.toBeUndefined()
  })

  it('keeps timeout diagnostics stable', () => {
    expect(describeRcodeStartupTimeout(60_000, 'stderr', false)).toBe(
      'Rcode did not report ready within 60000ms\nstderr'
    )
  })

  it('single-flights concurrent post-start probes for one runtime endpoint', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchRuntime = vi.fn(async () => {
      await gate
      return new Response('{"status":"ok","service":"Rcode","mode":"serve"}', { status: 200 })
    })
    const monitor = new RcodeRuntimeHealthMonitor({
      runtimeBaseUrl: () => 'http://127.0.0.1:18899',
      runtimeHeaders: () => new Headers(),
      warn: vi.fn(),
      fetch: fetchRuntime
    })

    const first = monitor.probeOnce({})
    const second = monitor.probeOnce({})
    expect(second).toBe(first)
    release()
    await expect(first).resolves.toEqual({ healthy: true, error: '' })
    expect(fetchRuntime).toHaveBeenCalledOnce()
  })

  it('uses the same monitor for bounded watchdog health waits', async () => {
    const warn = vi.fn()
    const monitor = new RcodeRuntimeHealthMonitor({
      runtimeBaseUrl: () => 'http://127.0.0.1:18899',
      runtimeHeaders: () => new Headers({ authorization: 'Bearer token' }),
      warn,
      fetch: vi.fn(async () => new Response(
        '{"status":"ok","service":"Rcode","mode":"serve"}',
        { status: 200 }
      ))
    })

    await expect(monitor.waitForHealthy({}, 1_000)).resolves.toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })
})
