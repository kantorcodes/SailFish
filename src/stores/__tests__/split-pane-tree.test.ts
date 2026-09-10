/**
 * split-pane-tree 纯函数单元测试
 *
 * 覆盖：findActivePaneInLayout / replacePaneInLayout / findPaneById /
 *       getAllTerminalPanes / liftChildIntoParent / removePaneFromLayout
 *
 * 重点验证 spec 评审里指出的风险点：
 * - removePane 触发的层级压缩必须把 split 容器的 direction/children 等字段清掉
 *   （此前 Object.assign 实现会残留脏字段）
 */
import { describe, it, expect } from 'vitest'
import {
  findActivePaneInLayout,
  replacePaneInLayout,
  findPaneById,
  getAllTerminalPanes,
  liftChildIntoParent,
  removePaneFromLayout,
  splitLeafAtEdge,
  movePaneToEdge,
  findPaneByPtyId,
  edgeToSplit,
  cloneTerminalLeaf
} from '../split-pane-tree'
import type { SplitPane } from '../terminal'

function makeTerminalPane(id: string, ptyId: string, opts: Partial<SplitPane> = {}): SplitPane {
  return {
    id,
    type: 'terminal',
    ptyId,
    terminalType: 'local',
    isActive: false,
    size: 50,
    label: id,
    ...opts
  }
}

function makeSplit(id: string, direction: 'horizontal' | 'vertical', children: SplitPane[]): SplitPane {
  return {
    id,
    type: 'split',
    direction,
    children
  }
}

describe('split-pane-tree', () => {
  describe('findActivePaneInLayout', () => {
    it('returns null when no terminal is active', () => {
      const layout = makeSplit('s', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      expect(findActivePaneInLayout(layout)).toBeNull()
    })

    it('finds the active pane in a flat split', () => {
      const layout = makeSplit('s', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b', { isActive: true })
      ])
      expect(findActivePaneInLayout(layout)?.id).toBe('b')
    })

    it('finds the active pane in nested splits', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeSplit('inner', 'vertical', [
          makeTerminalPane('b', 'pty-b'),
          makeTerminalPane('c', 'pty-c', { isActive: true })
        ])
      ])
      expect(findActivePaneInLayout(layout)?.id).toBe('c')
    })

    it('treats a single terminal layout as candidate', () => {
      const layout = makeTerminalPane('only', 'pty-only', { isActive: true })
      expect(findActivePaneInLayout(layout)?.id).toBe('only')
    })
  })

  describe('findPaneById', () => {
    it('finds a terminal child', () => {
      const layout = makeSplit('s', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      expect(findPaneById(layout, 'b')?.ptyId).toBe('pty-b')
    })

    it('finds the split container itself', () => {
      const inner = makeSplit('inner', 'vertical', [
        makeTerminalPane('c', 'pty-c')
      ])
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        inner
      ])
      expect(findPaneById(layout, 'inner')).toBe(inner)
    })

    it('returns null for missing id', () => {
      const layout = makeSplit('s', 'horizontal', [
        makeTerminalPane('a', 'pty-a')
      ])
      expect(findPaneById(layout, 'nonexistent')).toBeNull()
    })
  })

  describe('replacePaneInLayout', () => {
    it('replaces a leaf pane', () => {
      const layout = makeSplit('s', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      const newPane = makeTerminalPane('a', 'pty-a-new')
      const ok = replacePaneInLayout(layout, 'a', newPane)
      expect(ok).toBe(true)
      expect(layout.children![0].ptyId).toBe('pty-a-new')
    })

    it('returns false if not found', () => {
      const layout = makeSplit('s', 'horizontal', [makeTerminalPane('a', 'pty-a')])
      const ok = replacePaneInLayout(layout, 'missing', makeTerminalPane('x', 'pty-x'))
      expect(ok).toBe(false)
    })
  })

  describe('getAllTerminalPanes', () => {
    it('flattens nested splits to a list of terminals', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeSplit('inner', 'vertical', [
          makeTerminalPane('b', 'pty-b'),
          makeTerminalPane('c', 'pty-c')
        ])
      ])
      const panes = getAllTerminalPanes(layout)
      expect(panes.map(p => p.id)).toEqual(['a', 'b', 'c'])
    })

    it('returns single terminal when layout itself is a terminal', () => {
      const t = makeTerminalPane('only', 'pty-only')
      expect(getAllTerminalPanes(t)).toEqual([t])
    })
  })

  describe('liftChildIntoParent', () => {
    it('replaces parent split fields with child terminal fields', () => {
      const parent = makeSplit('p', 'horizontal', [makeTerminalPane('c', 'pty-c')])
      const child = makeTerminalPane('c', 'pty-c', { terminalType: 'ssh', label: 'remote' })

      liftChildIntoParent(parent, child)

      // 父 id 不变，便于 vue :key 稳定
      expect(parent.id).toBe('p')
      expect(parent.type).toBe('terminal')
      expect(parent.ptyId).toBe('pty-c')
      expect(parent.terminalType).toBe('ssh')
      expect(parent.label).toBe('remote')
      // 重要：split 容器的 direction/children 必须被清除（修复 Object.assign 残留 bug）
      expect(parent.direction).toBeUndefined()
      expect(parent.children).toBeUndefined()
    })

    it('clears removed fields when child has fewer keys than parent', () => {
      const parent: SplitPane = {
        id: 'p',
        type: 'split',
        direction: 'vertical',
        children: [makeTerminalPane('c', 'pty-c')],
        // 故意带几个父节点上有但子节点上没有的字段
        size: 80
      }
      const child = makeTerminalPane('c', 'pty-c')

      liftChildIntoParent(parent, child)

      expect(parent.direction).toBeUndefined()
      expect(parent.children).toBeUndefined()
      // size 是 child 也有的字段，会被覆盖为 child.size
      expect(parent.size).toBe(child.size)
    })
  })

  describe('removePaneFromLayout', () => {
    it('removes a leaf pane and lifts the lone sibling into the parent', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])

      const ok = removePaneFromLayout(layout, 'a')
      expect(ok).toBe(true)

      // 移除 a 后只剩 b，b 被提升到 root；root.id 保持不变
      expect(layout.id).toBe('root')
      expect(layout.type).toBe('terminal')
      expect(layout.ptyId).toBe('pty-b')
      expect(layout.direction).toBeUndefined()
      expect(layout.children).toBeUndefined()
    })

    it('keeps the split container when more than 2 children remain', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b'),
        makeTerminalPane('c', 'pty-c')
      ])
      const ok = removePaneFromLayout(layout, 'b')
      expect(ok).toBe(true)
      expect(layout.type).toBe('split')
      expect(layout.children?.map(c => c.id)).toEqual(['a', 'c'])
    })

    it('removes from nested split and lifts inner remainder', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeSplit('inner', 'vertical', [
          makeTerminalPane('b', 'pty-b'),
          makeTerminalPane('c', 'pty-c')
        ])
      ])
      const ok = removePaneFromLayout(layout, 'b')
      expect(ok).toBe(true)
      // inner 提升后变为 terminal 节点（id=inner 保持），其 ptyId=pty-c
      const innerNode = layout.children![1]
      expect(innerNode.id).toBe('inner')
      expect(innerNode.type).toBe('terminal')
      expect(innerNode.ptyId).toBe('pty-c')
      expect(innerNode.direction).toBeUndefined()
      expect(innerNode.children).toBeUndefined()
    })

    it('returns false for non-existent pane', () => {
      const layout = makeSplit('root', 'horizontal', [makeTerminalPane('a', 'pty-a')])
      expect(removePaneFromLayout(layout, 'nope')).toBe(false)
    })
  })

  describe('edgeToSplit', () => {
    it('maps edges to direction and place', () => {
      expect(edgeToSplit('left')).toEqual({ direction: 'horizontal', place: 'before' })
      expect(edgeToSplit('right')).toEqual({ direction: 'horizontal', place: 'after' })
      expect(edgeToSplit('top')).toEqual({ direction: 'vertical', place: 'before' })
      expect(edgeToSplit('bottom')).toEqual({ direction: 'vertical', place: 'after' })
    })
  })

  describe('splitLeafAtEdge', () => {
    it('inserts into the same row and equalizes instead of nesting halves', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      const incoming = makeTerminalPane('c', 'pty-c')
      const ok = splitLeafAtEdge(layout, 'b', incoming, 'left', 'new-split')
      expect(ok).toBe(true)
      expect(layout.type).toBe('split')
      expect(layout.direction).toBe('horizontal')
      expect(layout.children?.map(c => c.id)).toEqual(['a', 'c', 'b'])
      expect(layout.children?.map(c => c.size)).toEqual([
        100 / 3,
        100 / 3,
        100 / 3
      ])
    })

    it('nests only when the edge is perpendicular', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      const incoming = makeTerminalPane('c', 'pty-c')
      const ok = splitLeafAtEdge(layout, 'b', incoming, 'top', 'new-split')
      expect(ok).toBe(true)
      expect(layout.children?.map(c => c.id)).toEqual(['a', 'new-split'])
      const wrapped = layout.children![1]
      expect(wrapped.type).toBe('split')
      expect(wrapped.direction).toBe('vertical')
      expect(wrapped.children?.map(c => c.id)).toEqual(['c', 'b'])
      expect(wrapped.size).toBe(50)
    })

    it('adopts a single-child wrapper and equalizes the first pair', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a', { size: 100 })
      ])
      const incoming = makeTerminalPane('b', 'pty-b')
      expect(splitLeafAtEdge(layout, 'a', incoming, 'bottom', 'unused')).toBe(true)
      expect(layout.direction).toBe('vertical')
      expect(layout.children?.map(c => c.id)).toEqual(['a', 'b'])
      expect(layout.children?.map(c => c.size)).toEqual([50, 50])
    })

    it('rewrites a lifted root leaf into a split', () => {
      const layout = makeTerminalPane('only', 'pty-only')
      const incoming = makeTerminalPane('n', 'pty-n')
      const ok = splitLeafAtEdge(layout, 'only', incoming, 'bottom', 'unused')
      expect(ok).toBe(true)
      expect(layout.type).toBe('split')
      expect(layout.direction).toBe('vertical')
      expect(layout.ptyId).toBeUndefined()
      expect(layout.children?.map(c => c.ptyId)).toEqual(['pty-only', 'pty-n'])
      expect(layout.children?.[0].id).toBe('only')
    })
  })

  describe('movePaneToEdge', () => {
    it('restyles a two-child parent instead of nesting', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      const ok = movePaneToEdge(layout, 'a', 'b', 'bottom', 'unused')
      expect(ok).toBe(true)
      expect(layout.direction).toBe('vertical')
      expect(layout.children?.map(c => c.id)).toEqual(['b', 'a'])
    })

    it('is a no-op when the pane is already on that edge', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      expect(movePaneToEdge(layout, 'a', 'b', 'left', 'unused')).toBe(false)
      expect(layout.children?.map(c => c.id)).toEqual(['a', 'b'])
    })

    it('moves a nested pane onto a cousin and finds the target by ptyId after lift', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeSplit('inner', 'vertical', [
          makeTerminalPane('b', 'pty-b'),
          makeTerminalPane('c', 'pty-c')
        ])
      ])
      const ok = movePaneToEdge(layout, 'c', 'a', 'right', 'new-split')
      expect(ok).toBe(true)
      // 去掉 c 后 inner 提升成 b（id 仍是 inner）；同一方向加在 a 右侧 → 三扇均分
      expect(findPaneByPtyId(layout, 'pty-c')?.id).toBe('c')
      expect(layout.children?.map(c => c.ptyId)).toEqual(['pty-a', 'pty-c', 'pty-b'])
      expect(layout.children?.map(c => c.size)).toEqual([
        100 / 3,
        100 / 3,
        100 / 3
      ])
    })

    it('refuses to move a pane onto itself', () => {
      const layout = makeSplit('root', 'horizontal', [
        makeTerminalPane('a', 'pty-a'),
        makeTerminalPane('b', 'pty-b')
      ])
      expect(movePaneToEdge(layout, 'a', 'a', 'right', 'unused')).toBe(false)
    })
  })

  describe('cloneTerminalLeaf', () => {
    it('copies connecting and error fields so a move keeps the handshake state', () => {
      const pane = makeTerminalPane('a', 'pty-a', {
        isConnecting: true,
        connectionError: 'timeout',
        connectAttemptId: 'attempt-1'
      })
      const cloned = cloneTerminalLeaf(pane)
      expect(cloned.isConnecting).toBe(true)
      expect(cloned.connectionError).toBe('timeout')
      expect(cloned.connectAttemptId).toBe('attempt-1')
      expect(cloned).not.toBe(pane)
    })
  })
})
