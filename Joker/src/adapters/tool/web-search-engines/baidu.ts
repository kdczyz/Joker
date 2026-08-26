import type { SearchEngineDef } from './types.js'
import { browserHeaders, dedupeByHost } from './duckduckgo.js'
import { attributeValue, decodeEntities, isHttpUrl, normalizeText } from './html-utils.js'

/**
 * Baidu web results (no API key). Best reachability inside mainland-China
 * networks. Hits are `<div class="result c-container">` blocks wrapping an
 * `<h3 class="t"><a>` link; target URLs often ride `baidu.com/link?url=`
 * redirects, which we keep as-is — resolving them would cost one request each.
 */
export const BAIDU_ENGINE: SearchEngineDef = {
  id: 'baidu',
  label: 'Baidu',
  requestUrl(query) {
    return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=20`
  },
  headers() {
    return {
      ...browserHeaders('https://www.baidu.com/'),
      'sec-fetch-site': 'same-origin'
    }
  },
  parse(html) {
    const drafts = []
    let cursor = 0
    while (drafts.length < 20) {
      const divIndex = html.indexOf('<div', cursor)
      if (divIndex < 0) break
      const tagEnd = html.indexOf('>', divIndex)
      if (tagEnd < 0) break
      const classAttr = attributeValue(html.slice(divIndex, tagEnd + 1), 'class') ?? ''
      const nextDiv = html.indexOf('<div', tagEnd)
      const blockEnd = nextDiv >= 0 ? nextDiv : html.length
      cursor = blockEnd
      // `result c-container` organic hits; skip ads (`ec_tuiguang`) and cards.
      if (!/(^|\s)result(\s|$)/.test(classAttr)) continue
      if (/ec_tuiguang|c-container-ad/.test(classAttr)) continue
      const draft = parseBaiduBlock(html.slice(divIndex, blockEnd))
      if (draft && isHttpUrl(draft.url)) drafts.push(draft)
    }
    return dedupeByHost(drafts)
  }
}

function parseBaiduBlock(block: string): { url: string; title: string; snippet: string } | undefined {
  const h3Index = block.indexOf('<h3')
  if (h3Index < 0) return undefined
  const anchorStart = block.indexOf('<a', h3Index)
  if (anchorStart < 0) return undefined
  const anchorTagEnd = block.indexOf('>', anchorStart)
  if (anchorTagEnd < 0) return undefined
  const href = attributeValue(block.slice(anchorStart, anchorTagEnd + 1), 'href')
  if (!href) return undefined
  const closeAnchor = block.toLowerCase().indexOf('</a>', anchorTagEnd)
  if (closeAnchor < 0) return undefined
  return {
    url: decodeEntities(href),
    title: normalizeText(block.slice(anchorTagEnd + 1, closeAnchor)),
    snippet: baiduSnippet(block, closeAnchor + 4)
  }
}

/** First non-empty content paragraph after the title acts as the snippet. */
function baiduSnippet(block: string, from: number): string {
  let cursor = from
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const spanIndex = block.indexOf('<span', cursor)
    if (spanIndex < 0) return ''
    const tagEnd = block.indexOf('>', spanIndex)
    if (tagEnd < 0) return ''
    const closeSpan = block.toLowerCase().indexOf('</span>', tagEnd)
    if (closeSpan < 0) return ''
    const text = normalizeText(block.slice(tagEnd + 1, closeSpan))
    if (text.length >= 12 && !/^展开|^收起/.test(text)) return text
    cursor = closeSpan + 7
  }
  return ''
}
