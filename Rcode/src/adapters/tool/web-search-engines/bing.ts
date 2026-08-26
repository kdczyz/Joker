import type { SearchEngineDef } from './types.js'
import { browserHeaders, dedupeByHost } from './duckduckgo.js'
import { attributeValue, decodeEntities, isHttpUrl, normalizeText, stripTags } from './html-utils.js'

/**
 * Bing web results (no API key). Organic hits are `<li class="b_algo">`
 * blocks whose first `<h2><a>` is the result link.
 */
export const BING_ENGINE: SearchEngineDef = {
  id: 'bing',
  label: 'Bing',
  requestUrl(query) {
    return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20&setlang=en-us`
  },
  headers() {
    return {
      ...browserHeaders('https://www.bing.com/'),
      'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      'sec-fetch-site': 'same-origin'
    }
  },
  parse(html) {
    const drafts = []
    let cursor = 0
    while (drafts.length < 20) {
      const liIndex = html.indexOf('<li', cursor)
      if (liIndex < 0) break
      const classAttr = attributeValue(html.slice(liIndex, html.indexOf('>', liIndex) + 1), 'class') ?? ''
      cursor = html.indexOf('</li>', liIndex)
      if (cursor < 0) break
      cursor += 5
      if (!classAttr.split(/\s+/).includes('b_algo')) continue
      const blockEnd = cursor
      const block = html.slice(liIndex, blockEnd)
      const draft = parseBingBlock(block)
      if (draft && isHttpUrl(draft.url)) drafts.push(draft)
    }
    return dedupeByHost(drafts)
  }
}

function parseBingBlock(block: string): { url: string; title: string; snippet: string } | undefined {
  const h2Index = block.indexOf('<h2')
  if (h2Index < 0) return undefined
  const anchorStart = block.indexOf('<a', h2Index)
  if (anchorStart < 0) return undefined
  const anchorTagEnd = block.indexOf('>', anchorStart)
  if (anchorTagEnd < 0) return undefined
  const href = attributeValue(block.slice(anchorStart, anchorTagEnd + 1), 'href')
  if (!href) return undefined
  const closeAnchor = block.toLowerCase().indexOf('</a>', anchorTagEnd)
  if (closeAnchor < 0) return undefined
  const title = normalizeText(block.slice(anchorTagEnd + 1, closeAnchor))
  return {
    url: decodeEntities(href),
    title,
    snippet: extractBingSnippet(block, closeAnchor + 4)
  }
}

/** Snippets follow in `<p class="b_lineclamp...">` paragraphs. */
function extractBingSnippet(block: string, from: number): string {
  let cursor = from
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pIndex = block.indexOf('<p', cursor)
    if (pIndex < 0) return ''
    const tagEnd = block.indexOf('>', pIndex)
    if (tagEnd < 0) return ''
    const classAttr = attributeValue(block.slice(pIndex, tagEnd + 1), 'class') ?? ''
    const closeP = block.toLowerCase().indexOf('</p>', tagEnd)
    if (closeP < 0) return ''
    const text = stripTags(decodeEntities(block.slice(tagEnd + 1, closeP))).replace(/\s+/g, ' ').trim()
    if (text) return text
    cursor = closeP + 4
  }
  return ''
}
