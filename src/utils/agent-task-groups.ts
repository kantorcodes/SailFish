/**
 * 把步骤流按用户任务切成画面上的一组组。
 * 任务已经结束后再出现的压缩过程，跟在收场后面，不塞回上一场过程里。
 */
import type { AgentStep, AttachmentInfo } from '@shared/types'

export interface AgentTaskGroupDraft {
  id: string
  index: number
  userTask: string
  images?: string[]
  attachments?: AttachmentInfo[]
  steps: AgentStep[]
  afterEndSteps: AgentStep[]
  finalResult?: string
  isProactive?: boolean
  isOnboarding?: boolean
}

const AFTER_END_STEP_TYPES = new Set(['tool_call', 'tool_result', 'thinking'])

export function groupAgentSteps(allSteps: readonly AgentStep[]): {
  groups: AgentTaskGroupDraft[]
  orphanedStepCount: number
} {
  const groups: AgentTaskGroupDraft[] = []
  let currentGroup: AgentTaskGroupDraft | null = null
  let orphanedStepCount = 0
  let leadingSupplements: AgentStep[] = []

  for (const step of allSteps) {
    if (step.type === 'user_task') {
      const isProactive = step.content === '__proactive__'
      const isOnboarding = step.content === '__onboarding__'
      currentGroup = {
        id: step.id,
        index: groups.length,
        userTask: (isProactive || isOnboarding) ? '' : step.content,
        images: step.images,
        attachments: step.attachments,
        steps: [...leadingSupplements],
        afterEndSteps: [],
        isProactive,
        isOnboarding,
      }
      leadingSupplements = []
      groups.push(currentGroup)
    } else if (step.type === 'final_result') {
      if (currentGroup) {
        currentGroup.finalResult = step.content
        currentGroup = null
      }
    } else if (step.type === 'user_supplement' && !currentGroup) {
      leadingSupplements.push(step)
    } else if (step.type === 'proactive_notice') {
      if (currentGroup) {
        currentGroup.steps.push(step)
      } else {
        groups.push({
          id: step.id,
          index: groups.length,
          userTask: '',
          steps: [],
          afterEndSteps: [],
          isProactive: true,
          isOnboarding: false,
          finalResult: step.content,
        })
      }
    } else if (step.type !== 'confirm') {
      if (currentGroup) {
        currentGroup.steps.push(step)
      } else if (groups.length > 0 && AFTER_END_STEP_TYPES.has(step.type)) {
        groups[groups.length - 1].afterEndSteps.push(step)
      } else {
        orphanedStepCount++
      }
    }
  }

  return { groups, orphanedStepCount }
}
