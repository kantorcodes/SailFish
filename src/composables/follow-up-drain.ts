import type { AttachmentInfo, PendingUserHandoff, WorkbenchContext } from '@shared/types'

/** start：马上开下一轮。wait：还在忙，先留在队列里，空闲后再开。stop：这拍不动（空队列 / 正在改 / 页已关）。 */
export type FollowUpDrainDecision = 'start' | 'wait' | 'stop'

export function decideFollowUpDrain(input: {
  hasQueued: boolean
  headEditing: boolean
  tabAlive: boolean
  agentRunning: boolean
}): FollowUpDrainDecision {
  if (!input.hasQueued || !input.tabAlive || input.headEditing) return 'stop'
  if (input.agentRunning) return 'wait'
  return 'start'
}

export interface CoalescedPendingFollowUp {
  message: string
  images?: string[]
  attachments?: AttachmentInfo[]
  documentContext?: string
  workbenchContext?: WorkbenchContext
}

function isHandoff(entry: unknown): entry is PendingUserHandoff {
  return !!entry && typeof entry === 'object' && typeof (entry as PendingUserHandoff).message === 'string'
}

/** 完成事件里没吃进模型的补充，收成一条下一轮。字符串是旧形状，对象里的图和附件要留下。 */
export function coalescePendingHandoff(raw: unknown): CoalescedPendingFollowUp | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const messages: string[] = []
  const images: string[] = []
  const attachments: AttachmentInfo[] = []
  const docs: string[] = []
  let workbenchContext: WorkbenchContext | undefined
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) messages.push(entry)
      continue
    }
    if (!isHandoff(entry)) continue
    if (entry.message.trim()) messages.push(entry.message)
    if (Array.isArray(entry.images)) {
      for (const img of entry.images) {
        if (typeof img === 'string' && img) images.push(img)
      }
    }
    if (Array.isArray(entry.attachments)) {
      for (const att of entry.attachments) {
        if (att && typeof att === 'object' && typeof att.filename === 'string') attachments.push(att)
      }
    }
    if (typeof entry.documentContext === 'string' && entry.documentContext.trim()) docs.push(entry.documentContext)
    if (entry.workbenchContext && typeof entry.workbenchContext === 'object') {
      workbenchContext = entry.workbenchContext
    }
  }
  const message = messages.join('\n')
  if (!message.trim() && images.length === 0 && attachments.length === 0) return null
  return {
    message,
    ...(images.length ? { images } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(docs.length ? { documentContext: docs.join('\n\n') } : {}),
    ...(workbenchContext ? { workbenchContext } : {}),
  }
}

type QueueHead = {
  message: string
  images?: string[]
  previewImages?: string[]
  attachments?: AttachmentInfo[]
  documentContext?: string
  workbenchContext?: WorkbenchContext
}

/**
 * 收尾时带回的补充插到队首。
 * 队首已经是同一句时，不再开一条重复的；队首没带上的图，补到那一条上。
 */
export function mergePendingIntoQueue<T extends QueueHead>(
  queue: T[],
  pending: CoalescedPendingFollowUp,
  create: (pending: CoalescedPendingFollowUp) => T,
): T[] {
  const head = queue[0]
  if (!head || head.message !== pending.message) return [create(pending), ...queue]
  if (head.images?.length || !pending.images?.length) return queue
  return [{
    ...head,
    images: pending.images,
    previewImages: pending.images,
    attachments: head.attachments?.length ? head.attachments : pending.attachments,
    documentContext: head.documentContext || pending.documentContext,
    workbenchContext: head.workbenchContext || pending.workbenchContext,
  }, ...queue.slice(1)]
}
