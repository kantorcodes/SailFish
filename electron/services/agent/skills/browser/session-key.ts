/**
 * 浏览器会话键：跟对话走，不跟终端窗格走。
 *
 * 助手没有窗格时 ptyId 为空。若仍用空串当钥匙，两场对话会抢同一条会话。
 * 同一场对话里派出去的伙计沿用这场已打开的浏览器，不另起一条。
 */
export function conversationRootId(agentId: string): string {
  const idx = agentId.indexOf(':sub:')
  return idx === -1 ? agentId : agentId.slice(0, idx)
}

export function resolveBrowserSessionKey(
  ptyId: string | undefined,
  executor?: { agentId?: string },
): string {
  const agentId = executor?.agentId?.trim()
  if (agentId) return conversationRootId(agentId)
  return (ptyId ?? '').trim()
}
