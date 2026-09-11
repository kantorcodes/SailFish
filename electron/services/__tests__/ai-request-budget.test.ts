import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONTEXT_LENGTH,
  REQUEST_SAFETY_MARGIN_TOKENS,
  SUMMARY_MAX_OUTPUT_TOKENS,
  resolveRequestBudget
} from '../ai-request-budget'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../ai.service'

describe('resolveRequestBudget', () => {
  it('无配置 → 保守窗口，输出不超过窗口四分之一', () => {
    const budget = resolveRequestBudget()
    expect(budget.contextLength).toBe(DEFAULT_CONTEXT_LENGTH)
    expect(budget.outputTokens).toBe(Math.min(DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_CONTEXT_LENGTH / 4))
    expect(budget.inputLimit).toBe(
      DEFAULT_CONTEXT_LENGTH - budget.outputTokens - REQUEST_SAFETY_MARGIN_TOKENS
    )
  })

  it('略大于默认输出的窗口不出现输入断崖', () => {
    const a = resolveRequestBudget({ contextLength: 33_792 })
    const b = resolveRequestBudget({ contextLength: 33_793 })
    expect(a.inputLimit).toBeGreaterThan(20_000)
    expect(b.inputLimit).toBeGreaterThan(20_000)
    expect(Math.abs(a.inputLimit - b.inputLimit)).toBeLessThan(100)
  })

  it('小窗口未指定输出 → 输出不超过窗口的四分之一', () => {
    const budget = resolveRequestBudget({ contextLength: 32_000 })
    expect(budget.outputTokens).toBe(8_000)
    expect(budget.inputLimit).toBe(32_000 - 8_000 - REQUEST_SAFETY_MARGIN_TOKENS)
  })

  it('指定输出覆盖配置', () => {
    const budget = resolveRequestBudget(
      { contextLength: 128_000, maxOutputTokens: 16_000 },
      SUMMARY_MAX_OUTPUT_TOKENS
    )
    expect(budget.outputTokens).toBe(SUMMARY_MAX_OUTPUT_TOKENS)
    expect(budget.inputLimit).toBe(128_000 - SUMMARY_MAX_OUTPUT_TOKENS - REQUEST_SAFETY_MARGIN_TOKENS)
  })

  it('输出加余量超过窗口时输入至少留 1', () => {
    const budget = resolveRequestBudget({ contextLength: 1000, maxOutputTokens: 4000 })
    expect(budget.inputLimit).toBe(1)
  })
})
