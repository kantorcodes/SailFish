/**
 * Attach 模式会话 — 通过浏览器扩展操作用户已打开的 Chrome/Edge/Firefox
 */

import type {
  BrowserBridgeAttachTarget,
  BrowserBridgePingResult,
  BrowserBridgeRefMap,
  BrowserBridgeTabInfo,
} from '@shared/types/browser-bridge'
import { getBrowserBridgeService } from '../../../browser-bridge/browser-bridge.service'
import { attachTargetLabel, extensionSupportsTabsManage, parsePingResult } from '../../../browser-bridge/protocol'
import { conversationRootId } from './session-key'

export interface BridgeSession {
  mode: 'attach'
  ptyId: string
  browserTarget: BrowserBridgeAttachTarget
  origin: string
  createdAt: number
  lastActivityAt: number
  refs: BrowserBridgeRefMap
  activeTabIndex: number
  extensionPing?: BrowserBridgePingResult
}

const sessions = new Map<string, BridgeSession>()

/** 默认当没人在跑：单测、以及 Agent 服务尚未接上时，不挡下一场接过去。 */
let isConversationRunning: (rootId: string) => boolean = () => false

export class AttachOccupiedError extends Error {
  readonly code = 'attach_occupied' as const
  readonly browserTarget: BrowserBridgeAttachTarget

  constructor(browserTarget: BrowserBridgeAttachTarget) {
    super(
      `${attachTargetLabel(browserTarget)} 正被另一场正在进行的对话使用。等那场结束后可以再吸附，或改用独立窗口。`,
    )
    this.name = 'AttachOccupiedError'
    this.browserTarget = browserTarget
  }
}

export function setAttachLockRunningChecker(checker: (rootId: string) => boolean): void {
  isConversationRunning = checker
}

function findAttachOccupant(
  target: BrowserBridgeAttachTarget,
  excludeRoot: string,
): string | undefined {
  for (const [key, session] of sessions) {
    if (session.browserTarget !== target) continue
    if (conversationRootId(key) === excludeRoot) continue
    return key
  }
  return undefined
}

/** 同一档用户浏览器同时只给一场正在跑的对话。停了就让下一场接过去。 */
export function acquireAttachLock(sessionKey: string, target: BrowserBridgeAttachTarget): void {
  const root = conversationRootId(sessionKey)
  let occupantKey = findAttachOccupant(target, root)
  while (occupantKey) {
    if (isConversationRunning(conversationRootId(occupantKey))) {
      throw new AttachOccupiedError(target)
    }
    closeBridgeSession(occupantKey)
    occupantKey = findAttachOccupant(target, root)
  }
}

export function getBridgeSession(ptyId: string): BridgeSession | undefined {
  return sessions.get(ptyId)
}

export function hasBridgeSession(ptyId: string): boolean {
  return sessions.has(ptyId)
}

export async function createBridgeSession(
  ptyId: string,
  browserInput?: unknown,
): Promise<BridgeSession> {
  const bridge = getBrowserBridgeService()
  const { origin, browserTarget } = bridge.resolveConnection(browserInput)
  acquireAttachLock(ptyId, browserTarget)

  const existing = sessions.get(ptyId)
  if (existing && existing.browserTarget === browserTarget) {
    const pingRaw = await bridge.sendCommand('ping', {}, { origin })
    existing.origin = origin
    existing.extensionPing = parsePingResult(pingRaw) ?? undefined
    existing.lastActivityAt = Date.now()
    existing.refs = {}
    existing.activeTabIndex = 0
    return existing
  }

  const previous = existing
  const session: BridgeSession = {
    mode: 'attach',
    ptyId,
    browserTarget,
    origin,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    refs: {},
    activeTabIndex: 0,
  }
  sessions.set(ptyId, session)
  try {
    const pingRaw = await bridge.sendCommand('ping', {}, { origin })
    session.extensionPing = parsePingResult(pingRaw) ?? undefined
    return session
  } catch (err) {
    if (previous) sessions.set(ptyId, previous)
    else sessions.delete(ptyId)
    throw err
  }
}

export function closeBridgeSession(ptyId: string): void {
  sessions.delete(ptyId)
}

export function touchBridgeSession(ptyId: string): void {
  const session = sessions.get(ptyId)
  if (session) session.lastActivityAt = Date.now()
}

export async function bridgeListTabs(ptyId: string): Promise<BrowserBridgeTabInfo[]> {
  const session = sessions.get(ptyId)
  // 优先读 service 的实时能力（extension reload 后 probeHost 会更新），
  // 避免 session.extensionPing 在 install 后长期过期
  const live = session ? getBrowserBridgeService().getConnectionCapabilities(session.origin) : null
  if (extensionSupportsTabsManage(live ?? session?.extensionPing)) {
    return (await bridgeSend(ptyId, 'tabs', {
      op: 'query',
      query: { currentWindow: true },
    })) as BrowserBridgeTabInfo[]
  }
  return (await bridgeSend(ptyId, 'list_tabs', {})) as BrowserBridgeTabInfo[]
}

export async function bridgeSend(
  ptyId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  const session = sessions.get(ptyId)
  if (!session) {
    throw new Error('浏览器未连接。请先 browser_launch attach 模式。')
  }
  return getBrowserBridgeService().sendCommand(action, payload, { origin: session.origin })
}

export function resolveBridgeRef(session: BridgeSession, ref: string): { ref: string } {
  const refId = ref.startsWith('@') ? ref.slice(1) : ref
  if (!session.refs[refId]) {
    const available = Object.keys(session.refs)
    const hint = available.length
      ? `当前可用的 ref: ${available.slice(0, 10).map((r) => '@' + r).join(', ')}`
      : '当前没有可用的 ref，请先调用 browser_snapshot'
    throw new Error(`ref "${refId}" 未找到。${hint}`)
  }
  return { ref: refId }
}

export function closeAllBridgeSessions(): void {
  sessions.clear()
}

export function resetBridgeSessionsForTest(): void {
  sessions.clear()
  isConversationRunning = () => false
}

export function seedBridgeSessionForTest(
  session: Pick<BridgeSession, 'ptyId' | 'browserTarget'> & Partial<BridgeSession>,
): BridgeSession {
  const seeded: BridgeSession = {
    mode: 'attach',
    origin: session.origin ?? 'test',
    createdAt: session.createdAt ?? Date.now(),
    lastActivityAt: session.lastActivityAt ?? Date.now(),
    refs: session.refs ?? {},
    activeTabIndex: session.activeTabIndex ?? 0,
    ...session,
  }
  sessions.set(seeded.ptyId, seeded)
  return seeded
}
