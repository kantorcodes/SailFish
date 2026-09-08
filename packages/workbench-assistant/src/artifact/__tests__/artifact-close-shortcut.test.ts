import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLOSE_ARTIFACT_SHORTCUT_GUARD_MS,
  closeFocusedArtifact,
  isCloseArtifactShortcut,
  registerFocusedArtifactCloser,
  resetCloseArtifactShortcutGuard
} from '../domain/artifact-close-shortcut'

describe('isCloseArtifactShortcut', () => {
  it('Cmd+W / Ctrl+W 算关闭产出物', () => {
    expect(isCloseArtifactShortcut({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: false })).toBe(true)
    expect(isCloseArtifactShortcut({ key: 'W', metaKey: false, ctrlKey: true, shiftKey: false })).toBe(true)
  })

  it('带 Shift / Alt 或没有修饰键不算', () => {
    expect(isCloseArtifactShortcut({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: true })).toBe(false)
    expect(isCloseArtifactShortcut({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true })).toBe(false)
    expect(isCloseArtifactShortcut({ key: 'w', metaKey: false, ctrlKey: false, shiftKey: false })).toBe(false)
  })
})

describe('closeFocusedArtifact', () => {
  afterEach(() => {
    registerFocusedArtifactCloser(null)
    resetCloseArtifactShortcutGuard()
    vi.useRealTimers()
  })

  it('未注册或回调返回 false 时不关', () => {
    expect(closeFocusedArtifact()).toBe(false)
    registerFocusedArtifactCloser(() => false)
    expect(closeFocusedArtifact()).toBe(false)
  })

  it('有焦点则关一次；菜单回声窗口内再进来不连关', () => {
    vi.useFakeTimers()
    const closer = vi.fn(() => true)
    registerFocusedArtifactCloser(closer)
    expect(closeFocusedArtifact()).toBe(true)
    vi.advanceTimersByTime(CLOSE_ARTIFACT_SHORTCUT_GUARD_MS - 1)
    expect(closeFocusedArtifact()).toBe(true)
    expect(closer).toHaveBeenCalledTimes(1)
  })

  it('窗口过后再按可以再关一份', () => {
    vi.useFakeTimers()
    const closer = vi.fn(() => true)
    registerFocusedArtifactCloser(closer)
    expect(closeFocusedArtifact()).toBe(true)
    vi.advanceTimersByTime(CLOSE_ARTIFACT_SHORTCUT_GUARD_MS)
    expect(closeFocusedArtifact()).toBe(true)
    expect(closer).toHaveBeenCalledTimes(2)
  })
})
