/** Web Search 配置，前后端共享 */

export type WebSearchProviderId = 'tavily' | 'jina' | 'bocha' | 'zhipu' | 'kimi' | 'google'

export interface WebSearchSettings {
  enabled: boolean
  providerId: WebSearchProviderId
  /** @deprecated 迁移用，新版用 apiKeys */
  apiKey?: string
  /** 每个 provider 独立的 API Key */
  apiKeys: Partial<Record<WebSearchProviderId, string>>
  /** Provider 额外配置（如 Google 需要的 cx）。key 为 provider 内部字段名 */
  apiExtras?: Partial<Record<WebSearchProviderId, Record<string, string>>>
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  providerId: 'bocha',
  apiKeys: {},
  apiExtras: {},
}

/** Provider 元数据中可声明的额外配置字段（除 API Key 之外） */
export interface WebSearchExtraField {
  /** 字段 key，会作为 apiExtras[providerId][key] 存取 */
  key: string
  /** 字段名。设置页按 key 走翻译，不直接显示这句 */
  label: string
  placeholder?: string
  /** 有选项时设置页用下拉，而不是自由输入 */
  options?: { value: string; label: string }[]
  /** 未填写时使用。有默认值的字段不阻塞「已配置」判断 */
  defaultValue?: string
}

export const WEB_SEARCH_PROVIDERS: {
  id: WebSearchProviderId
  name: string
  requiresApiKey: boolean
  description: string
  extraFields?: WebSearchExtraField[]
}[] = [
  { id: 'bocha', name: 'Bocha (博查)', requiresApiKey: true, description: 'AI search engine, best for China users' },
  {
    id: 'zhipu',
    name: 'Zhipu (智谱)',
    requiresApiKey: true,
    description: 'Domestic web search, separate from the chat model. Default engine is the cheaper basic tier.',
    extraFields: [
      {
        key: 'engine',
        label: 'Search engine',
        defaultValue: 'search_std',
        options: [
          { value: 'search_std', label: 'Basic (search_std)' },
          { value: 'search_pro', label: 'Pro (search_pro)' },
          { value: 'search_pro_sogou', label: 'Sogou' },
          { value: 'search_pro_quark', label: 'Quark' },
        ],
      },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi (月之暗面)',
    requiresApiKey: true,
    description: 'Domestic web search, separate from the chat model. Basic returns titles and snippets; Pro returns the passages most relevant to the query.',
    extraFields: [
      {
        key: 'tier',
        label: 'Tier',
        defaultValue: 'basic',
        options: [
          { value: 'basic', label: 'Basic' },
          { value: 'pro', label: 'Pro' },
        ],
      },
    ],
  },
  { id: 'tavily', name: 'Tavily', requiresApiKey: true, description: 'Best AI agent search experience' },
  { id: 'jina', name: 'Jina', requiresApiKey: true, description: 'Search + URL reader, returns Markdown' },
  {
    id: 'google',
    name: 'Google Custom Search',
    requiresApiKey: true,
    description: 'Google official search via Custom Search JSON API. Requires API Key + Search Engine ID (cx). Free 100 queries/day.',
    extraFields: [
      { key: 'cx', label: 'Search Engine ID (cx)', placeholder: 'e.g. 017576662512468239146:omuauf_lfve' },
    ],
  },
]
