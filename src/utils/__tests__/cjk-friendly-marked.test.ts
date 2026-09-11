import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { applyCjkFriendlyMarkdown } from '../cjk-friendly-marked'

applyCjkFriendlyMarkdown()

function parse(text: string): string {
  return marked.parse(text, { async: false }) as string
}

describe('cjk-friendly marked', () => {
  it('bolds when ** sits against CJK punctuation then the next character', () => {
    const html = parse('在于——**我隐造了一个主从关系，多设计了一套「编排机制」。**跨系统')
    expect(html).toContain('<strong>我隐造了一个主从关系，多设计了一套「编排机制」。</strong>跨系统')
    expect(html).not.toContain('**')
  })

  it('still bolds ordinary spaced and end-of-line emphasis', () => {
    expect(parse('这是 **重点** 后面')).toContain('<strong>重点</strong>')
    expect(parse('替代的是**系统里那部分工作**')).toContain('<strong>系统里那部分工作</strong>')
  })

  it('does not treat leftover stars in code, snake_case, or math-like text as bold', () => {
    expect(parse('`**代码**`')).toContain('<code>**代码**</code>')
    expect(parse('snake_case_name')).not.toContain('<em>')
    expect(parse('2 ** 8 = 256')).not.toContain('<strong>')
  })

  it('leaves GFM strikethrough intact next to CJK', () => {
    expect(parse('~~删除~~中文')).toContain('<del>删除</del>中文')
  })

  it('is safe to apply more than once', () => {
    applyCjkFriendlyMarkdown()
    applyCjkFriendlyMarkdown()
    const html = parse('——**加粗。**后面')
    expect(html).toContain('<strong>加粗。</strong>后面')
    expect(html.match(/<strong>/g)?.length).toBe(1)
  })
})
