import { describe, expect, it, vi } from 'vitest'
import type { AgentStep } from '@shared/types'
import { checkContext, compressContext, dispatchContext, resolveContextAction } from '../tools/context'
import type { ToolExecutorConfig } from '../tools/types'

function makeExecutor(overrides?: Partial<ToolExecutorConfig>): ToolExecutorConfig {
  const steps: AgentStep[] = []
  return {
    addStep: (step) => {
      const created = { id: `s${steps.length}`, timestamp: Date.now(), ...step } as AgentStep
      steps.push(created)
      return created
    },
    updateStep: vi.fn(),
    removeStep: vi.fn(),
    getContextUsage: () => ({ used: 12_000, total: 128_000, remaining: 116_000 }),
    compressCurrentContext: vi.fn().mockReturnValue({
      beforeTokens: 20_000,
      afterTokens: 8_000,
      freedTokens: 12_000,
      archiveId: 'ca-1',
      keepRecent: 4
    }),
    ...overrides
  } as ToolExecutorConfig
}

describe('dispatchContext', () => {
  it('check 或省略 action 时只报数', () => {
    const executor = makeExecutor()
    const checked = dispatchContext({ action: 'check' }, executor)
    expect(checked.success).toBe(true)
    expect(checked.output).toContain('12,000')
    expect(checked.output).not.toContain('该压缩')

    const implicit = dispatchContext({}, makeExecutor())
    expect(implicit.success).toBe(true)
    expect(implicit.output).toContain('116,000')
  })

  it('compress 或只带 summary 时走压缩', () => {
    const executor = makeExecutor()
    const result = dispatchContext({
      action: 'compress',
      summary: '目标：写报告。进度：探完。结论：用 A 方案。下一步：起草。'
    }, executor)
    expect(result.success).toBe(true)
    expect(executor.compressCurrentContext).toHaveBeenCalled()
    expect(result.output).toContain('ca-1')

    const inferred = dispatchContext({ summary: '只带小结也当压缩' }, makeExecutor())
    expect(inferred.success).toBe(true)
  })

  it('未知 action 报错', () => {
    const result = dispatchContext({ action: 'wipe' }, makeExecutor())
    expect(result.success).toBe(false)
    expect(result.error).toContain('wipe')
  })

  it('action 大小写不敏感；compress 漏 summary 会留下步骤', () => {
    expect(resolveContextAction({ action: 'Compress', summary: '交接' })).toBe('compress')
    const steps: unknown[] = []
    const executor = makeExecutor({
      addStep: (step) => {
        const created = { id: `s${steps.length}`, timestamp: Date.now(), ...step }
        steps.push(created)
        return created as never
      }
    })
    const result = dispatchContext({ action: 'compress' }, executor)
    expect(result.success).toBe(false)
    expect(result.error).toContain('summary')
    expect(steps.length).toBeGreaterThanOrEqual(2)
  })
})

describe('旧工具名仍可用', () => {
  it('checkContext / compressContext 各自还能单独调用', () => {
    expect(checkContext(makeExecutor()).success).toBe(true)
    expect(compressContext({ summary: '交接' }, makeExecutor()).success).toBe(true)
  })
})
