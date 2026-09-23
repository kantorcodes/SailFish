import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WEB_SEARCH_SETTINGS } from '@shared/types'

const { info, warn } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info,
    warn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../config.service', () => ({
  getConfigService: () => {
    throw new Error('search log test should not read config')
  },
}))

import { dispose, registerProvider, search, updateSettings } from '../index'

afterEach(() => {
  dispose()
  info.mockClear()
  warn.mockClear()
})

function useProvider(id: 'kimi', impl: { search: () => Promise<unknown> }) {
  registerProvider({ id, name: id, search: impl.search as never })
  updateSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true, providerId: id })
}

describe('web search log', () => {
  it('records the provider, query, and returned titles on success', async () => {
    useProvider('kimi', {
      search: async () => [{
        title: '旗鱼',
        url: 'https://example.com/sailfish',
        snippet: '一条摘要',
        content: '正文开头',
      }],
    })

    const results = await search('旗鱼 最新版本')

    expect(results).toHaveLength(1)
    const line = info.mock.calls.map(call => String(call[0])).find(text => text.startsWith('Search ok:'))
    expect(line).toContain('provider=kimi')
    expect(line).toContain('results=1')
    expect(line).toContain('query=旗鱼 最新版本')
    expect(line).toContain('[1] 旗鱼')
    expect(line).toContain('https://example.com/sailfish')
    expect(line).toContain('一条摘要')
    expect(line).toContain('content: 正文开头')
    expect(warn).not.toHaveBeenCalled()
  })

  it('records the query when the search fails', async () => {
    useProvider('kimi', {
      search: async () => {
        throw new Error('Kimi search failed: 401')
      },
    })

    await expect(search('今天的新闻')).rejects.toThrow('401')
    const line = warn.mock.calls.map(call => String(call[0])).find(text => text.startsWith('Search failed:'))
    expect(line).toContain('provider=kimi')
    expect(line).toContain('query=今天的新闻')
    expect(line).toContain('401')
  })
})
