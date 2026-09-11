import { describe, expect, it } from 'vitest'
import {
  exactSlashCommand,
  matchSlashCommands,
  parseLeadingSlash,
  primarySlashName
} from '../slash-commands'

describe('parseLeadingSlash', () => {
  it('只认开头的斜杠', () => {
    expect(parseLeadingSlash('hello /compact')).toBeNull()
    expect(parseLeadingSlash('/compact')).toEqual({ raw: '/compact', name: 'compact', rest: '' })
    expect(parseLeadingSlash('/压缩 重点留部署')).toEqual({
      raw: '/压缩',
      name: '压缩',
      rest: '重点留部署'
    })
  })
})

describe('matchSlashCommands', () => {
  it('打 / 列出全部，打前缀能筛到 compact', () => {
    expect(matchSlashCommands('').map(c => c.id)).toEqual(['compact'])
    expect(matchSlashCommands('c').map(c => c.id)).toEqual(['compact'])
    expect(matchSlashCommands('压').map(c => c.id)).toEqual(['compact'])
    expect(matchSlashCommands('zzz')).toEqual([])
  })
})

describe('exactSlashCommand', () => {
  it('认 compact 和 压缩', () => {
    expect(exactSlashCommand('compact')?.id).toBe('compact')
    expect(exactSlashCommand('压缩')?.id).toBe('compact')
    expect(exactSlashCommand('c')).toBeNull()
    expect(primarySlashName(exactSlashCommand('压缩')!)).toBe('compact')
  })
})
