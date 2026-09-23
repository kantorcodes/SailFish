/**
 * Kimi 独立联网搜索
 * Basic: POST https://api.moonshot.cn/v1/tools/search
 * Pro:   POST https://api.moonshot.cn/v1/tools/search_pro
 *
 * 与对话模型分开。不填档位时用 Basic（标题、链接、摘要）。
 * Pro 额外返回和查询最相关的正文片段。
 */

import type { WebSearchProvider, WebSearchOptions, WebSearchResult } from '../types'
import { createLogger } from '../../../utils/logger'

const log = createLogger('WebSearch:Kimi')
const BASIC_ENDPOINT = 'https://api.moonshot.cn/v1/tools/search'
const PRO_ENDPOINT = 'https://api.moonshot.cn/v1/tools/search_pro'

export class KimiProvider implements WebSearchProvider {
  id = 'kimi'
  name = 'Kimi (月之暗面)'

  constructor(
    private apiKeyGetter: () => string,
    private tierGetter: () => string,
  ) {}

  async search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]> {
    const apiKey = this.apiKeyGetter()
    if (!apiKey) throw new Error('Kimi API key is not configured')

    const textQuery = query.trim()
    if (!textQuery) throw new Error('Kimi search query is empty')

    const pro = this.tierGetter().trim() === 'pro'
    const limit = Math.min(Math.max(options?.maxResults ?? 5, 1), 20)
    const timeoutSeconds = pro ? 45 : 30

    const body: Record<string, unknown> = {
      text_query: textQuery,
      limit,
      timeout_seconds: timeoutSeconds,
    }
    if (!pro) body.include_content = false

    const timeout = AbortSignal.timeout((timeoutSeconds + 5) * 1000)
    const resp = await fetch(pro ? PRO_ENDPOINT : BASIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options?.signal ?? timeout,
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Kimi search failed: ${resp.status} ${readErrorDetail(text)}`)
    }

    const rawText = await resp.text()
    let data: KimiResponse
    try {
      data = JSON.parse(rawText) as KimiResponse
    } catch {
      throw new Error(`Kimi returned non-JSON response: ${rawText.slice(0, 200)}`)
    }
    const results = mapResults(data)
    if (results.length === 0) {
      log.warn('Empty results. Response keys:', Object.keys(data))
    }
    return results.slice(0, limit)
  }
}

function mapResults(data: KimiResponse): WebSearchResult[] {
  if (!Array.isArray(data.search_results)) return []
  return data.search_results.map(item => {
    const passages = (item.chunks ?? [])
      .map(chunk => chunk.text?.trim() || '')
      .filter(Boolean)
      .join('\n\n')
    const summary = item.snippet?.trim() || ''
    const page = item.text?.trim() || ''
    const extra = passages || page
    const result: WebSearchResult = {
      title: item.title || '',
      url: item.url || '',
      snippet: summary || extra,
    }
    if (summary && extra && extra !== summary) result.content = extra
    return result
  })
}

function readErrorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    if (parsed.error?.message) return parsed.error.message
  } catch { /* 保留原文 */ }
  return text
}

interface KimiChunk {
  text?: string
}

interface KimiHit {
  title?: string
  url?: string
  snippet?: string
  /** Basic 在 include_content 时返回的网页正文 */
  text?: string
  chunks?: KimiChunk[]
}

interface KimiResponse {
  search_results?: KimiHit[]
}
