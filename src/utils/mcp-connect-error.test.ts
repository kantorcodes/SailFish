import { describe, expect, it } from 'vitest'
import { isMcpNetworkOutageKind, mcpConnectErrorText } from './mcp-connect-error'

const t = (key: string) => `i18n:${key}`

describe('mcpConnectErrorText', () => {
  it('maps known kinds to i18n keys', () => {
    expect(mcpConnectErrorText({ errorKind: 'network', error: '网络不通，请检查网络后重试' }, t)).toBe('i18n:mcp.errorNetwork')
    expect(mcpConnectErrorText({ errorKind: 'timeout' }, t)).toBe('i18n:mcp.errorTimeout')
    expect(mcpConnectErrorText({ errorKind: 'dns' }, t)).toBe('i18n:mcp.errorDns')
    expect(mcpConnectErrorText({ errorKind: 'refused' }, t)).toBe('i18n:mcp.errorRefused')
  })

  it('falls back to raw error or given fallback', () => {
    expect(mcpConnectErrorText({ error: 'stdio 模式需要指定 command' }, t)).toBe('stdio 模式需要指定 command')
    expect(mcpConnectErrorText(undefined, t, '连接失败')).toBe('连接失败')
  })
})

describe('isMcpNetworkOutageKind', () => {
  it('treats network / timeout / dns as outage, not refused', () => {
    expect(isMcpNetworkOutageKind('network')).toBe(true)
    expect(isMcpNetworkOutageKind('timeout')).toBe(true)
    expect(isMcpNetworkOutageKind('dns')).toBe(true)
    expect(isMcpNetworkOutageKind('refused')).toBe(false)
    expect(isMcpNetworkOutageKind(undefined)).toBe(false)
  })
})
