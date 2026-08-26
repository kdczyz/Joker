/**
 * Minimal HTML helpers shared by the keyless search engines.
 *
 * These operate on raw HTML strings on purpose: the search result pages are
 * scraped server responses, and pulling a DOM dependency into the agent core
 * is not worth it for the handful of shapes we need to walk.
 */

/** Decode the handful of entities search pages actually emit inside anchors. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function safeCodePoint(codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint === 60 || codePoint === 62 || codePoint > 0x10ffff) {
    return '\uFFFD'
  }
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return '\uFFFD'
  }
}

export function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

export function normalizeText(value: string): string {
  return stripTags(decodeEntities(value)).replace(/\s+/g, ' ').trim()
}

/** Extract one attribute from a full opening-tag slice like `<a href="...">`. */
export function attributeValue(tagSlice: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = pattern.exec(tagSlice)
  if (!match) return undefined
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim()
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * Locate the first `<a ...>...</a>` at or after `from`. Returns the href,
 * the normalized inner text, and the offset just past `</a>`.
 */
export function findAnchor(html: string, from: number): {
  href: string
  text: string
  endIndex: number
} | undefined {
  const tagStart = html.indexOf('<a', from)
  if (tagStart < 0) return undefined
  const tagEnd = html.indexOf('>', tagStart)
  if (tagEnd < 0) return undefined
  const href = attributeValue(html.slice(tagStart, tagEnd + 1), 'href')
  const closeTag = html.toLowerCase().indexOf('</a>', tagEnd)
  if (!href || closeTag < 0) return undefined
  return {
    href,
    text: normalizeText(html.slice(tagEnd + 1, closeTag)),
    endIndex: closeTag + 4
  }
}
