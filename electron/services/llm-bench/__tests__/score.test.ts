import { describe, expect, it } from 'vitest'
import { scoreBenchReport, scoreConcurrency, scoreContext, scoreOutput, scoreTools } from '../score'
import type { BenchRungResult } from '../types'

function okRung(over: Partial<BenchRungResult> = {}): BenchRungResult {
  return {
    targetChars: 4_000,
    actualChars: 4_000,
    estimatedTokens: 3_000,
    status: 'ok',
    success: true,
    ttftMs: 200,
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
      concurrency: { lanes: [okRung({ ttftMs: 800 }), okRung({ ttftMs: 800 }), okRung({ ttftMs: 800 })], okCount: 3, rateLimitedCount: 0 },
    })
    const faster = scoreBenchReport({
      rungs: [okRung({ totalMs: 200, outputChars: 80, outputCharsPerSec: 80 })],
      tools: toolsOk,
      concurrency: { lanes: [okRung({ ttftMs: 200 }), okRung({ ttftMs: 200 }), okRung({ ttftMs: 200 })], okCount: 3, rateLimitedCount: 0 },
    })
    expect(faster.total).toBeGreaterThan(slower.total)
    expect(faster.context).toBeGreaterThan(0)
    expect(faster.output).toBeGreaterThan(0)
    expect(faster.tools).toBeGreaterThan(0)
    expect(faster.concurrency).toBeGreaterThan(0)
    expect(scoreOutput([{ ...okRung(), outputChars: 0, outputCharsPerSec: 0, status: 'error', success: false }])).toBe(0)
    expect(scoreTools(undefined)).toBe(0)
  })

  it('并发看最慢一路的首字，写多写少不影响', () => {
    const lanes = (over: Partial<BenchRungResult>) => ({
      lanes: [okRung(), okRung(), okRung({ ttftMs: 300, ...over })],
      okCount: 3,
      rateLimitedCount: 0,
    })
    const short = scoreConcurrency(lanes({ outputChars: 2, totalMs: 320 }))
    const long = scoreConcurrency(lanes({ outputChars: 900, totalMs: 4_000 }))
    expect(short).toBe(long)
    expect(scoreConcurrency(lanes({ ttftMs: 1_200 }))).toBeLessThan(short)
  })

  it('四项落在同一量级，不让一项把总分带偏', () => {
    // 参照一次真机数据：五档写速合计约 2800 字/秒，工具往返约 1.8 秒，最慢一路首字 682ms
    const rungs = [
      okRung({ targetChars: 4_000, totalMs: 1_391, ttftMs: 960, outputChars: 182, outputCharsPerSec: 422 }),
      okRung({ targetChars: 16_000, totalMs: 1_349, ttftMs: 607, outputChars: 182, outputCharsPerSec: 662 }),
      okRung({ targetChars: 32_000, totalMs: 2_529, ttftMs: 611, outputChars: 182, outputCharsPerSec: 709 }),
      okRung({ targetChars: 64_000, totalMs: 2_568, ttftMs: 1_168, outputChars: 182, outputCharsPerSec: 540 }),
      okRung({ targetChars: 128_000, totalMs: 3_147, ttftMs: 2_029, outputChars: 182, outputCharsPerSec: 493 }),
    ]
    const score = scoreBenchReport({
      rungs,
      tools: {
        call: { ...okRung(), calledTool: true, toolName: 'read_file', totalMs: 849 },
        after: { ...okRung(), totalMs: 914 },
      },
      concurrency: {
        lanes: [okRung({ ttftMs: 451 }), okRung({ ttftMs: 547 }), okRung({ ttftMs: 682 })],
        okCount: 3,
        rateLimitedCount: 0,
      },
    })
    const parts = [score.context, score.output, score.tools, score.concurrency]
    for (const part of parts) expect(part).toBeGreaterThan(0)
    // 四项要落在同一量级：最高不该是最低的十倍以上，否则一项就把几何平均带偏
    expect(Math.max(...parts) / Math.min(...parts)).toBeLessThan(10)
    expect(score.total).toBeGreaterThan(300)
  })
})
