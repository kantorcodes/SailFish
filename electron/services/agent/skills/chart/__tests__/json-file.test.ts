import { describe, it, expect } from 'vitest'
import { readChartJsonFile, resolveExclusiveSource, summarizeChartJson } from '../json-file'

describe('resolveExclusiveSource', () => {
  it('只给内联', () => {
    expect(resolveExclusiveSource({ a: 1 }, undefined)).toEqual({ kind: 'inline' })
  })

  it('只给路径', () => {
    expect(resolveExclusiveSource(undefined, '/tmp/a.json')).toEqual({
      kind: 'file',
      path: '/tmp/a.json'
    })
  })

  it('两个都空', () => {
    expect(resolveExclusiveSource(undefined, '')).toEqual({ kind: 'error', reason: 'neither' })
    expect(resolveExclusiveSource(null, '  ')).toEqual({ kind: 'error', reason: 'neither' })
  })

  it('两个都给', () => {
    expect(resolveExclusiveSource({ a: 1 }, '/tmp/a.json')).toEqual({ kind: 'error', reason: 'both' })
  })
})

describe('readChartJsonFile', () => {
  it('相对路径直接拒绝，不按进程工作目录乱拼', async () => {
    await expect(readChartJsonFile('data.json')).rejects.toThrow(/绝对路径|absolute/i)
  })
})

describe('summarizeChartJson', () => {
  it('对象只报字段和数组长度，不带正文', () => {
    const value = {
      categories: ['2024-01-01', '2024-01-02'],
      values: [[1, 2, 3, 4]],
      secret: 'DO_NOT_LEAK'
    }
    const summary = summarizeChartJson('/tmp/k.json', 100, 'abc', value)
    expect(summary.keys).toEqual(['categories', 'values', 'secret'])
    expect(summary.arrayLengths).toEqual({ categories: 2, values: 1 })
    expect(JSON.stringify(summary)).not.toContain('DO_NOT_LEAK')
    expect(JSON.stringify(summary)).not.toContain('2024-01-01')
  })

  it('数组只报条数和首条字段', () => {
    const value = [{ name: 'A', value: 99 }, { name: 'B', value: 1 }]
    const summary = summarizeChartJson('/tmp/p.json', 40, 'def', value)
    expect(summary.root).toBe('array')
    expect(summary.length).toBe(2)
    expect(summary.itemKeys).toEqual(['name', 'value'])
    expect(JSON.stringify(summary)).not.toContain('99')
  })
})
