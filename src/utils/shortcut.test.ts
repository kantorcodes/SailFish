import { describe, expect, it } from 'vitest'
import {
  acceleratorsConflict,
  decorateShortcut,
  formatAccelerator,
  keyEventToAccelerator,
  matchAccelerator,
  resolveComposerChord,
} from './shortcut'

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
  } as KeyboardEvent
}

describe('matchAccelerator', () => {
  it('matches bare Enter and ignores Shift+Enter', () => {
    expect(matchAccelerator(keyEvent({ key: 'Enter' }), 'Enter')).toBe(true)
    expect(matchAccelerator(keyEvent({ key: 'Enter', shiftKey: true }), 'Enter')).toBe(false)
    expect(matchAccelerator(keyEvent({ key: 'Enter', metaKey: true }), 'Enter')).toBe(false)
  })

  it('matches Cmd+Enter only with meta', () => {
    expect(matchAccelerator(keyEvent({ key: 'Enter', metaKey: true }), 'Cmd+Enter')).toBe(true)
    expect(matchAccelerator(keyEvent({ key: 'Enter', ctrlKey: true }), 'Cmd+Enter')).toBe(false)
    expect(matchAccelerator(keyEvent({ key: 'Enter' }), 'Cmd+Enter')).toBe(false)
  })
})

describe('acceleratorsConflict', () => {
  it('does not treat Enter and Cmd+Enter as the same key', () => {
    expect(acceleratorsConflict('Enter', 'Cmd+Enter')).toBe(false)
    expect(acceleratorsConflict('Enter', 'Ctrl+Enter')).toBe(false)
  })

  it('treats Cmd+Enter and CmdOrCtrl+Enter as the same key', () => {
    expect(acceleratorsConflict('Cmd+Enter', 'CmdOrCtrl+Enter')).toBe(true)
    expect(acceleratorsConflict('Ctrl+Enter', 'CmdOrCtrl+Enter')).toBe(true)
  })

  it('does not treat Cmd+Enter and Ctrl+Enter as the same key', () => {
    expect(acceleratorsConflict('Cmd+Enter', 'Ctrl+Enter')).toBe(false)
  })
})

describe('keyEventToAccelerator', () => {
  it('rejects bare Enter unless allowed', () => {
    const enter = keyEvent({ key: 'Enter' })
    expect(keyEventToAccelerator(enter)).toBeNull()
    expect(keyEventToAccelerator(enter, { allowBareEnter: true })).toBe('Enter')
  })

  it('records CmdOrCtrl+Enter', () => {
    expect(keyEventToAccelerator(keyEvent({ key: 'Enter', metaKey: true }))).toBe('CmdOrCtrl+Enter')
    expect(keyEventToAccelerator(keyEvent({ key: 'Enter', ctrlKey: true }))).toBe('CmdOrCtrl+Enter')
  })
})

describe('formatAccelerator', () => {
  it('keeps Enter readable', () => {
    const label = formatAccelerator('Enter')
    expect(label === 'Enter' || label === '↵').toBe(true)
  })
})

describe('resolveComposerChord', () => {
  it('prefers queue when both would match', () => {
    const event = keyEvent({ key: 'Enter', metaKey: true })
    expect(resolveComposerChord(event, 'CmdOrCtrl+Enter', 'Cmd+Enter')).toBe('queue')
  })

  it('returns send when only send matches', () => {
    expect(resolveComposerChord(keyEvent({ key: 'Enter' }), 'Enter', 'Cmd+Enter')).toBe('send')
  })

  it('returns null when neither matches', () => {
    expect(resolveComposerChord(keyEvent({ key: 'Enter', shiftKey: true }), 'Enter', 'Cmd+Enter')).toBeNull()
  })
})

describe('decorateShortcut', () => {
  it('omits the wrap when the label is empty', () => {
    expect(decorateShortcut('', '（%s）')).toBe('')
    expect(decorateShortcut('↵', '（%s）')).toBe('（↵）')
  })

  it('treats the label as plain text, including $', () => {
    expect(decorateShortcut('$', '（%s）')).toBe('（$）')
    expect(decorateShortcut('⌘$', '（%s）')).toBe('（⌘$）')
  })
})
