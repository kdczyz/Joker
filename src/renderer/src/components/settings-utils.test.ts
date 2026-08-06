import { describe, expect, it } from 'vitest'
import type { AppSettingsV1, RcodeRuntimeSettingsV1 } from '@shared/app-settings'
import { coerceRendererSettings, diffSettingsPatch, mergeSettings } from './settings-utils'

function settings(RcodePatch: Partial<RcodeRuntimeSettingsV1> = {}): AppSettingsV1 {
  return coerceRendererSettings({
    agents: {
      Rcode: RcodePatch
    }
  } as unknown as AppSettingsV1)
}

describe('diffSettingsPatch', () => {
  it('omits an unchanged blank runtime token when another setting changes', () => {
    const base = settings({ runtimeToken: '' })
    const next: AppSettingsV1 = {
      ...base,
      theme: 'dark'
    }

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({ theme: 'dark' })
    expect(patch.agents).toBeUndefined()
  })

  it('preserves an explicit runtime token clear', () => {
    const base = settings({ runtimeToken: 'generated-token' })
    const next: AppSettingsV1 = {
      ...base,
      agents: {
        Rcode: {
          ...base.agents.Rcode,
          runtimeToken: ''
        }
      }
    }

    expect(diffSettingsPatch(base, next)).toEqual({
      agents: {
        Rcode: {
          runtimeToken: ''
        }
      }
    })
  })

  it('diffs nested provider fields without sending the full settings snapshot', () => {
    const base = settings()
    const next: AppSettingsV1 = {
      ...base,
      provider: {
        ...base.provider,
        apiKey: 'sk-next'
      }
    }

    expect(diffSettingsPatch(base, next)).toEqual({
      provider: {
        apiKey: 'sk-next'
      }
    })
  })

  it('preserves provider proxy siblings when applying a partial diff patch', () => {
    const base: AppSettingsV1 = {
      ...settings(),
      provider: {
        ...settings().provider,
        proxy: {
          enabled: true,
          url: 'http://127.0.0.1:7890'
        }
      }
    }
    const next: AppSettingsV1 = {
      ...base,
      provider: {
        ...base.provider,
        proxy: {
          ...base.provider.proxy,
          url: 'http://127.0.0.1:9999'
        }
      }
    }

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      provider: {
        proxy: {
          url: 'http://127.0.0.1:9999'
        }
      }
    })
    expect(mergeSettings(base, patch).provider.proxy).toEqual({
      enabled: true,
      url: 'http://127.0.0.1:9999'
    })
  })

  it('round-trips a profiles-only subagent diff without losing sibling settings', () => {
    const base = coerceRendererSettings(settings({
      subagents: {
        enabled: true,
        maxParallel: 3,
        maxChildRuns: 12,
        defaultToolPolicy: 'inherit',
        defaultProfile: 'researcher',
        profiles: [{
          id: 'researcher',
          enabled: true,
          name: 'Researcher',
          mode: 'subagent',
          toolPolicy: 'readOnly'
        }]
      }
    }))
    const replacement = {
      id: 'reviewer',
      enabled: true,
      name: 'Reviewer',
      mode: 'subagent' as const,
      toolPolicy: 'readOnly' as const,
      blockedSkills: ['unsafe-skill']
    }
    const next = mergeSettings(base, {
      agents: { Rcode: { subagents: { profiles: [replacement] } } }
    })

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      agents: { Rcode: { subagents: { profiles: [replacement] } } }
    })
    expect(mergeSettings(base, patch).agents.Rcode.subagents).toEqual({
      enabled: true,
      maxParallel: 3,
      maxChildRuns: 12,
      defaultToolPolicy: 'inherit',
      defaultProfile: 'researcher',
      profiles: [replacement]
    })
  })

  it('emits explicit clear sentinels for normalized-away model and reasoning overrides', () => {
    const base = coerceRendererSettings(settings({
      smallModel: 'small-model',
      smallModelProviderId: 'provider-a',
      titleModel: 'title-model',
      titleProviderId: 'provider-a',
      summaryModel: 'summary-model',
      summaryProviderId: 'provider-a',
      codeReviewModel: 'review-model',
      codeReviewProviderId: 'provider-a',
      titleReasoningEffort: 'low',
      summaryReasoningEffort: 'medium',
      codeReviewReasoningEffort: 'high',
      contextCompaction: {
        ...settings().agents.Rcode.contextCompaction,
        summaryModel: 'compaction-model',
        summaryProviderId: 'provider-a'
      }
    }))
    const next = mergeSettings(base, {
      agents: {
        Rcode: {
          smallModel: '',
          smallModelProviderId: '',
          titleModel: '',
          titleProviderId: '',
          summaryModel: '',
          summaryProviderId: '',
          codeReviewModel: '',
          codeReviewProviderId: '',
          titleReasoningEffort: 'off',
          summaryReasoningEffort: 'off',
          codeReviewReasoningEffort: 'off',
          contextCompaction: {
            summaryModel: '',
            summaryProviderId: ''
          }
        }
      }
    })

    const patch = diffSettingsPatch(base, next)

    expect(patch).toEqual({
      agents: {
        Rcode: {
          smallModel: '',
          smallModelProviderId: '',
          titleModel: '',
          titleProviderId: '',
          summaryModel: '',
          summaryProviderId: '',
          codeReviewModel: '',
          codeReviewProviderId: '',
          titleReasoningEffort: 'off',
          summaryReasoningEffort: 'off',
          codeReviewReasoningEffort: 'off',
          contextCompaction: {
            summaryModel: '',
            summaryProviderId: ''
          }
        }
      }
    })
    const roundTripped = mergeSettings(base, patch).agents.Rcode
    expect(roundTripped.smallModel).toBeUndefined()
    expect(roundTripped.titleModel).toBeUndefined()
    expect(roundTripped.summaryModel).toBeUndefined()
    expect(roundTripped.codeReviewModel).toBeUndefined()
    expect(roundTripped.titleReasoningEffort).toBeUndefined()
    expect(roundTripped.summaryReasoningEffort).toBeUndefined()
    expect(roundTripped.codeReviewReasoningEffort).toBeUndefined()
    expect(roundTripped.contextCompaction.summaryModel).toBeUndefined()
    expect(roundTripped.contextCompaction.summaryProviderId).toBeUndefined()
  })
})
