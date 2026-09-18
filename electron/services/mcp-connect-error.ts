/**
 * 把 MCP 连接失败收成用户能看懂的原因。
 * 分类只认 Node / undici 的稳定错误码和运行时契约，不靠猜文案。
 */

import type { McpConnectErrorKind } from '@shared/types'

export type { McpConnectErrorKind }

export interface McpConnectErrorInfo {
  kind?: McpConnectErrorKind
  message: string
}

const FALLBACK = '连接失败'

const KIND_MESSAGE: Record<McpConnectErrorKind, string> = {
  network: '网络不通，请检查网络后重试',
  timeout: '连接超时，请检查网络后重试',
  dns: '无法解析地址，请检查网络或连接器地址',
  refused: '连接被拒绝，请确认连接器地址可用',
}

/** Node 在 TLS 握手被掐断时的固定原文（code 常为 ECONNRESET，有时只剩这句话） */
const NODE_TLS_DISCONNECT =
  'Client network socket disconnected before secure TLS connection was established'

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const REFUSED_CODES = new Set(['ECONNREFUSED'])
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])
const NETWORK_CODES = new Set([
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNRESET',
  'EPIPE',
  'EPROTO',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT',
])

interface ErrorFrame {
  name?: string
  message?: string
  code?: string
}

function readCode(value: object): string | undefined {
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' && code ? code : undefined
}

function collectFrames(error: unknown): ErrorFrame[] {
  const frames: ErrorFrame[] = []
  const seen = new Set<object>()
  const queue: unknown[] = [error]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)

    const name = 'name' in current && typeof current.name === 'string' ? current.name : undefined
    const message = 'message' in current && typeof current.message === 'string' ? current.message : undefined
    frames.push({ name, message, code: readCode(current) })

    if ('cause' in current) queue.push((current as { cause?: unknown }).cause)
    if ('event' in current) queue.push((current as { event?: unknown }).event)
    if ('errors' in current && Array.isArray((current as { errors?: unknown }).errors)) {
      queue.push(...(current as { errors: unknown[] }).errors)
    }
  }

  if (typeof error === 'string' && error) {
    frames.push({ message: error })
  }

  return frames
}

function kindFromCode(code: string): McpConnectErrorKind | undefined {
  if (DNS_CODES.has(code)) return 'dns'
  if (REFUSED_CODES.has(code)) return 'refused'
  if (TIMEOUT_CODES.has(code)) return 'timeout'
  if (NETWORK_CODES.has(code)) return 'network'
  return undefined
}

/** undici：`TypeError: fetch failed`；MCP SDK / EventSource 会把这句话整段拼进 message */
function isUndiciFetchFailed(frame: ErrorFrame): boolean {
  const message = frame.message ?? ''
  if (frame.name === 'TypeError' && message === 'fetch failed') return true
  if (message === 'fetch failed') return true
  return message.includes('TypeError: fetch failed')
}

const KNOWN_CODES = [...DNS_CODES, ...REFUSED_CODES, ...TIMEOUT_CODES, ...NETWORK_CODES]

function kindFromEmbeddedCode(message: string): McpConnectErrorKind | undefined {
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return kindFromCode(code)
  }
  return undefined
}

export function classifyMcpConnectError(error: unknown): McpConnectErrorInfo {
  const frames = collectFrames(error)

  for (const frame of frames) {
    if (frame.code) {
      const kind = kindFromCode(frame.code)
      if (kind) return { kind, message: KIND_MESSAGE[kind] }
    }
  }

  for (const frame of frames) {
    if (!frame.message) continue
    const kind = kindFromEmbeddedCode(frame.message)
    if (kind) return { kind, message: KIND_MESSAGE[kind] }
  }

  for (const frame of frames) {
    if (frame.message === NODE_TLS_DISCONNECT || isUndiciFetchFailed(frame)) {
      return { kind: 'network', message: KIND_MESSAGE.network }
    }
  }

  const top = frames[0]
  const raw = top?.message?.trim()
  return { message: raw || FALLBACK }
}

export function formatMcpConnectError(error: unknown): string {
  return classifyMcpConnectError(error).message
}
