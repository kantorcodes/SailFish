import { describe, expect, it } from 'vitest'
import {
  coalescePendingHandoff,
  decideFollowUpDrain,
  mergePendingIntoQueue,
} from '../follow-up-drain'

describe('decideFollowUpDrain', () => {
  const idle = { hasQueued: true, headEditing: false, tabAlive: true, agentRunning: false }

  it('上一轮已经空闲时开下一轮', () => {
    expect(decideFollowUpDrain(idle)).toBe('start')
  })

  it('界面还显示在忙时把队列留着，等空闲后再开', () => {
    expect(decideFollowUpDrain({ ...idle, agentRunning: true })).toBe('wait')
  })

  it('正在改、页关了、或队列空了，这一拍不动', () => {
    expect(decideFollowUpDrain({ ...idle, headEditing: true })).toBe('stop')
    expect(decideFollowUpDrain({ ...idle, tabAlive: false })).toBe('stop')
    expect(decideFollowUpDrain({ ...idle, hasQueued: false })).toBe('stop')
  })
})

describe('coalescePendingHandoff', () => {
  it('旧的纯文字也能收成下一轮', () => {
    expect(coalescePendingHandoff(['你这个图画的一般啊'])).toEqual({
      message: '你这个图画的一般啊',
    })
  })

  it('图和附件跟文字一起留下', () => {
    const handoff = coalescePendingHandoff([{
      message: '你这个图画的一般啊',
      images: ['data:image/png;base64,abc'],
      attachments: [{ filename: 'image.png', fileSize: 131600, fileType: 'png' }],
    }])
    expect(handoff?.message).toBe('你这个图画的一般啊')
    expect(handoff?.images).toEqual(['data:image/png;base64,abc'])
    expect(handoff?.attachments?.[0]?.filename).toBe('image.png')
  })

  it('只有空白时不开下一轮', () => {
    expect(coalescePendingHandoff(['  ', { message: '' }])).toBeNull()
  })
})

describe('mergePendingIntoQueue', () => {
  it('同一句已经在队首时，把缺的图补上，不另起一条', () => {
    const queue = [{ id: 'q1', message: '你这个图画的一般啊' }]
    const pending = coalescePendingHandoff([{
      message: '你这个图画的一般啊',
      images: ['data:image/png;base64,abc'],
    }])!
    const merged = mergePendingIntoQueue(queue, pending, (item) => ({ id: 'new', ...item }))
    expect(merged).toHaveLength(1)
    expect(merged[0]?.images).toEqual(['data:image/png;base64,abc'])
    expect(merged[0]?.previewImages).toEqual(['data:image/png;base64,abc'])
  })

  it('不是同一句时插到队首', () => {
    const queue = [{ id: 'q1', message: '后面那条' }]
    const pending = coalescePendingHandoff(['先说这句'])!
    const merged = mergePendingIntoQueue(queue, pending, (item) => ({ id: 'new', ...item }))
    expect(merged.map(item => item.message)).toEqual(['先说这句', '后面那条'])
  })
})
