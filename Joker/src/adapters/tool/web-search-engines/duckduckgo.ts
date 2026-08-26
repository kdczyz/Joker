import type { SearchEngineDef } from './types.js'
import { findAnchor, isHttpUrl, normalizeText } from './html-utils.js'

/** Shared browser-like UA; search endpoints reject headerless clients. */
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * Full Chrome header fingerprint. Missing client-hint and sec-fetch headers
 * are the cheapest bot signal after the UA itself, so we send the whole set.
 * Engines layer their own referer/accept-language on top.
 */
export function browserHeaders(origin: string): Record<string, string> {
  return {
    'user-agent': BROWSER_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    referer: origin
  }
}

/**
 * DuckDuckGo HTML endpoint (no API key). Results live in `.result__a`
 * anchors; `uddg=` redirect params wrap the real target URLs.
 */
export const DUCKDUCKGO_ENGINE: SearchEngineDef = {
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  requestUrl(query) {
    return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`
  },
  headers() {
    return browserHeaders('https://duckduckgo.com/')
  },
  parse(html) {
    const drafts = []
    let cursor = 0
    while (drafts.length < 20) {
      const anchor = findAnchor(html, cursor)
      if (!anchor) break
      cursor = anchor.endIndex
      if (!anchor.text || !anchor.href.includes('duckduckgo.com')) continue
      const url = unwrapDdgHref(anchor.href)
      if (!url || !isHttpUrl(url)) continue
      drafts.push({ url, title: anchor.text, snippet: findSnippetAfter(html, cursor) })
    }
    return dedupeByHost(drafts)
  }
}

function unwrapDdgHref(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://duckduckgo.com')
    const target = url.searchParams.get('uddg')
    if (target) return target
    return url.hostname.endsWith('duckduckgo.com') ? undefined : url.href
  } catch {
    return undefined
  }
}

/** Snippets sit in a sibling `.result__snippet` block after each result link. */
function findSnippetAfter(html: string, from: number): string {
  // Bound by the next *result* anchor, not any `<a>`: the snippet itself
  // is also an anchor element.
  const nextResult = html.indexOf('result__a', from)
  const classIndex = html.indexOf('result__snippet', from)
  if (classIndex < 0 || (nextResult >= 0 && classIndex > nextResult)) return ''
  const textStart = html.indexOf('>', classIndex)
  if (textStart < 0) return ''
  const closeTag = html.toLowerCase().indexOf('</a>', textStart)
  if (closeTag < 0) return ''
  return normalizeText(html.slice(textStart + 1, closeTag))
}

/** Cross-engine noise control: at most two results from the same host. */
export function dedupeByHost<T extends { url: string }>(drafts: T[]): T[] {
  const hostCounts = new Map<string, number>()
  const kept: T[] = []
  for (const draft of drafts) {
    let host = ''
    try {
      host = new URL(draft.url).hostname
    } catch {
      continue
    }
    const count = hostCounts.get(host) ?? 0
    if (count >= 2) continue
    hostCounts.set(host, count + 1)
    kept.push(draft)
  }
  return kept
}
