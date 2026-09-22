import { describe, expect, it } from 'vitest'
import type { AiProfile } from '@shared/types'
import { LlmBenchRunner, type BenchAiClient } from '../runner'
import { BENCH_CONCURRENCY, BENCH_PROBE_MAX_TOKENS, BENCH_SUITE_VERSION, BENCH_TEMPERATURE, DEFAULT_BENCH_RUNGS } from '../types'
import { BENCH_OUTPUT_PASSAGE, BENCH_TOOLS } from '../suite'

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
    expect(report.passageChars).toBe(BENCH_OUTPUT_PASSAGE.length)
    expect(report.rungs.some(r => r.status === 'skipped' && r.skipReason === 'exceeds_window')).toBe(true)
    const ran = report.rungs.filter(r => r.status === 'ok')
    expect(ran.length).toBeGreaterThan(0)
    expect(ran[0].ttftMs).toBeGreaterThanOrEqual(0)
    expect(ran[0].actualPromptTokens).toBe(4000)

    expect(ran.every(r => (r.outputChars ?? 0) > 0)).toBe(true)
    expect(ran[0].outputCharsPerSec).toBeGreaterThanOrEqual(0)
    // 写速不再单列一块，只活在每一档里
    expect('output' in report).toBe(false)

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

  it('三发取中间那一发的整行，不把各个数字拼起来', async () => {
    // 三发首字 100 / 300 / 200，中间那发是第三发；整行数据必须都来自它
    const delays = [100, 300, 200]
    let nth = 0
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone) => {
        // 只数长度档的请求：工具轴和并发轴也会打，别跟着一起计数
        const isContext = (messages[0].content || '').includes('轴=context')
        const wait = isContext ? (delays[nth++] ?? 100) : 10
        await new Promise(resolve => setTimeout(resolve, wait))
        const text = '好'.repeat(wait / 10)
        onChunk(text)
        onDone({ content: text, finish_reason: 'stop', usage: { prompt_tokens: wait, completion_tokens: 1, total_tokens: wait + 1 } })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    const rung = report.rungs[0]
    expect(report.shotsPerRung).toBe(3)
    expect(rung.shots).toHaveLength(3)
    expect(rung.shotIndex).toBe(3)
    expect(rung.actualPromptTokens).toBe(200)
    expect(rung.outputChars).toBe(20)
  })

  it('三发里挂一发，这一档就没过，展示的就是挂的那一发', async () => {
    let nth = 0
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone, onError, _id, _p, _rid, _r, _ready, _fo, opts) => {
        if ((messages[0].content || '').includes('轴=context')) nth += 1
        if (nth === 2 && (messages[0].content || '').includes('轴=context')) {
          opts?.onHttpStatus?.(429)
          onError('rate limited')
          return
        }
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    const rung = report.rungs[0]
    expect(rung.success).toBe(false)
    expect(rung.status).toBe('error')
    expect(rung.rateLimited).toBe(true)
    expect(rung.shotIndex).toBe(2)
    expect(rung.shots).toHaveLength(3)
    expect(report.score?.context).toBe(0)
  })

  it('每一发都当没跑过：各发的题面互不相同，不许吃上一发的缓存', async () => {
    const prefixes: string[] = []
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone) => {
        prefixes.push((messages[0].content || '').split('\n')[0])
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    const contextPrefixes = prefixes.filter(p => p.includes('轴=context'))
    expect(new Set(contextPrefixes).size).toBe(contextPrefixes.length)
  })

  it('工具轴展示的两步来自同一发', async () => {
    let nth = 0
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone, _e, _id, _p, _rid, _r, _ready, _fo, _opts) => {
        const last = messages[messages.length - 1]
        const blob = messages.map(m => m.content || '').join('\n')
        if (last.role === 'tool') {
          onChunk('好')
          onDone({ content: '好', finish_reason: 'stop', usage: { prompt_tokens: 900 + nth, completion_tokens: 1, total_tokens: 901 } })
          return
        }
        if (blob.includes('sailfish-bench-probe')) {
          nth += 1
          await new Promise(resolve => setTimeout(resolve, nth * 50))
          const calls = [{ id: `c${nth}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }]
          onToolCallFrom(calls)
          return
          function onToolCallFrom(list: typeof calls) {
            onDone({ tool_calls: list, finish_reason: 'tool_calls', usage: { prompt_tokens: 100 * nth, completion_tokens: 1, total_tokens: 1 } })
          }
        }
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    expect(report.tools?.call.shotIndex).toBe(report.tools?.after.shotIndex)
    expect(report.tools?.call.shots).toHaveLength(3)
    expect(report.tools?.after.shots).toHaveLength(3)
  })

  it('展示挂掉那一发时，不许把上一发的首字留在行里', async () => {
    let nth = 0
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone, onError) => {
        const isContext = (messages[0].content || '').includes('轴=context')
        if (isContext) nth += 1
        if (isContext && nth === 2) {
          // 连首字都没出来就断了：这一发没有 ttft、没有 usage
          onError('stream cut')
          return
        }
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop', usage: { prompt_tokens: 777, completion_tokens: 1, total_tokens: 778 } })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    const rung = report.rungs[0]
    expect(rung.success).toBe(false)
    expect(rung.shotIndex).toBe(2)
    expect(rung.ttftMs).toBeUndefined()
    expect(rung.actualPromptTokens).toBeUndefined()
    expect(rung.outputChars).toBe(0)
  })

  it('中途停掉，已经打完的发照常保留，不整档作废', async () => {
    let calls = 0
    let stop = () => {}
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone) => {
        calls += 1
        // 第二遍刚开头就按停止：第一遍的数据必须还在
        if (calls === 11) stop()
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    stop = () => runner.stop()
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 3 })
    const rung = report.rungs[0]
    expect(rung.status).toBe('ok')
    expect(rung.shots?.length).toBeGreaterThanOrEqual(1)
    expect(report.shotsPerRung).toBeLessThan(3)
    // 被停掉的那一遍不算数，但上一遍跑出来的那一发要照常摆在表上
    expect(report.concurrency?.lanes.every(l => l.status === 'ok' && l.shots?.length)).toBe(true)
  })

  it('指定了档位却一个合法的都没有，直接报错，不悄悄跑默认档', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    await expect(runner.start({ profileId: 'p1', rungs: [Number.NaN, -3, 0] })).rejects.toThrow('bench_invalid_rungs')
  })

  it('写了不是 1/3/5 的发数就报错，不悄悄改成 3', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    await expect(runner.start({ profileId: 'p1', shots: 2 })).rejects.toThrow('bench_invalid_shots')
    await expect(runner.start({ profileId: 'p1', shots: 4 })).rejects.toThrow('bench_invalid_shots')
    expect(runner.peekStartError({ profileId: 'p1', shots: 2 })).toBe('bench_invalid_shots')
  })

  it('不带档位就跑冻住的那整套，报告记成标准档位', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', shots: 1 })
    expect(report.standardLadder).toBe(true)
    expect(report.rungs.map(r => r.targetChars)).toEqual([...DEFAULT_BENCH_RUNGS])
    const custom = await runner.start({ profileId: 'p1', rungs: [4000], shots: 1 })
    expect(custom.standardLadder).toBe(false)
  })

  it('没填窗口就不开跑，不悄悄当十二万八', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile({ contextLength: undefined })],
      getActiveProfileId: () => 'p1',
    })
    await expect(runner.start({ profileId: 'p1', shots: 1 })).rejects.toThrow('bench_window_unknown')
    expect(runner.peekStartError({ profileId: 'p1', shots: 1 })).toBe('bench_window_unknown')
  })

  it('只打一发时，行为跟从前一模一样', async () => {
    const runner = new LlmBenchRunner({
      ai: smartAi(),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 1 })
    expect(report.shotsPerRung).toBe(1)
    expect(report.rungs[0].shots).toHaveLength(1)
    expect(report.rungs[0].shotIndex).toBe(1)
    expect(report.rungs[0].status).toBe('ok')
  })

  it('并发里有一路掉头去调工具，这一项就不算过', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, onToolCall, onDone) => {
        const blob = messages.map(m => m.content || '').join('\n')
        if (blob.includes('轴=concurrency')) {
          const calls = [{ id: 'c9', type: 'function' as const, function: { name: 'exec', arguments: '{}' } }]
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
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.concurrency?.lanes.every(l => l.error === 'unexpected_tool_call')).toBe(true)
    expect(report.concurrency?.okCount).toBe(0)
    expect(report.score?.concurrency).toBe(0)
    expect(report.score?.total).toBe(0)
  })

  it('整段一次到、量不出生成时长时，写速退回按整轮算，不飙到每秒几万字', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        // 不流式的接口：等了一会儿，然后整段一次到，首字和收尾几乎同时发生
        await new Promise(resolve => setTimeout(resolve, 80))
        onChunk(BENCH_OUTPUT_PASSAGE)
        onDone({ content: BENCH_OUTPUT_PASSAGE, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    const rung = report.rungs.find(r => r.status === 'ok')
    expect(rung?.outputCharsPerSec).toBeLessThan(10_000)
  })

  it('照抄了就不标；自己发挥就标出来，但不判失败', async () => {
    const copyRunner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        onChunk(BENCH_OUTPUT_PASSAGE)
        onDone({ content: BENCH_OUTPUT_PASSAGE, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const copied = await copyRunner.start({ profileId: 'p1' })
    expect(copied.rungs.filter(r => r.status === 'ok').every(r => r.offPassage === false)).toBe(true)

    const freeRunner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        const long = BENCH_OUTPUT_PASSAGE.repeat(3)
        onChunk(long)
        onDone({ content: long, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const freestyle = await freeRunner.start({ profileId: 'p1' })
    const ran = freestyle.rungs.filter(r => r.status === 'ok')
    expect(ran.length).toBeGreaterThan(0)
    expect(ran.every(r => r.offPassage === true)).toBe(true)
    expect(ran.every(r => r.success)).toBe(true)
  })

  it('先寒暄两句再照抄不算没照抄；写了别的才算', async () => {
    const politeRunner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        const said = `好的，我来抄：\n${BENCH_OUTPUT_PASSAGE}`
        onChunk(said)
        onDone({ content: said, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const polite = await politeRunner.start({ profileId: 'p1', rungs: [4000] })
    expect(polite.rungs.find(r => r.status === 'ok')?.offPassage).toBe(false)

    const otherRunner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        // 字数跟正文相当，但根本不是那段话
        const said = '我'.repeat(BENCH_OUTPUT_PASSAGE.length)
        onChunk(said)
        onDone({ content: said, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const other = await otherRunner.start({ profileId: 'p1', rungs: [4000] })
    expect(other.rungs.find(r => r.status === 'ok')?.offPassage).toBe(true)
  })

  it('会吐思考的模型照抄了也不能被冤枉成没照抄', async () => {
    // 思考过程和它的外壳都会走 onChunk，流里数到的字数天然远超正文
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, onChunk, _tc, onDone) => {
        onChunk('<details open><summary>🤔 思考中</summary><blockquote>')
        onChunk('先确认它要我原样抄，那就别改标点。'.repeat(20))
        onChunk('</blockquote></details>')
        onChunk(BENCH_OUTPUT_PASSAGE)
        onDone({ content: BENCH_OUTPUT_PASSAGE, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1' })
    const ran = report.rungs.filter(r => r.status === 'ok')
    expect(ran.length).toBeGreaterThan(0)
    expect(ran.every(r => r.offPassage === false)).toBe(true)
    // 写速按正文算，不把思考过程算进去
    expect(ran[0].outputChars).toBe(BENCH_OUTPUT_PASSAGE.length)
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

  it('工具两步用冻住的输出额度，不听模型配置', async () => {
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
    await runner.start({ profileId: 'p1', rungs: [4000], shots: 1 })
    expect(caps).toEqual([BENCH_PROBE_MAX_TOKENS, BENCH_PROBE_MAX_TOKENS])
  })

  it('三路并发思考吃掉 64 token 也不该判假失败', async () => {
    const caps: Array<number | undefined> = []
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, onChunk, _tc, onDone, _e, _id, _p, _rid, _r, _ready, _fo, opts) => {
        const blob = messages.map(m => m.content || '').join('\n')
        if (!blob.includes('轴=concurrency')) {
          onChunk('好')
          onDone({ content: '好', finish_reason: 'stop' })
          return
        }
        caps.push(opts?.maxOutputTokens)
        // 模拟思考型：先吐一大段想，再给那一个字。额度要装得下这段思考，
        // 卡成 2048 会把真机能过的三路打成假失败。
        const thought = '想'.repeat(3_000)
        const cap = opts?.maxOutputTokens
        if (cap !== undefined && cap < thought.length) {
          onChunk(thought.slice(0, cap))
          onDone({ content: thought.slice(0, cap), finish_reason: 'length' })
          return
        }
        onChunk(thought)
        onChunk('好')
        onDone({ content: `${thought}好`, finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000], shots: 1 })
    expect(caps).toEqual([BENCH_PROBE_MAX_TOKENS, BENCH_PROBE_MAX_TOKENS, BENCH_PROBE_MAX_TOKENS])
    expect(report.concurrency?.okCount).toBe(BENCH_CONCURRENCY)
    expect(report.score?.concurrency).toBeGreaterThan(0)
  })

  it('一个字都没吐出来不算通过，也不许被当成零延迟', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (_m, _t, _c, _tc, onDone) => {
        onDone({ content: '', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.concurrency?.lanes.every(l => l.error === 'empty_output')).toBe(true)
    expect(report.concurrency?.okCount).toBe(0)
    expect(report.score?.concurrency).toBe(0)
  })

  it('长度档按真实请求发满工具清单，不写死 tool_choice', async () => {
    const seen: Array<{ tools: number; toolChoice?: string }> = []
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, tools, onChunk, _tc, onDone, _e, _id, _p, _rid, _r, _ready, _fo, opts) => {
        const blob = messages.map(m => m.content || '').join('\n')
        if (blob.includes('指定正文')) seen.push({ tools: tools.length, toolChoice: opts?.toolChoice })
        onChunk('好')
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    await runner.start({ profileId: 'p1', rungs: [4000], shots: 1 })
    expect(seen).toHaveLength(1)
    expect(seen[0].tools).toBe(BENCH_TOOLS.length)
    expect(seen[0].toolChoice).toBeUndefined()
  })

  it('长度档不该调工具却调了，判这一档不通过', async () => {
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, _t, _c, onToolCall, onDone) => {
        const blob = messages.map(m => m.content || '').join('\n')
        if (blob.includes('指定正文')) {
          const calls = [{
            id: 'c1',
            type: 'function' as const,
            function: { name: 'read_file', arguments: '{"path":"/tmp/x"}' },
          }]
          onToolCall(calls)
          onDone({ tool_calls: calls, finish_reason: 'tool_calls' })
          return
        }
        onDone({ content: '好', finish_reason: 'stop' })
      }),
      listProfiles: () => [fakeProfile()],
      getActiveProfileId: () => 'p1',
    })
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(report.rungs[0].calledTool).toBe(true)
    expect(report.rungs[0].toolName).toBe('read_file')
    expect(report.rungs[0].error).toBe('unexpected_tool_call')
    expect(report.rungs[0].success).toBe(false)
  })

  it('收尾这一步也发满工具清单；还去叫下一个工具就算没收住', async () => {
    let afterToolChoice: string | undefined | null = null
    let afterTools = 0
    const runner = new LlmBenchRunner({
      ai: fakeAi(async (messages, tools, onChunk, onToolCall, onDone, _e, _id, _p, _rid, _r, _ready, _fo, opts) => {
        const last = messages[messages.length - 1]
        if (last.role === 'tool') {
          afterToolChoice = opts?.toolChoice ?? undefined
          afterTools = tools.length
          const again = [{
            id: 'c2',
            type: 'function' as const,
            function: { name: 'exec', arguments: '{}' },
          }]
          onToolCall(again)
          onDone({ tool_calls: again, finish_reason: 'tool_calls' })
          return
        }
        const blob = messages.map(m => m.content || '').join('\n')
        if (blob.includes('sailfish-bench-probe')) {
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
    const report = await runner.start({ profileId: 'p1', rungs: [4000] })
    expect(afterToolChoice).toBeUndefined()
    expect(afterTools).toBe(BENCH_TOOLS.length)
    expect(report.tools?.after.error).toBe('unexpected_tool_call')
    expect(report.tools?.after.toolName).toBe('exec')
    expect(report.score?.tools).toBe(0)
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
