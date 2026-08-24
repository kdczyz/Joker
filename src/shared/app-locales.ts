export const APP_LOCALES = ['en', 'zh', 'ru', 'hi', 'th', 'ja', 'ko'] as const
export const LOCALE_SYSTEM = 'system'

export type AppLocale = (typeof APP_LOCALES)[number] | typeof LOCALE_SYSTEM

export const APP_LOCALE_OPTIONS: readonly {
  value: AppLocale
  label: string
  documentLanguage: string
}[] = [
  { value: 'system', label: '跟随系统', documentLanguage: '' },
  { value: 'en', label: 'English', documentLanguage: 'en' },
  { value: 'zh', label: '简体中文', documentLanguage: 'zh-CN' },
  { value: 'ru', label: 'Русский', documentLanguage: 'ru' },
  { value: 'hi', label: 'हिन्दी', documentLanguage: 'hi' },
  { value: 'th', label: 'ไทย', documentLanguage: 'th' },
  { value: 'ja', label: '日本語', documentLanguage: 'ja' },
  { value: 'ko', label: '한국어', documentLanguage: 'ko' }
]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (value === LOCALE_SYSTEM || (APP_LOCALES as readonly string[]).includes(value as AppLocale))
}

export function resolveAppLocale(locale: AppLocale, systemLocale?: string): AppLocale {
  if (locale !== LOCALE_SYSTEM) return locale
  if (!systemLocale) return 'en'
  const normalized = systemLocale.toLowerCase().split('-')[0]
  if ((APP_LOCALES as readonly string[]).includes(normalized as AppLocale)) {
    return normalized as AppLocale
  }
  return 'en'
}

export function documentLanguageForAppLocale(locale: AppLocale): string {
  return APP_LOCALE_OPTIONS.find((option) => option.value === locale)?.documentLanguage ?? 'en'
}
