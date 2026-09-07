import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.service', () => ({
  getConfigService: () => ({
    get: () => undefined,
    set: () => {}
  }),
  ConfigService: class {}
}))

vi.mock('../ai-debug.service', () => ({
  getAiDebugService: () => ({
    logRequestStart: () => {},
    logResponseChunk: () => {},
    logResponseDone: () => {},
    logResponseError: () => {}
  })
}))

vi.mock('../agent/i18n', () => ({
  t: (key: string) => key
}))

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  })
}))

import { isNoRetryBusinessCode, parseApiError } from '../ai.service'

describe('parseApiError', () => {
  it('提取 OpenAI 包裹的 code，并转成小写', () => {
    const parsed = parseApiError(JSON.stringify({
      error: { message: 'account overdue', code: 'ArrearsError' }
    }))
    expect(parsed.code).toBe('arrearserror')
    expect(parsed.message).toBe('account overdue')
  })

  it('code 为空时回退到 type', () => {
    const parsed = parseApiError(JSON.stringify({
      error: { message: 'no quota', type: 'insufficient_quota', code: null }
    }))
    expect(parsed.code).toBe('insufficient_quota')
  })

  it('数字 code（如 OpenRouter 402）转成字符串', () => {
    const parsed = parseApiError(JSON.stringify({
      error: { message: 'Insufficient credits', code: 402 }
    }))
    expect(parsed.code).toBe('402')
  })

  it('识别顶层 code/message（DashScope 等）', () => {
    const parsed = parseApiError(JSON.stringify({
      code: 'ArrearsError',
      message: 'Access denied, please make sure your account is in good standing.'
    }))
    expect(parsed.code).toBe('arrearserror')
    expect(parsed.message).toContain('Access denied')
  })
})

describe('isNoRetryBusinessCode', () => {
  it('欠费、鉴权码不重试，大小写无关', () => {
    expect(isNoRetryBusinessCode('ArrearsError')).toBe(true)
    expect(isNoRetryBusinessCode('invalid_api_key')).toBe(true)
    expect(isNoRetryBusinessCode('rate_limit_exceeded')).toBe(false)
    expect(isNoRetryBusinessCode('overloaded_error')).toBe(false)
  })
})
