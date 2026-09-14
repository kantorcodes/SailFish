import { describe, expect, it } from 'vitest'
import {
  exactSlashCommand,
  formatSlashInvocation,
  matchSlashCommands,
  parseLeadingSlash,
  primarySlashName,
  resolveExactSlash
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

describe('formatSlashInvocation / resolveExactSlash', () => {
  it('补全后的字可以拿去执行或排队', () => {
    const def = exactSlashCommand('压缩')!
    expect(formatSlashInvocation(def)).toBe('/compact')
    expect(formatSlashInvocation(def, '重点留部署')).toBe('/compact 重点留部署')
    expect(resolveExactSlash('/压缩 重点留部署')).toEqual({ def, hint: '重点留部署' })
    expect(resolveExactSlash('/c')).toBeNull()
    expect(resolveExactSlash('hello')).toBeNull()
  })
})
