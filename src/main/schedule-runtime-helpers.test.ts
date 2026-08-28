import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { resolveScheduleModelConfig, runPromptViaRuntime } from './schedule-runtime-helpers'

describe('runPromptViaRuntime workspace validation', () => {
  it('rejects a missing custom workspace without creating it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'Joker-schedule-workspace-'))
    const workspaceRoot = join(parent, 'missing-project')
    const runtimeRequest = vi.fn()
    try {
      const result = await runPromptViaRuntime(
        { runtimeRequest },
        { agents: { Joker: { model: 'test-model' } } } as AppSettingsV1,
        {
          prompt: 'test',
          title: 'test',
          workspaceRoot,
          model: 'test-model',
          reasoningEffort: '',
          mode: 'agent',
          waitForResult: false,
          responseTimeoutMs: 1_000
        }
      )

      expect(result).toEqual({
        ok: false,
        message: `Workspace directory is unavailable: ${workspaceRoot}`
      })
      expect(runtimeRequest).not.toHaveBeenCalled()
      await expect(stat(workspaceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

describe('resolveScheduleModelConfig', () => {
  // 回归:免费 provider(opencode-zen)是内置预设,不一定出现在用户配置的
  // provider 列表里。解析不到时任务会被静默改路由到 providers[0](例如
  // NVIDIA),用错误的模型发请求,上游返回 404 "Function ... Not found"。
  it('resolves the builtin free provider even when it is not in the user provider list', () => {
    const settings = {
      provider: {
        providers: [{
          id: 'custom-provider-2',
          name: 'NVIDIA',
          apiKey: '',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          endpointFormat: 'chat_completions',
          models: ['01-ai/yi-large']
        }]
      },
      agents: { Joker: { providerId: 'opencode-zen' } }
    } as unknown as AppSettingsV1

    const config = resolveScheduleModelConfig(settings, {
      providerId: 'opencode-zen',
      model: 'hy3-free',
      reasoningEffort: 'medium'
    })

    expect(config.providerId).toBe('opencode-zen')
    expect(config.model).toBe('hy3-free')
  })

  it('still falls back to the first provider model for unknown providers', () => {
    const settings = {
      provider: {
        providers: [{
          id: 'custom-provider-2',
          name: 'NVIDIA',
          apiKey: '',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          endpointFormat: 'chat_completions',
          models: ['01-ai/yi-large']
        }]
      },
      agents: { Joker: {} }
    } as unknown as AppSettingsV1

    const config = resolveScheduleModelConfig(settings, {
      providerId: '',
      model: '',
      reasoningEffort: 'medium'
    })

    expect(config.providerId).toBe('custom-provider-2')
    expect(config.model).toBe('01-ai/yi-large')
  })
})
