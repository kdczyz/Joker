import { describe, expect, it } from 'vitest'
import { DUCKDUCKGO_ENGINE, dedupeByHost } from '../src/adapters/tool/web-search-engines/duckduckgo.js'
import { BING_ENGINE } from '../src/adapters/tool/web-search-engines/bing.js'
import { BAIDU_ENGINE } from '../src/adapters/tool/web-search-engines/baidu.js'
import { KeylessSearchExecutor } from '../src/adapters/tool/web-search-engines/keyless-executor.js'
import { resolveSearchEngineChain } from '../src/adapters/tool/web-search-engines/index.js'
import type { SearchEngineContext } from '../src/adapters/tool/web-search-engines/types.js'

const DDG_FIXTURE = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Fguide&amp;rut=abc">
      Example <b>Guide</b>
    </a>
  </h2>
  <a class="result__snippet" href="#">How the example guide works &amp; why.</a>
</div>
<div class="result">
  <h2 class="result__title">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Fapi">API Reference</a>
  </h2>
  <a class="result__snippet" href="#">Endpoints and parameters.</a>
</div>
`

const BING_FIXTURE = `
<ol id="b_results">
<li class="b_algo"><h2><a href="https://one.example.test/a">One Result</a></h2>
<p class="b_lineclamp4">First snippet text.</p></li>
<li class="b_algo b_vtl"><h2><a href="https://two.example.test/b">Two &amp; More</a></h2>
<p class="b_lineclamp4">Second snippet &lt;em&gt;safe&lt;/em&gt; text.</p></li>
<li class="b_algo"><h2><a href="/relative/never">Relative Link</a></h2><p>x</p></li>
</ol>
`

const BAIDU_FIXTURE = `
<div class="result c-container new-pmd" srcid="1599">
<h3 class="t"><a href="http://www.baidu.com/link?url=abc123">中文结果一</a></h3>
<span class="content-right_8Zs40">这是第一个结果的摘要内容，足够长。</span>
</div>
<div class="result c-container ec_tuiguang">
<h3 class="t"><a href="https://ad.example.test/">广告</a></h3><span>广告摘要内容超过十二个字符。</span>
</div>
<div class="result c-container">
<h3 class="t"><a href="https://two.example.test/cn">Result Two</a></h3>
<span class="c-abstract">第二个结果摘要。</span>
</div>
`

function contextFor(
  pages: Record<string, string> | ((url: string) => string),
  failures: Record<string, Error> = {}
): SearchEngineContext {
  return {
    requestDocument: async (request) => {
      const failure = failures[request.url]
      if (failure) throw failure
      const body = typeof pages === 'function' ? pages(request.url) : pages[request.url]
      if (body === undefined) throw new Error(`unexpected url: ${request.url}`)
      const bytes = Buffer.from(body, 'utf8')
      return {
        finalUrl: request.url,
        chunks: [new Uint8Array(bytes)],
        totalBytes: bytes.length,
        truncated: false
      }
    },
    nowIso: () => '2026-06-03T00:00:00.000Z'
  }
}

describe('engine parsers', () => {
  it('parses DuckDuckGo uddg links and snippets', () => {
    const drafts = DUCKDUCKGO_ENGINE.parse(DDG_FIXTURE)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({
      url: 'https://docs.example.test/guide',
      title: 'Example Guide'
    })
    expect(drafts[0]!.snippet).toContain('How the example guide works & why.')
  })

  it('parses Bing b_algo blocks and drops relative hrefs', () => {
    const drafts = BING_ENGINE.parse(BING_FIXTURE)
    expect(drafts.map((draft) => draft.url)).toEqual(['https://one.example.test/a', 'https://two.example.test/b'])
    expect(drafts[1]!.title).toBe('Two & More')
    expect(drafts[1]!.snippet).toBe('Second snippet safe text.')
  })

  it('parses Baidu result blocks and skips ads', () => {
    const drafts = BAIDU_ENGINE.parse(BAIDU_FIXTURE)
    expect(drafts.map((draft) => draft.title)).toEqual(['中文结果一', 'Result Two'])
    expect(drafts[0]!.url).toBe('http://www.baidu.com/link?url=abc123')
  })

  it('caps two results per host', () => {
    const drafts = [
      { url: 'https://x.test/1' },
      { url: 'https://x.test/2' },
      { url: 'https://x.test/3' },
      { url: 'https://y.test/4' }
    ]
    expect(dedupeByHost(drafts).map((draft) => draft.url)).toEqual(['https://x.test/1', 'https://x.test/2', 'https://y.test/4'])
  })
})

describe('resolveSearchEngineChain', () => {
  it('defaults to the auto chain', () => {
    expect(resolveSearchEngineChain(undefined).map((engine) => engine.id)).toEqual(['duckduckgo', 'bing', 'baidu'])
  })

  it('honors comma-separated overrides and ignores unknown names', () => {
    expect(resolveSearchEngineChain('baidu, nope ,bing').map((engine) => engine.id)).toEqual(['baidu', 'bing'])
    expect(resolveSearchEngineChain('nope').map((engine) => engine.id)).toEqual(['duckduckgo', 'bing', 'baidu'])
  })
})

describe('KeylessSearchExecutor', () => {
  const ddgUrl = DUCKDUCKGO_ENGINE.requestUrl('joker')
  const bingUrl = BING_ENGINE.requestUrl('joker')

  it('returns results from the first healthy engine', async () => {
    const executor = new KeylessSearchExecutor(contextFor({ [ddgUrl]: DDG_FIXTURE }))
    const outcome = await executor.search([DUCKDUCKGO_ENGINE], {
      query: 'joker',
      limit: 5,
      timeoutMs: 1000,
      signal: new AbortController().signal
    })
    expect(outcome.engine).toBe('duckduckgo')
    expect(outcome.cacheStatus).toBe('miss')
    expect(outcome.results[0]).toMatchObject({ rank: 1, provider: 'duckduckgo' })
  })

  it('falls back to the next engine when one fails and cools it off', async () => {
    let clock = 1000
    const executor = new KeylessSearchExecutor(
      contextFor(() => BING_FIXTURE, { [ddgUrl]: new Error('rate limited') }),
      { nowMs: () => clock }
    )
    const chain = [DUCKDUCKGO_ENGINE, BING_ENGINE]
    const outcome = await executor.search(chain, {
      query: 'joker',
      limit: 5,
      timeoutMs: 1000,
      signal: new AbortController().signal
    })
    expect(outcome.engine).toBe('bing')
    expect(outcome.attempts).toEqual(['duckduckgo', 'bing'])

    // Second query skips the cooled-off engine entirely.
    const second = await executor.search(chain, {
      query: 'different',
      limit: 5,
      timeoutMs: 1000,
      signal: new AbortController().signal
    })
    expect(second.attempts).toEqual(['bing'])

    // Cooldown expires after three minutes.
    clock += 4 * 60 * 1000
    const third = await executor.search(chain, {
      query: 'third',
      limit: 5,
      timeoutMs: 1000,
      signal: new AbortController().signal
    })
    expect(third.attempts).toEqual(['duckduckgo', 'bing'])
  })

  it('serves repeat queries from the TTL cache', async () => {
    const context = contextFor(() => DDG_FIXTURE)
    let calls = 0
    const wrapped: SearchEngineContext = {
      requestDocument: async (request) => {
        calls += 1
        return context.requestDocument(request)
      },
      nowIso: context.nowIso
    }
    const executor = new KeylessSearchExecutor(wrapped)
    const request = { query: 'Joker', limit: 5, timeoutMs: 1000, signal: new AbortController().signal }
    const first = await executor.search([DUCKDUCKGO_ENGINE], request)
    const second = await executor.search([DUCKDUCKGO_ENGINE], request)
    expect(first.cacheStatus).toBe('miss')
    expect(second.cacheStatus).toBe('hit')
    expect(calls).toBe(1)
  })
})
