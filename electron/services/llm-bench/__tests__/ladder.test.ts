import { describe, expect, it } from 'vitest'
import { DEFAULT_BENCH_RUNGS } from '../types'
import { buildBenchRequest } from '../suite'
import { resolveBenchLadder } from '../ladder'

describe('llm-bench ladder', () => {
  it('默认只打固定五档，不自动贴窗口，估会超窗口的跳过', () => {
    const ladder = resolveBenchLadder({ contextLength: 32_000 })
    expect(ladder.contextLength).toBe(32_000)
    expect(DEFAULT_BENCH_RUNGS).toEqual([4_000, 16_000, 32_000, 64_000, 128_000])
    expect(ladder.rungs.map(r => r.targetChars)).toEqual([...DEFAULT_BENCH_RUNGS])
    expect(ladder.rungs.some(r => r.targetChars > 128_000)).toBe(false)
    for (const rung of ladder.rungs) {
      const built = buildBenchRequest(rung.targetChars)
      if (built.estimatedTokens > ladder.inputLimit) {
        expect(rung.skipReason).toBe('exceeds_window')
      } else {
        expect(rung.skipReason).toBeUndefined()
      }
    }
    expect(ladder.rungs.some(r => !r.skipReason)).toBe(true)
    expect(ladder.rungs.some(r => r.skipReason === 'exceeds_window')).toBe(true)
  })

  it('百万窗口也不自动打到边上', () => {
    const ladder = resolveBenchLadder({ contextLength: 1_000_000 })
    expect(ladder.rungs.every(r => !r.skipReason)).toBe(true)
    expect(ladder.rungs.map(r => r.targetChars)).toEqual([...DEFAULT_BENCH_RUNGS])
  })

  it('默认这套档位算标准，报告可以横比', () => {
    expect(resolveBenchLadder({ contextLength: 32_000 }).standard).toBe(true)
    // 超窗口被跳过仍算标准：那是这款模型的实情，不是题变了
    expect(resolveBenchLadder({ contextLength: 8_000 }).standard).toBe(true)
  })

  it('换了档位就不算标准，报告得自己说清只能跟同档位比', () => {
    expect(resolveBenchLadder({ contextLength: 128_000 }, [4_000]).standard).toBe(false)
    expect(resolveBenchLadder({ contextLength: 128_000 }, [4_000, 8_000, 16_000, 32_000, 64_000]).standard).toBe(false)
  })

  it('垫不进去的档位跳过，不在表上写个做不到的字数', () => {
    const ladder = resolveBenchLadder({ contextLength: 128_000 }, [100, 1000, -3, 200_000])
    expect(ladder.rungs.map(r => r.targetChars)).toEqual([100, 1000, 200_000])
    expect(ladder.rungs[0].skipReason).toBe('below_base')
    expect(ladder.rungs[1].skipReason).toBe('below_base')
    expect(ladder.rungs[2].skipReason).toBe('exceeds_window')
  })

  it('凡是没被跳过的档，真发出去的字数就等于表上那个数', () => {
    // 底稿长度随档位位数浮动，所以「短多少才算垫不进去」不能估一个常量去卡
    const ladder = resolveBenchLadder({ contextLength: 1_000_000 }, [
      1_400, 1_490, 1_495, 1_496, 1_497, 1_500, 4_000,
    ])
    for (const rung of ladder.rungs) {
      if (rung.skipReason) continue
      expect(buildBenchRequest(rung.targetChars).charCount).toBe(rung.targetChars)
    }
    expect(ladder.rungs.some(r => r.skipReason === 'below_base')).toBe(true)
    expect(ladder.rungs.some(r => !r.skipReason)).toBe(true)
  })
})
