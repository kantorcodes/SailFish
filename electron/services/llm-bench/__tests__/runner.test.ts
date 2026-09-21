import { describe, expect, it } from 'vitest'
import type { AiProfile } from '@shared/types'
import { LlmBenchRunner, type BenchAiClient } from '../runner'
import { BENCH_CONCURRENCY, BENCH_SUITE_VERSION, BENCH_TEMPERATURE } from '../types'

function fakeProfile(over: Partial<AiProfile> = {}): AiProfile {
  return {
    id: 'p1',
    name: 'local',
    apiUrl: 'http://127.0.0.1:8000/v1/chat/completions',
    apiKey: 'x',
    model: 'demo',
    contextLength: 32_000,
    ...over,
  }
}

function fakeAi(handler: BenchAiClient['chatWithToolsStream']): BenchAiClient {
  return {
    chatWithToolsStream: handler,
    abort() {},
  }
}

function smartAi(): BenchAiClient {
  return fakeAi(async (messages, _t, onChunk, onToolCall, onDone) => {
    const last = messages[messages.length - 1]
    const blob = messages.map(m => m.content || '').join('\n')
    if (last.role === 'tool') {
      onChunk('好')
      onDone({ content: '好', finish_reason: 'stop', usage: { prompt_tokens: 4200, completion_tokens: 1, total_tokens: 4201 } })
      return
    }
    if (blob.includes('sailfish-bench-probe') && last.role === 'user') {
      const calls = [{
        id: 'c1',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path":"/tmp/sailfish-bench-probe.txt"}' },
      }]
      onToolCall(calls)
      onDone({ tool_calls: calls, finish_reason: 'tool_calls', usage: { prompt_tokens: 4000, completion_tokens: 20, total_tokens: 4020 } })
      return
    }
    if (blob.includes('指定正文')) {
      onChunk('本周工作对齐如下。产品侧完成设置页改版草案。')
      onDone({
        content: '本周工作对齐如下。产品侧完成设置页改版草案。',
        finish_reason: 'stop',
        usage: { prompt_tokens: 4000, completion_tokens: 40, total_tokens: 4040 },
      })
      return
    }
    onChunk('好')
    onDone({ content: '好', finish_reason: 'stop', usage: { prompt_tokens: 4100, completion_tokens: 1, total_tokens: 4101 } })
  })
}

describe('llm-bench runner', () => {
  it('一次跑完三块：长度含写速、工具、三路并发', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })

    const report = await runner.start({ profileId: 'p1' })
    expect(report.suiteVersion).toBe(BENCH_SUITE_VERSION)
    expect(report.temperature).toBe(BENCH_TEMPERATURE)
    expect(report.rungs.some(r => r.status === 'skipped' && r.skipReason === 'exceeds_window')).toBe(true)
    const ran = report.rungs.filter(r => r.status === 'ok')
    expect(ran.length).toBeGreaterThan(0)
    expect(ran[0].ttftMs).toBeGreaterThanOrEqual(0)
    expect(ran[0].actualPromptTokens).toBe(4000)

    expect(ran.every(r => (r.outputChars ?? 0) > 0)).toBe(true)
    expect(ran[0].outputCharsPerSec).toBeGreaterThanOrEqual(0)
    expect(report.output).toBeUndefined()

    expect(report.tools?.call.calledTool).toBe(true)
    expect(report.tools?.call.toolName).toBe('read_file')
    expect(report.tools?.call.status).toBe('ok')
    expect(report.tools?.after.status).toBe('ok')

    expect(report.concurrency?.lanes).toHaveLength(BENCH_CONCURRENCY)
    expect(report.concurrency?.okCount).toBe(BENCH_CONCURRENCY)
    expect(report.score).toBeDefined()
    expect(report.score?.context).toBeGreaterThanOrEqual(0)
    expect(report.score?.total).toBeGreaterThanOrEqual(0)
  })

  it('限流按 HTTP 429 记账，不靠文案猜', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, _c, _tc, _done, onError, _id, _p, _rid, _r, _ready, _fo, opts) => {
        opts?.onHttpStatus?.(429)
        onError('rate limited')
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })

    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.rungs[0].status).toBe('error')
    expect(report.rungs[0].rateLimited).toBe(true)
    expect(report.rungs[0].httpStatus).toBe(429)
  })

  it('输出被截断记 truncated', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        onChunk('好')
        onDone({ content: '好', finish_reason: 'length' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.rungs[0].truncated).toBe(true)
    expect(report.rungs[0].success).toBe(false)
  })

  it('流被掐断记 stream_cut', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        onChunk('好')
        onDone({ content: '好' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.rungs[0].error).toBe('stream_cut')
    expect(report.rungs[0].success).toBe(false)
  })

  it('叫工具和收回来不另卡输出额度', async () => {
    const caps: Array<number | undefined> = []
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, onToolCall, onDone, _e, _id, _p, _rid, _r, _ready, _fo, opts) => {
        const last = messages[messages.length - 1]
        const blob = messages.map(m => m.content || '').join('\n')
        if (last.role === 'tool' || (blob.includes('sailfish-bench-probe') && last.role === 'user')) {
          caps.push(opts?.maxOutputTokens)
        }
        if (last.role === 'tool') {
          onChunk('好')
          onDone({ content: '好', finish_reason: 'stop' })
          return
        }
        if (blob.includes('sailfish-bench-probe') && last.role === 'user') {
          const calls = [{
            id: 'c1',
            type: 'function' as const,
            function: { name: 'read_file', arguments: '{"path":"/tmp/sailfish-bench-probe.txt"}' },
          }]
          onToolCall(calls)
          onDone({ tool_calls: calls, finish_reason: 'tool_calls' })
          return
        }
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(caps).toEqual([undefined, undefined])
  })

  it('工具轴没吐调用记 no_tool_call，后一段跳过', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone) => {
        const blob = messages.map(m => m.content || '').join('\n')
        if (blob.includes('sailfish-bench-probe')) {
          onChunk('我直接读了')
          onDone({ content: '我直接读了', finish_reason: 'stop' })
          return
        }
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.tools?.call.calledTool).toBe(false)
    expect(report.tools?.call.error).toBe('no_tool_call')
    expect(report.tools?.after.status).toBe('skipped')
  })
})
