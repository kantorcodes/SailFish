import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockBridge } = vi.hoisted(() => ({
  mockBridge: {
    resolveConnection: vi.fn(() => ({
      origin: 'moz-extension://test',
      browserTarget: 'firefox' as const,
    })),
    sendCommand: vi.fn(async () => ({ protocol: 1, extension: 't', version: '1' })),
    getStatus: vi.fn(() => ({ gatewayRunning: true, connections: [{ origin: 'moz-extension://test' }] })),
    getConnectionCapabilities: vi.fn(() => null),
  },
}))

vi.mock('../../../../browser-bridge/browser-bridge.service', () => ({
  getBrowserBridgeService: () => mockBridge,
}))

import {
  AttachOccupiedError,
  acquireAttachLock,
  createBridgeSession,
  getBridgeSession,
  resetBridgeSessionsForTest,
  seedBridgeSessionForTest,
  setAttachLockRunningChecker,
} from '../bridge-session'
import { ensureBridgeSessionIfPreferred } from '../bridge-executor'

afterEach(() => {
  resetBridgeSessionsForTest()
})

describe('acquireAttachLock', () => {
  it('lets the first conversation attach when nobody holds the browser', () => {
    acquireAttachLock('conv-a', 'firefox')
    expect(getBridgeSession('conv-b')).toBeUndefined()
  })

  it('lets the same conversation and its helpers keep the lock', () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker((root) => root === 'conv-a')

    acquireAttachLock('conv-a', 'firefox')
    acquireAttachLock('conv-a:sub:explore', 'firefox')

    expect(getBridgeSession('conv-a')?.browserTarget).toBe('firefox')
  })

  it('refuses another conversation while the holder is still running', () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker((root) => root === 'conv-a')

    expect(() => acquireAttachLock('conv-b', 'firefox')).toThrow(AttachOccupiedError)
    expect(getBridgeSession('conv-a')).toBeDefined()
  })

  it('lets another conversation take over after the holder stops', () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker(() => false)

    acquireAttachLock('conv-b', 'firefox')

    expect(getBridgeSession('conv-a')).toBeUndefined()
  })

  it('does not let a Firefox lock block Chromium', () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker((root) => root === 'conv-a')

    acquireAttachLock('conv-b', 'chromium')
    expect(getBridgeSession('conv-a')?.browserTarget).toBe('firefox')
  })

  it('names the occupied browser in the error', () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker(() => true)

    try {
      acquireAttachLock('conv-b', 'firefox')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(AttachOccupiedError)
      expect((error as Error).message).toContain('Firefox')
      expect((error as Error).message).toContain('独立窗口')
    }
  })
})

describe('createBridgeSession attach lock', () => {
  it('throws when another running conversation already holds this browser', async () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker((root) => root === 'conv-a')

    await expect(createBridgeSession('conv-b')).rejects.toBeInstanceOf(AttachOccupiedError)
    expect(getBridgeSession('conv-a')).toBeDefined()
  })

  it('clears stale refs when the same conversation reconnects', async () => {
    seedBridgeSessionForTest({
      ptyId: 'conv-a',
      browserTarget: 'firefox',
      refs: { e1: { role: 'button', name: 'old' } as never },
      activeTabIndex: 3,
    })

    const session = await createBridgeSession('conv-a')
    expect(session.refs).toEqual({})
    expect(session.activeTabIndex).toBe(0)
  })
})

describe('ensureBridgeSessionIfPreferred', () => {
  it('does not swallow an occupied attach so the caller can tell the user', async () => {
    seedBridgeSessionForTest({ ptyId: 'conv-a', browserTarget: 'firefox' })
    setAttachLockRunningChecker((root) => root === 'conv-a')

    await expect(ensureBridgeSessionIfPreferred('conv-b', {})).rejects.toBeInstanceOf(AttachOccupiedError)
  })
})
