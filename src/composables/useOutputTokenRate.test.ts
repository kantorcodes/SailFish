import { describe, expect, it } from 'vitest'
import {
  computeTokenRate,
  createOutputRateTracker,
  formatTokenRate,
  OUTPUT_RATE_MIN_ELAPSED_MS,
} from './useOutputTokenRate'

describe('formatTokenRate', () => {
  it('小于 10 留一位小数', () => {
    expect(formatTokenRate(3.24)).toBe('3.2')
  })

  it('大于等于 10 取整', () => {
    expect(formatTokenRate(42.4)).toBe('42')
  })

  it('非正数不显示', () => {
    expect(formatTokenRate(0)).toBe('')
    expect(formatTokenRate(-1)).toBe('')
  })
})

describe('computeTokenRate', () => {
  it('开口太短不报', () => {
    expect(computeTokenRate(80, OUTPUT_RATE_MIN_ELAPSED_MS - 1)).toBeNull()
  })

  it('按秒换算', () => {
    expect(computeTokenRate(80, 1000)).toBe(80)
    expect(computeTokenRate(150, 2000)).toBe(75)
  })
})

describe('createOutputRateTracker', () => {
  it('已有存量时不会把旧账当成这一段', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(10_000)
    expect(tracker.ingest(10_000, 0)).toEqual({ kind: null, rate: null })
  })

  it('吐字中跟上速度，停住后留下平均', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(1000)
    expect(tracker.ingest(1100, 1000)).toEqual({ kind: null, rate: null })
    expect(tracker.ingest(1300, 2000)).toEqual({ kind: 'live', rate: 300 })
    expect(tracker.settle()).toEqual({ kind: 'avg', rate: 300 })
  })

  it('只跳一次数字时，用停住的时刻算平均', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(231, 1000)
    expect(tracker.settle()).toEqual({ kind: null, rate: null })
    tracker.reset(0)
    tracker.ingest(231, 1000)
    expect(tracker.settle(2200)).toEqual({ kind: 'avg', rate: 192.5 })
  })

  it('首包之后用墙上时钟也能出价', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(80, 0)
    expect(tracker.tick(200)).toEqual({ kind: 'live', rate: 400 })
  })

  it('停住后再吐字另起一段', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(200, 0)
    expect(tracker.ingest(400, 1000)).toEqual({ kind: 'live', rate: 400 })
    expect(tracker.settle()).toEqual({ kind: 'avg', rate: 400 })
    expect(tracker.ingest(460, 2500).kind).toBe('avg')
    expect(tracker.ingest(520, 3000)).toEqual({ kind: 'live', rate: 240 })
  })

  it('数字回零就清空', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(80, 1000)
    expect(tracker.ingest(0, 1500)).toEqual({ kind: null, rate: null })
  })

  it('估算回纠变小不清空已有速度', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(2500, 0)
    expect(tracker.tick(1000)).toEqual({ kind: 'live', rate: 2500 })
    const corrected = tracker.ingest(2333, 1100)
    expect(corrected.kind).toBe('live')
    expect(corrected.rate).not.toBeNull()
    expect(tracker.settle(1100).kind).toBe('avg')
  })

  it('已经有实时速度时，settle 至少改成均速', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.ingest(80, 0)
    expect(tracker.tick(200)).toEqual({ kind: 'live', rate: 400 })
    expect(tracker.settle()).toEqual({ kind: 'avg', rate: 400 })
  })

  it('这场只在收尾跳一次数字，用开跑到停住的时间算平均', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(0)
    tracker.markRunStart(0, 0)
    tracker.ingest(2333, 3000)
    expect(tracker.settle(3000)).toEqual({ kind: 'avg', rate: 2333 / 3 })
  })

  it('还没开口就 settle 不变', () => {
    const tracker = createOutputRateTracker()
    tracker.reset(50)
    expect(tracker.settle()).toEqual({ kind: null, rate: null })
  })
})
