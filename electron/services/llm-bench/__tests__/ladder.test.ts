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

  it('自定义档只打不超过窗口的', () => {
    const ladder = resolveBenchLadder({ contextLength: 128_000 }, [1000, 1000, -3, 200_000])
    expect(ladder.rungs.map(r => r.targetChars)).toEqual([1000, 200_000])
    expect(ladder.rungs[0].skipReason).toBeUndefined()
    expect(ladder.rungs[1].skipReason).toBe('exceeds_window')
  })
})
