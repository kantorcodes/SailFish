/**
 * 智谱 Web Search
 * API: POST https://open.bigmodel.cn/api/paas/v4/web_search
 *
 * 与对话模型分开的搜索接口。引擎不填时用基础版 search_std。
 * 查询词官方上限 70 个字符，超出部分截掉再搜。
 */

import type { WebSearchProvider, WebSearchOptions, WebSearchResult } from '../types'
import { createLogger } from '../../../utils/logger'

const log = createLogger('WebSearch:Zhipu')
const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/web_search'
const QUERY_MAX_CHARS = 70
const DEFAULT_ENGINE = 'search_std'
const ENGINES = new Set(['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark'])
const SOGOU_COUNTS = [10, 20, 30, 40, 50]

export class ZhipuProvider implements WebSearchProvider {
  id = 'zhipu'
  name = 'Zhipu (智谱)'

  constructor(
    private apiKeyGetter: () => string,
    private engineGetter: () => string,
  ) {}

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey) throw new Error('Zhipu API key is not configured')

    const searchQuery = clipQuery(query)
    if (!searchQuery) throw new Error('Zhipu search query is empty')
    if (searchQuery !== query.trim()) {
      log.warn(`Query truncated to ${QUERY_MAX_CHARS} characters`)
    }

    const engine = resolveEngine(this.engineGetter())
    const maxResults = Math.min(Math.max(options?.maxResults ?? 5, 1), 50)

    const timeout = AbortSignal.timeout(30_000)
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildBody(searchQuery, engine, maxResults)),
      signal: options?.signal ?? timeout,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Zhipu search failed: ${resp.status} ${readErrorDetail(text)}`)
    }

    const rawText = await resp.text()
    let data: ZhipuResponse
    try {
      data = JSON.parse(rawText) as ZhipuResponse
    } catch {
      throw new Error(`Zhipu returned non-JSON response: ${rawText.slice(0, 200)}`)
    }
    return mapResults(data).slice(0, maxResults)
  }
}

function clipQuery(query: string): string {
  return Array.from(query.trim()).slice(0, QUERY_MAX_CHARS).join('')
}

function resolveEngine(raw: string): string {
  const engine = raw.trim()
  return ENGINES.has(engine) ? engine : DEFAULT_ENGINE
}

/**
 * 只带该引擎接受的字段。摘要长度用接口默认的中等摘要，不另传。
 * 夸克不接受条数；搜狗只接受 10/20/30/40/50，不足一档就向上取，回来后再裁回请求的条数。
 */
function buildBody(searchQuery: string, engine: string, maxResults: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    search_query: searchQuery,
    search_engine: engine,
    search_intent: false,
  }
  if (engine === 'search_pro_sogou') {
    body.count = snapSogouCount(maxResults)
  } else if (engine !== 'search_pro_quark') {
    body.count = maxResults
  }
  return body
}

/** 搜狗引擎只接受 10/20/30/40/50，向上取最近的一档 */
function snapSogouCount(requested: number): number {
  return SOGOU_COUNTS.find(step => step >= requested) ?? 50
}

function mapResults(data: ZhipuResponse): WebSearchResult[] {
  if (!Array.isArray(data.search_result)) return []
  return data.search_result.map(item => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.content || '',
  }))
}

function readErrorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch { /* 保留原文 */ }
  return text
}

interface ZhipuResponse {
  search_result?: Array<{
    title?: string
    content?: string
    link?: string
  }>
}
