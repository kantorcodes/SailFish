import { describe, expect, it } from 'vitest'
import { scoreBenchReport, scoreContext, scoreOutput, scoreTools } from '../score'
import type { BenchRungResult } from '../types'

function okRung(over: Partial<BenchRungResult> = {}): BenchRungResult {
  return {
    targetChars: 4_000,
    actualChars: 4_000,
    estimatedTokens: 3_000,
    status: 'ok',
    success: true,
    totalMs: 400,
    rateLimited: false,
    truncated: false,
    ...over,
  }
}

describe('llm-bench score', () => {
  it('跳过和失败按零', () => {
    expect(scoreContext([
      okRung({ targetChars: 4_000, totalMs: 400 }),
      { ...okRung({ targetChars: 128_000 }), status: 'skipped', success: false, skipReason: 'exceeds_window', totalMs: undefined },
    ])).toBeGreaterThan(0)
    expect(scoreContext([
      { ...okRung(), status: 'error', success: false, rateLimited: true },
    ])).toBe(0)
  })

  it('一项为零则总分为零', () => {
    const score = scoreBenchReport({
      rungs: [okRung({ outputChars: 80, outputCharsPerSec: 80 })],
      tools: {
        call: { ...okRung(), calledTool: false, status: 'error', success: false, error: 'no_tool_call' },
        after: { ...okRung(), status: 'skipped', success: false },
      },
      concurrency: { lanes: [okRung(), okRung(), okRung()], okCount: 3, rateLimitedCount: 0 },
    })
    expect(score.tools).toBe(0)
    expect(score.total).toBe(0)
  })

  it('四项都过才有总分，更快分更高', () => {
    const toolsOk = {
      call: { ...okRung(), calledTool: true, toolName: 'read_file', totalMs: 300 },
      after: { ...okRung(), totalMs: 200 },
    }
    const slower = scoreBenchReport({
      rungs: [okRung({ totalMs: 800, outputChars: 40, outputCharsPerSec: 20 })],
      tools: { call: { ...toolsOk.call, totalMs: 800 }, after: { ...toolsOk.after, totalMs: 800 } },
      concurrency: { lanes: [okRung({ totalMs: 800 }), okRung({ totalMs: 800 }), okRung({ totalMs: 800 })], okCount: 3, rateLimitedCount: 0 },
    })
    const faster = scoreBenchReport({
      rungs: [okRung({ totalMs: 200, outputChars: 80, outputCharsPerSec: 80 })],
      tools: toolsOk,
      concurrency: { lanes: [okRung({ totalMs: 200 }), okRung({ totalMs: 200 }), okRung({ totalMs: 200 })], okCount: 3, rateLimitedCount: 0 },
    })
    expect(faster.total).toBeGreaterThan(slower.total)
    expect(faster.context).toBeGreaterThan(0)
    expect(faster.output).toBeGreaterThan(0)
    expect(faster.tools).toBeGreaterThan(0)
    expect(faster.concurrency).toBeGreaterThan(0)
    expect(scoreOutput([{ ...okRung(), outputChars: 0, outputCharsPerSec: 0, status: 'error', success: false }])).toBe(0)
    expect(scoreTools(undefined)).toBe(0)
  })
})
