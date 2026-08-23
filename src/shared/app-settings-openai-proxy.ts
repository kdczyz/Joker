import {
  MIN_RCODE_LOCAL_PORT,
  type OpenAiProxySettingsPatchV1,
  type OpenAiProxySettingsV1
} from './app-settings-types'
import { ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID } from './model-provider-presets'
import { normalizeBoolean, normalizePositiveInteger } from './app-settings-normalizers'

function asTrimmed(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

export function defaultOpenAiProxySettings(): OpenAiProxySettingsV1 {
  return {
    enabled: false,
    port: 18899,
    token: '',
    providerId: ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID
  }
}

export function normalizeOpenAiProxySettings(
  input: OpenAiProxySettingsPatchV1 | undefined
): OpenAiProxySettingsV1 {
  const defaults = defaultOpenAiProxySettings()
  const source = input ?? {}
  const port = normalizePositiveInteger(source.port, defaults.port, MIN_RCODE_LOCAL_PORT, 65_535)
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    // Avoid colliding with common local ports by forcing a sane ceiling.
    port: port === 0 ? defaults.port : port,
    token: asTrimmed(source.token),
    providerId: asTrimmed(source.providerId) || defaults.providerId
  }
}

export function mergeOpenAiProxySettings(
  current: OpenAiProxySettingsV1,
  patch: OpenAiProxySettingsPatchV1 | undefined
): OpenAiProxySettingsV1 {
  if (!patch) return normalizeOpenAiProxySettings(current)
  return normalizeOpenAiProxySettings({ ...current, ...patch })
}
