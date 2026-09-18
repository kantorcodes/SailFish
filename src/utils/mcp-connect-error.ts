import type { McpConnectErrorKind } from '@shared/types'

const ERROR_I18N: Record<McpConnectErrorKind, string> = {
  network: 'mcp.errorNetwork',
  timeout: 'mcp.errorTimeout',
  dns: 'mcp.errorDns',
  refused: 'mcp.errorRefused',
}

export function isMcpNetworkOutageKind(kind?: McpConnectErrorKind): boolean {
  return kind === 'network' || kind === 'timeout' || kind === 'dns'
}

export function mcpConnectErrorText(
  status: { error?: string; errorKind?: McpConnectErrorKind } | undefined,
  t: (key: string) => string,
  fallback = '',
): string {
  if (!status) return fallback
  if (status.errorKind && ERROR_I18N[status.errorKind]) {
    return t(ERROR_I18N[status.errorKind])
  }
  return status.error || fallback
}
