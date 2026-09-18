/**
 * MCP 服务器配置（前后端 / 工作台 descriptor 共用）
 */

/** 连接失败里用户能感知的一类原因；界面按这类说话，不展示程序内部报错 */
export type McpConnectErrorKind = 'network' | 'timeout' | 'dns' | 'refused'

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  /** 'http' = Streamable HTTP；'sse' = 旧 SSE（兼容）；'stdio' = 本地进程 */
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  /**
   * 何时该用（给模型看的短触发说明；进 skill / MCP 目录）。
   * 旧配置可缺省；新保存/新启用必须非空且经用户确认。
   */
  whenToUse?: string
}
