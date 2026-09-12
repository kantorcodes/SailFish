import { describe, expect, it } from 'vitest'
import type { AgentStep } from '@shared/types'
import { groupAgentSteps } from './agent-task-groups'

let seq = 0
function step(partial: Partial<AgentStep> & Pick<AgentStep, 'type' | 'content'>): AgentStep {
  seq += 1
  return {
    id: partial.id ?? `s${seq}`,
    timestamp: seq * 1000,
    ...partial,
  }
}

describe('groupAgentSteps', () => {
  it('puts a user-requested compact after the ended task as a new turn', () => {
    const { groups } = groupAgentSteps([
      step({ type: 'user_task', content: '说个任务' }),
      step({ type: 'error', content: '上下文超出模型限制' }),
      step({ type: 'final_result', content: '❌ 任务失败' }),
      step({ id: 'compact-user', type: 'user_task', content: '压缩上下文' }),
      step({ id: 'compact-think', type: 'thinking', content: '正在压缩上下文' }),
      step({ id: 'compact-tool', type: 'tool_call', content: '压缩上下文', toolName: 'compress_context' }),
      step({ type: 'final_result', content: '已压缩' }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0].userTask).toBe('说个任务')
    expect(groups[0].finalResult).toBe('❌ 任务失败')
    expect(groups[0].afterEndSteps).toEqual([])
    expect(groups[1].userTask).toBe('压缩上下文')
    expect(groups[1].steps.map(s => s.id)).toEqual(['compact-think', 'compact-tool'])
    expect(groups[1].finalResult).toBe('已压缩')
  })

  it('keeps in-task compact inside the running task', () => {
    const { groups } = groupAgentSteps([
      step({ type: 'user_task', content: '继续' }),
      step({ id: 'mid-compact', type: 'tool_call', content: '压缩上下文', toolName: 'compress_context' }),
      step({ type: 'message', content: '接着做' }),
    ])

    expect(groups[0].steps.map(s => s.id)).toEqual(['mid-compact', groups[0].steps[1].id])
    expect(groups[0].afterEndSteps).toEqual([])
  })

  it('keeps orphan post-task process after the ended task, not inside it', () => {
    const { groups } = groupAgentSteps([
      step({ type: 'user_task', content: '先做完' }),
      step({ type: 'message', content: '好了' }),
      step({ type: 'final_result', content: '完成' }),
      step({ type: 'thinking', content: '正在压缩上下文' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].userTask).toBe('先做完')
    expect(groups[0].afterEndSteps).toHaveLength(1)
  })
})
