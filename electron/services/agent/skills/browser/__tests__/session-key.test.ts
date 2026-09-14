import { describe, expect, it } from 'vitest'
import { resolveBrowserSessionKey } from '../session-key'

describe('resolveBrowserSessionKey', () => {
  it('uses agent identity so two assistant conversations do not share an empty pane key', () => {
    expect(resolveBrowserSessionKey('', { agentId: 'conv-firefox' })).toBe('conv-firefox')
    expect(resolveBrowserSessionKey('', { agentId: 'conv-chrome' })).toBe('conv-chrome')
    expect(resolveBrowserSessionKey(undefined, { agentId: 'conv-firefox' })).toBe('conv-firefox')
  })

  it('prefers conversation identity over the current pane', () => {
    expect(resolveBrowserSessionKey('pty-pane-1', { agentId: 'tab-a' })).toBe('tab-a')
  })

  it('falls back to the pane when there is no conversation identity', () => {
    expect(resolveBrowserSessionKey('pty-1', {})).toBe('pty-1')
    expect(resolveBrowserSessionKey('pty-1')).toBe('pty-1')
    expect(resolveBrowserSessionKey('  pty-1  ', {})).toBe('pty-1')
  })

  it('does not collapse missing pane and missing conversation into a shared empty key when agentId exists', () => {
    const a = resolveBrowserSessionKey('', { agentId: 'a' })
    const b = resolveBrowserSessionKey('', { agentId: 'b' })
    expect(a).not.toBe(b)
    expect(a).not.toBe('')
    expect(b).not.toBe('')
  })

  it('keeps helpers on the same conversation browser as the parent', () => {
    expect(resolveBrowserSessionKey('', { agentId: 'conv-a:sub:explore' })).toBe('conv-a')
    expect(resolveBrowserSessionKey('', { agentId: 'conv-a:sub:explore:sub:nested' })).toBe('conv-a')
    expect(resolveBrowserSessionKey('', { agentId: '__watch__:abc' })).toBe('__watch__:abc')
  })
})
