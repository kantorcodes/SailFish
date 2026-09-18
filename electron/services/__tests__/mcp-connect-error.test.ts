import { describe, expect, it } from 'vitest'
import { classifyMcpConnectError } from '../mcp-connect-error'

function withCause(message: string, cause: unknown): Error {
  const err = new Error(message)
  ;(err as Error & { cause?: unknown }).cause = cause
  return err
}

describe('classifyMcpConnectError', () => {
  it('uses Node error codes on the cause chain', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND' })
    expect(classifyMcpConnectError(withCause('SSE errored: TypeError: fetch failed', dns))).toEqual({
      kind: 'dns',
      message: '无法解析地址，请检查网络或连接器地址',
    })

    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(classifyMcpConnectError(withCause('fetch failed', refused)).kind).toBe('refused')

    const timeout = Object.assign(new Error('connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
    expect(classifyMcpConnectError(withCause('fetch failed', timeout)).kind).toBe('timeout')
  })

  it('treats undici TypeError fetch failed as network down', () => {
    const undici = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('other side closed'), { code: undefined }),
    })
    expect(classifyMcpConnectError(undici)).toEqual({
      kind: 'network',
      message: '网络不通，请检查网络后重试',
    })
  })

  it('recognizes MCP SDK / EventSource flattening of fetch failed', () => {
    expect(classifyMcpConnectError(new Error('SSE error: TypeError: fetch failed: write EPIPE')).kind).toBe('network')
    expect(classifyMcpConnectError(new Error('SSE errored: TypeError: fetch failed: Client network socket disconnected')).kind).toBe('network')
    expect(classifyMcpConnectError(new Error('SSE error: TypeError: fetch failed: getaddrinfo ENOTFOUND api.example.com')).kind).toBe('dns')
  })

  it('reads ErrorEvent hanging off event', () => {
    const sse = Object.assign(new Error('SSE error: TypeError: fetch failed'), {
      event: { message: 'TypeError: fetch failed: write EPIPE' },
    })
    expect(classifyMcpConnectError(sse).kind).toBe('network')
  })

  it('recognizes Node TLS handshake disconnect without a code', () => {
    expect(classifyMcpConnectError(new Error(
      'Client network socket disconnected before secure TLS connection was established'
    )).kind).toBe('network')
  })

  it('keeps unknown errors as-is', () => {
    expect(classifyMcpConnectError(new Error('stdio 模式需要指定 command'))).toEqual({
      message: 'stdio 模式需要指定 command',
    })
  })

  it('falls back when there is no message', () => {
    expect(classifyMcpConnectError({})).toEqual({ message: '连接失败' })
  })
})
