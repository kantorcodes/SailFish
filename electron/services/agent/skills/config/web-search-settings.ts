/**
 * 联网搜索设置：给配置技能看清、一家一家改。
 * 服务商是内置的，不能新增或删除。密钥只写不回显。
 */

import {
  WEB_SEARCH_PROVIDERS,
  webSearchKeyFromModelProfiles,
  type AiProfile,
  type WebSearchProviderId,
  type WebSearchSettings,
} from '@shared/types'
import type { ToolResult } from '../../tools/types'

export interface WebSearchSettingsStore {
  getWebSearchSettings(): WebSearchSettings | undefined
  setWebSearchSettings(settings: WebSearchSettings): void
  getAiProfiles(): Array<Pick<AiProfile, 'id' | 'apiUrl' | 'apiKey'>>
  getActiveAiProfile(): string
}

const PROVIDERS = WEB_SEARCH_PROVIDERS

function isProviderId(value: string): value is WebSearchProviderId {
  return PROVIDERS.some(provider => provider.id === value)
}

function readSettings(raw: WebSearchSettings | undefined): WebSearchSettings {
  const providerId = raw?.providerId && isProviderId(raw.providerId) ? raw.providerId : 'bocha'
  const apiKeys: WebSearchSettings['apiKeys'] = { ...(raw?.apiKeys || {}) }
  const legacy = raw?.apiKey?.trim()
  if (legacy && !apiKeys[providerId]?.trim()) apiKeys[providerId] = legacy
  const apiExtras: NonNullable<WebSearchSettings['apiExtras']> = {}
  for (const [id, fields] of Object.entries(raw?.apiExtras || {})) {
    if (!fields) continue
    apiExtras[id as WebSearchProviderId] = { ...fields }
  }
  return {
    enabled: !!raw?.enabled,
    providerId,
    apiKeys,
    apiExtras,
  }
}

function providerMeta(id: WebSearchProviderId) {
  return PROVIDERS.find(provider => provider.id === id)!
}

function keyStatus(store: WebSearchSettingsStore, settings: WebSearchSettings, id: WebSearchProviderId): string {
  if (settings.apiKeys[id]?.trim()) return '搜索密钥已填'
  const reused = webSearchKeyFromModelProfiles(id, store.getAiProfiles(), store.getActiveAiProfile())
  if (reused) return '沿用模型密钥'
  return '密钥未配置'
}

function extraStatus(settings: WebSearchSettings, id: WebSearchProviderId): string[] {
  const meta = providerMeta(id)
  if (!meta.extraFields?.length) return []
  const stored = settings.apiExtras?.[id] || {}
  return meta.extraFields.map(field => {
    const value = stored[field.key]?.trim() || field.defaultValue || ''
    return value ? `${field.key}=${value}` : `${field.key} 未填`
  })
}

function providerLine(store: WebSearchSettingsStore, settings: WebSearchSettings, id: WebSearchProviderId): string {
  const meta = providerMeta(id)
  const flags = [keyStatus(store, settings, id), ...extraStatus(settings, id)]
  if (settings.providerId === id) flags.unshift('当前使用')
  return `    - **${meta.name}** \`${id}\` · ${flags.join(' · ')}`
}

export function formatWebSearchSummary(store: WebSearchSettingsStore): string {
  const settings = readSettings(store.getWebSearchSettings())
  const state = settings.enabled ? '已开启' : '已关闭'
  const current = providerMeta(settings.providerId).name
  const lines = PROVIDERS.map(provider => providerLine(store, settings, provider.id))
  return `  - **联网搜索** — ${state}，当前 ${current}（勿用 config_set 整表覆盖；用 config_web_search）\n${lines.join('\n')}`
}

export function formatWebSearchDetail(store: WebSearchSettingsStore): string {
  const settings = readSettings(store.getWebSearchSettings())
  const state = settings.enabled ? '已开启' : '已关闭'
  const blocks = PROVIDERS.map(provider => {
    const flags = [keyStatus(store, settings, provider.id), ...extraStatus(settings, provider.id)]
    const current = settings.providerId === provider.id ? '（当前使用）' : ''
    return `**${provider.name}** \`${provider.id}\`${current}\n- ${flags.join('\n- ')}`
  })
  return `联网搜索${state}。\n\n${blocks.join('\n\n')}\n\n换一家、填密钥或改档位用 \`config_web_search\`。密钥不回显。不能新增或删除服务商。`
}

/** null 和没传一样，表示这项不动。只有显式空字符串才表示清掉。 */
function provided(args: Record<string, unknown>, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(args, key)) return false
  const value = args[key]
  return value !== undefined && value !== null
}

function argStr(args: Record<string, unknown>, key: string): string | undefined {
  if (!provided(args, key)) return undefined
  const value = args[key]
  if (typeof value !== 'string') return undefined
  return value.trim()
}

function argBool(args: Record<string, unknown>, key: string): boolean | undefined {
  if (!provided(args, key)) return undefined
  const value = args[key]
  if (value === '') return undefined
  if (typeof value === 'boolean') return value
  if (value === 'true' || value === 1 || value === '1') return true
  if (value === 'false' || value === 0 || value === '0') return false
  return undefined
}

export function executeWebSearchSettingsAction(
  store: WebSearchSettingsStore,
  args: Record<string, unknown>,
): ToolResult {
  const settings = readSettings(store.getWebSearchSettings())
  const providerRaw = argStr(args, 'provider')
  if (provided(args, 'provider') && !providerRaw) {
    return { success: false, output: '', error: 'provider 必须是服务商 id' }
  }
  if (providerRaw && !isProviderId(providerRaw)) {
    const ids = PROVIDERS.map(provider => provider.id).join(', ')
    return { success: false, output: '', error: `没有这家搜索服务商 "${providerRaw}"。可选: ${ids}` }
  }
  const providerId = providerRaw && isProviderId(providerRaw) ? providerRaw : undefined

  const enabled = argBool(args, 'enabled')
  if (provided(args, 'enabled') && enabled === undefined) {
    return { success: false, output: '', error: 'enabled 必须是布尔值' }
  }
  const setCurrent = argBool(args, 'setCurrent')
  if (provided(args, 'setCurrent') && setCurrent === undefined) {
    return { success: false, output: '', error: 'setCurrent 必须是布尔值' }
  }

  const touchesKey = provided(args, 'apiKey')
  const extraKeys = ['engine', 'tier', 'cx'] as const
  const touchedExtras = extraKeys.filter(key => provided(args, key))
  if ((touchesKey || touchedExtras.length > 0 || setCurrent) && !providerId) {
    return { success: false, output: '', error: '请用 provider 指明要改的是哪一家' }
  }
  if (enabled === undefined && !setCurrent && !touchesKey && touchedExtras.length === 0) {
    return { success: false, output: '', error: '没有要改的内容。可以换当前服务商、开关、写入或清空密钥、改档位。' }
  }

  if (enabled !== undefined) settings.enabled = enabled
  if (setCurrent && providerId) settings.providerId = providerId

  if (touchesKey && providerId) {
    const raw = args.apiKey
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return { success: false, output: '', error: 'apiKey 必须是字符串；留空表示清掉这家单独填的搜索密钥' }
    }
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (key) settings.apiKeys[providerId] = key
    else delete settings.apiKeys[providerId]
  }

  if (providerId && touchedExtras.length > 0) {
    const meta = providerMeta(providerId)
    const fields = { ...(settings.apiExtras?.[providerId] || {}) }
    for (const key of touchedExtras) {
      const field = meta.extraFields?.find(item => item.key === key)
      if (!field) {
        return { success: false, output: '', error: `${meta.name} 没有「${key}」这一项` }
      }
      const raw = args[key]
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return { success: false, output: '', error: `${key} 必须是字符串` }
      }
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) {
        delete fields[key]
        continue
      }
      if (field.options && !field.options.some(option => option.value === value)) {
        const allowed = field.options.map(option => option.value).join(', ')
        return { success: false, output: '', error: `"${value}" 不是 ${meta.name} 的有效${key}。可选: ${allowed}` }
      }
      fields[key] = value
    }
    settings.apiExtras = { ...(settings.apiExtras || {}), [providerId]: fields }
  }

  store.setWebSearchSettings(settings)
  const saved = readSettings(store.getWebSearchSettings())
  return { success: true, output: `✅ 已更新联网搜索。\n\n${formatWebSearchDetail({ ...store, getWebSearchSettings: () => saved })}` }
}
