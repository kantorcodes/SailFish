import { describe, it, expect } from 'vitest'
import type { AiMessage } from '../../ai.service'
import {
  REPEATED_TOOL_OUTPUT_MIN_CHARS,
  collapseRepeatedToolOutputs,
  reduceRepeatedToolOutput
} from '../repeated-tool-output'

const big = 'K'.repeat(REPEATED_TOOL_OUTPUT_MIN_CHARS)

function toolMsg(id: string, content: string): AiMessage {
  return { role: 'tool', tool_call_id: id, content }
}

describe('reduceRepeatedToolOutput', () => {
  it('当前对话里已有相同大段原文 → 只回引用', () => {
    const result = reduceRepeatedToolOutput(
      [toolMsg('call-1', big)],
      { success: true, output: big }
    )
    expect(result.success).toBe(true)
    expect(result.output).not.toBe(big)
    expect(result.output).toContain('call-1')
    expect(result.output).toContain(String(big.length))
    expect(result.output.length).toBeLessThan(big.length)
  })

  it('原文已被拿走 → 仍全文返回', () => {
    const result = reduceRepeatedToolOutput(
      [{ role: 'assistant', content: '早期对话已压缩' }],
      { success: true, output: big }
    )
    expect(result.output).toBe(big)
  })

  it('内容和上次不一样 → 仍全文返回', () => {
    const result = reduceRepeatedToolOutput(
      [toolMsg('call-1', big)],
      { success: true, output: `${big}changed` }
    )
    expect(result.output).toBe(`${big}changed`)
  })

  it('不够长 → 不改成引用', () => {
    const short = 'tiny'
    const result = reduceRepeatedToolOutput(
      [toolMsg('call-1', short)],
      { success: true, output: short }
    )
    expect(result.output).toBe(short)
  })

  it('失败结果不处理', () => {
    const result = reduceRepeatedToolOutput(
      [toolMsg('call-1', big)],
      { success: false, output: big, error: 'nope' }
    )
    expect(result.output).toBe(big)
  })
})

describe('collapseRepeatedToolOutputs', () => {
  it('同一批两份相同大段、对话里还没有 → 第一份全文，第二份引用', () => {
    const items = [
      { id: 'c1', result: { success: true, output: big } },
      { id: 'c2', result: { success: true, output: big } }
    ]
    const [first, second] = collapseRepeatedToolOutputs([], items)
    expect(first).toBe(items[0].result)
    expect(first.output).toBe(big)
    expect(second).not.toBe(items[1].result)
    expect(second.output).not.toBe(big)
    expect(second.output).toContain('c1')
    expect(second.output).toContain(String(big.length))
  })

  it('同一批三份相同 → 后两份都引用第一份', () => {
    const [first, second, third] = collapseRepeatedToolOutputs([], [
      { id: 'c1', result: { success: true, output: big } },
      { id: 'c2', result: { success: true, output: big } },
      { id: 'c3', result: { success: true, output: big } }
    ])
    expect(first.output).toBe(big)
    expect(second.output).toContain('c1')
    expect(third.output).toContain('c1')
  })

  it('同一批两份内容不同 → 都全文', () => {
    const other = 'Z'.repeat(REPEATED_TOOL_OUTPUT_MIN_CHARS)
    const [first, second] = collapseRepeatedToolOutputs([], [
      { id: 'c1', result: { success: true, output: big } },
      { id: 'c2', result: { success: true, output: other } }
    ])
    expect(first.output).toBe(big)
    expect(second.output).toBe(other)
  })
})
