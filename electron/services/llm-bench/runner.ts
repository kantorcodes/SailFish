import type { AiMessage, ChatWithToolsResult, ToolCall, ToolDefinition } from '../ai.service'
import type { AiProfile } from '@shared/types'
import { resolveBenchLadder } from './ladder'
import { scoreBenchReport } from './score'
import { BENCH_OUTPUT_PASSAGE, buildBenchRequest, buildToolFollowUp } from './suite'
import {
  BENCH_CONCURRENCY,
  BENCH_DEFAULT_SHOTS,
  BENCH_OUTPUT_MAX_TOKENS,
  BENCH_PROBE_CHARS,
  BENCH_SHOT_CHOICES,
  BENCH_SUITE_VERSION,
  BENCH_TEMPERATURE,
  type BenchProfileInfo,
  type BenchProgress,
  type BenchReport,
  type BenchRungResult,
  type BenchSection,
  type BenchToolResult,
  type BenchToolTurn,
  type StartBenchInput,
} from './types'

export interface BenchStreamOptions {
  disableRetry?: boolean
  disableFailover?: boolean
  maxOutputTokens?: number
  temperature?: number
  truncateDebugMessages?: boolean
  onHttpStatus?: (status: number) => void
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface BenchAiClient {
  chatWithToolsStream(
    messages: AiMessage[],
    tools: ToolDefinition[],
    onChunk: (chunk: string) => void,
    onToolCall: (toolCalls: ToolCall[]) => void,
    onDone: (result: ChatWithToolsResult) => void,
    onError: (error: string) => void,
    profileId?: string,
    onToolCallProgress?: (toolCallId: string, toolName: string, partialArgs: string) => void,
    requestId?: string,
    onRetry?: () => void,
    onToolCallReady?: (toolCall: ToolCall) => void,
    onModelFailover?: () => void,
    streamOptions?: BenchStreamOptions,
  ): Promise<void>
  abort(requestId?: string): void
}

export interface BenchRunnerDeps {
  ai: BenchAiClient
  listProfiles: () => AiProfile[]
  getActiveProfileId: () => string
}

export type BenchListener = (progress: BenchProgress) => void

interface StreamOutcome {
  result: ChatWithToolsResult | { error: string }
  ttftMs?: number
  totalMs: number
  httpStatus?: number
  outputChars: number
  /**
   * 它说出口的正文（不含思考）。流里数到的 outputChars 会把思考过程和它的外壳一起算进去，
   * 拿它判「有没有照抄」会把所有会吐思考的模型整片冤枉成没照抄。
   */
  answer?: string
  toolCalls: ToolCall[]
}

function toProfileInfo(profile: AiProfile): BenchProfileInfo {
  return {
    id: profile.id,
    name: profile.name,
    model: profile.model,
    apiUrl: profile.apiUrl,
    contextLength: profile.contextLength,
  }
}

function emptyRung(targetChars: number, estimatedTokens: number, actualChars = 0): BenchRungResult {
  return {
    targetChars,
    actualChars,
    estimatedTokens,
    status: 'pending',
    success: false,
    rateLimited: false,
    truncated: false,
  }
}

function skippedRung(targetChars: number, estimatedTokens: number): BenchRungResult {
  return {
    ...emptyRung(targetChars, estimatedTokens),
    status: 'skipped',
    skipReason: 'exceeds_window',
  }
}

/** 首字之后不足这么久就写完的，当成没量出生成快慢，退回按整轮算。 */
const WRITE_SPEED_MIN_GEN_MS = 50

/** 排版差异不算改写：换行、空格、缩进不影响「是不是那段话」。 */
function normalizePassage(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * 这一档写出来的，是不是「那段话，且基本只有那段话」。
 * 两头都要看：认不出那段话（写了别的）算没照抄，认得出但还长出一大截（照抄完又自己发挥）同样算。
 * 只看字数会把「先寒暄两句再照抄」冤枉掉，只看认不认得出又漏掉写了三倍的那种。
 * 接口没给正文时返回 undefined——宁可不判，也不瞎判。
 */
function isOffPassage(answer: string | undefined): boolean | undefined {
  if (!answer) return undefined
  const want = normalizePassage(BENCH_OUTPUT_PASSAGE)
  const got = normalizePassage(answer)
  return !got.includes(want) || got.length > want.length * 1.3
}

function nextRequestId(): string {
  return `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 排序键：没量到首字就退回整轮，两个都没有的排最后。 */
function latencyOf(rung: BenchRungResult): number {
  return rung.ttftMs ?? rung.totalMs ?? Number.MAX_SAFE_INTEGER
}

/**
 * 这一档的哪一发拿来展示：有挂的就摆第一发挂的（失败要看得见），
 * 全过则按首字延迟排中间那发。发数凑成偶数时（中途停掉才会）取偏慢那一发，
 * 宁可报得保守，也不给一个偏乐观的数。
 */
function pickRepresentative(shots: BenchRungResult[]): number {
  const failed = shots.findIndex(s => !s.success)
  if (failed >= 0) return failed
  const order = shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => latencyOf(a.shot) - latencyOf(b.shot))
  return order[Math.floor(order.length / 2)].index
}

/** 工具轴一发是「发起调用 + 处理结果」一对，展示的两步必须来自同一发。 */
function pickPairedRepresentative(calls: BenchRungResult[], afters: BenchRungResult[]): number {
  const failed = calls.findIndex((call, i) => !call.success || !afters[i]?.success)
  if (failed >= 0) return failed
  return pickRepresentative(calls)
}

/**
 * 把展示行整个换成第 index 发的样子，`shots` 本身留着不动。
 * 上一发留下的字段必须先抹掉：这一发没量到首字就直接挂了，却还挂着上一发的首字，
 * 展示的就成了一行谁也没跑出来过的数——正是重复打这几发要防的事。
 */
function showShot(display: BenchRungResult, index: number): void {
  const shots = display.shots
  const chosen = shots?.[index]
  if (!chosen) return
  const bag = display as unknown as Record<string, unknown>
  for (const key of Object.keys(bag)) {
    if (key !== 'shots' && !(key in chosen)) delete bag[key]
  }
  Object.assign(display, chosen, { shots, shotIndex: index + 1 })
}

/**
 * 记下这一发，并重算展示行。
 * 被用户停掉的那一发不记——它不是接口的表现，记进去会把前几发的好数据挤掉。
 */
function mergeShot(display: BenchRungResult, attempt: BenchRungResult): void {
  if (attempt.status === 'aborted') {
    if (!display.shots?.length) Object.assign(display, { ...attempt, shots: display.shots })
    return
  }
  const shots = display.shots ?? []
  shots.push(attempt)
  display.shots = shots
  showShot(display, pickRepresentative(shots))
}

/** 工具轴两步一起记：展示的「发起调用」和「处理结果」必须是同一发里发生的。 */
function mergeToolPair(tools: BenchToolResult, call: BenchToolTurn, after: BenchRungResult): void {
  if (call.status === 'aborted' || after.status === 'aborted') {
    if (!tools.call.shots?.length) {
      Object.assign(tools.call, { ...call, shots: tools.call.shots })
      Object.assign(tools.after, { ...after, shots: tools.after.shots })
    }
    return
  }
  const calls = tools.call.shots ?? []
  const afters = tools.after.shots ?? []
  calls.push(call)
  afters.push(after)
  tools.call.shots = calls
  tools.after.shots = afters
  const index = pickPairedRepresentative(calls, afters)
  showShot(tools.call, index)
  showShot(tools.after, index)
}

/** 实际打成了几发（各项里最多的那个）。中途停掉时会少于计划发数。 */
function actualShots(report: BenchReport): number {
  const all = [
    ...report.rungs,
    ...(report.tools ? [report.tools.call] : []),
    ...(report.concurrency?.lanes ?? []),
  ]
  return Math.max(0, ...all.map(r => r.shots?.length ?? 0))
}

/** 发数只认 1 / 3 / 5，别的一律回到默认。 */
function normalizeShots(requested?: number): number {
  const choices = BENCH_SHOT_CHOICES as readonly number[]
  if (requested && choices.includes(requested)) return requested
  return BENCH_DEFAULT_SHOTS
}

export class LlmBenchRunner {
  private running = false
  private aborted = false
  private readonly liveRequestIds = new Set<string>()
  private readonly listeners = new Set<BenchListener>()

  constructor(private readonly deps: BenchRunnerDeps) {}

  onProgress(listener: BenchListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isRunning(): boolean {
    return this.running
  }

  listProfiles(): BenchProfileInfo[] {
    return this.deps.listProfiles().map(toProfileInfo)
  }

  getActiveProfileId(): string {
    return this.deps.getActiveProfileId()
  }

  stop(): void {
    if (!this.running) return
    this.aborted = true
    for (const id of this.liveRequestIds) {
      this.deps.ai.abort(id)
    }
  }

  async start(input: StartBenchInput): Promise<BenchReport> {
    if (this.running) {
      throw new Error('bench_already_running')
    }
    const profile = this.deps.listProfiles().find(p => p.id === input.profileId)
    if (!profile) {
      throw new Error('bench_profile_not_found')
    }

    // 指定了档位却一个合法的都没有：既不悄悄跑默认档（跑的跟说的不是一回事），
    // 也不出一份零档位的空报告
    if (input.rungs?.length && !input.rungs.some(n => Number.isFinite(n) && Math.floor(n) > 0)) {
      throw new Error('bench_invalid_rungs')
    }
    const ladder = resolveBenchLadder(profile, input.rungs)
    const probe = buildBenchRequest(BENCH_PROBE_CHARS, 'concurrency')
    const skipProbe = probe.estimatedTokens > ladder.inputLimit
    const shots = normalizeShots(input.shots)

    const report: BenchReport = {
      suiteVersion: BENCH_SUITE_VERSION,
      startedAt: Date.now(),
      profile: toProfileInfo(profile),
      contextLength: ladder.contextLength,
      inputLimit: ladder.inputLimit,
      temperature: BENCH_TEMPERATURE,
      passageChars: BENCH_OUTPUT_PASSAGE.length,
      shotsPerRung: shots,
      standardLadder: ladder.standard,
      rungs: ladder.rungs.map((item) => {
        if (item.skipReason) {
          return { ...emptyRung(item.targetChars, item.estimatedTokens), status: 'skipped', skipReason: item.skipReason }
        }
        return emptyRung(item.targetChars, item.estimatedTokens)
      }),
      tools: {
        call: { ...(skipProbe ? skippedRung(BENCH_PROBE_CHARS, probe.estimatedTokens) : emptyRung(BENCH_PROBE_CHARS, 0)), calledTool: false },
        after: skipProbe ? skippedRung(BENCH_PROBE_CHARS, probe.estimatedTokens) : emptyRung(BENCH_PROBE_CHARS, 0),
      },
      concurrency: {
        lanes: Array.from({ length: BENCH_CONCURRENCY }, () => (
          skipProbe ? skippedRung(BENCH_PROBE_CHARS, probe.estimatedTokens) : emptyRung(BENCH_PROBE_CHARS, 0)
        )),
        okCount: 0,
        rateLimitedCount: 0,
      },
    }

    this.running = true
    this.aborted = false
    this.emit(report, 'context')

    try {
      // 整套跑完一遍再跑第二遍：三发落在不同时间段，才摊得掉网络和排队的偶然；
      // 而且第一遍跑完表就填满了，后面几遍只是把数字校准。
      for (let shot = 0; shot < shots && !this.aborted; shot++) {
        for (const rung of report.rungs) {
          if (rung.status === 'skipped') continue
          if (this.aborted) break
          await this.runContext(profile.id, rung, report, shot)
        }
        if (!this.aborted) await this.runTools(profile.id, report, shot)
        if (!this.aborted) await this.runConcurrency(profile.id, report, shot)
      }
      if (this.aborted) this.abortRemaining(report)
    } finally {
      // 中途停掉时如实写实际打了几发，别让报告顶着「每档 3 发」其实只打了 1 发
      report.shotsPerRung = Math.min(shots, actualShots(report)) || shots
      report.finishedAt = Date.now()
      report.score = scoreBenchReport(report)
      this.running = false
      this.liveRequestIds.clear()
      this.emit(report)
    }
    return report
  }

  private emit(
    report: BenchReport,
    currentSection?: BenchSection,
    currentTargetChars?: number,
    currentShot?: number,
  ): void {
    const progress: BenchProgress = { report, currentSection, currentTargetChars, currentShot }
    for (const listener of this.listeners) listener(progress)
  }

  private markAborted(rung: BenchRungResult): void {
    if (rung.status === 'skipped' || rung.status === 'ok' || rung.status === 'error') return
    // 已经打完的发不能因为后面被停掉就作废——它们是真跑出来的数
    if (rung.shots?.length) {
      showShot(rung, pickRepresentative(rung.shots))
      return
    }
    rung.status = 'aborted'
    rung.error = 'aborted'
  }

  private abortRemaining(report: BenchReport): void {
    for (const rung of report.rungs) this.markAborted(rung)
    if (report.tools) {
      this.markAborted(report.tools.call)
      this.markAborted(report.tools.after)
    }
    if (report.concurrency) {
      for (const lane of report.concurrency.lanes) this.markAborted(lane)
    }
  }

  private async streamOnce(opts: {
    profileId: string
    messages: AiMessage[]
    tools: ToolDefinition[]
    maxOutputTokens?: number
    toolChoice?: 'auto' | 'none' | 'required'
  }): Promise<StreamOutcome> {
    const requestId = nextRequestId()
    this.liveRequestIds.add(requestId)
    const started = Date.now()
    let firstTokenAt: number | undefined
    let httpStatus: number | undefined
    let outputChars = 0
    let toolCalls: ToolCall[] = []

    const result = await new Promise<ChatWithToolsResult | { error: string }>((resolve) => {
      void this.deps.ai.chatWithToolsStream(
        opts.messages,
        opts.tools,
        (chunk) => {
          if (chunk) {
            outputChars += chunk.length
            if (firstTokenAt === undefined) firstTokenAt = Date.now()
          }
        },
        (calls) => {
          if (calls.length > 0) {
            toolCalls = calls
            if (firstTokenAt === undefined) firstTokenAt = Date.now()
          }
        },
        (done) => resolve(done),
        (error) => resolve({ error }),
        opts.profileId,
        undefined,
        requestId,
        undefined,
        undefined,
        undefined,
        {
          disableRetry: true,
          disableFailover: true,
          maxOutputTokens: opts.maxOutputTokens,
          temperature: BENCH_TEMPERATURE,
          truncateDebugMessages: true,
          toolChoice: opts.toolChoice,
          onHttpStatus: (status) => { httpStatus = status },
        },
      )
    })

    this.liveRequestIds.delete(requestId)
    if ('tool_calls' in result && result.tool_calls?.length) {
      toolCalls = result.tool_calls
    }
    return {
      result,
      ttftMs: firstTokenAt !== undefined ? firstTokenAt - started : undefined,
      totalMs: Date.now() - started,
      httpStatus,
      outputChars,
      answer: 'content' in result && typeof result.content === 'string' ? result.content : undefined,
      toolCalls,
    }
  }

  private applyOutcome(rung: BenchRungResult, outcome: StreamOutcome): boolean {
    rung.totalMs = outcome.totalMs
    rung.httpStatus = outcome.httpStatus
    if (outcome.ttftMs !== undefined) rung.ttftMs = outcome.ttftMs

    if (this.aborted) {
      rung.status = 'aborted'
      rung.error = 'aborted'
      return false
    }

    const { result } = outcome
    if ('error' in result) {
      rung.status = 'error'
      rung.error = result.error
      rung.rateLimited = outcome.httpStatus === 429
      return false
    }

    if (result.aborted) {
      rung.status = 'aborted'
      rung.error = 'aborted'
      return false
    }

    rung.actualPromptTokens = result.usage?.prompt_tokens
    rung.actualCompletionTokens = result.usage?.completion_tokens
    rung.finishReason = result.finish_reason
    rung.truncated = result.finish_reason === 'length'
    rung.rateLimited = outcome.httpStatus === 429
    if (!result.finish_reason) {
      rung.status = 'error'
      rung.error = 'stream_cut'
      rung.success = false
      return false
    }
    return true
  }

  /**
   * 长度档、并发一路、工具收尾共用的判法：要真吐出字、没被截断、没去调工具，才算这一轮收住了。
   * 一个字都没有却记「通过」，后面按首字算分时会把这一路当成零延迟，反而抹掉最慢的那路。
   */
  private finishShort(rung: BenchRungResult, outcome: StreamOutcome): void {
    if (!this.applyOutcome(rung, outcome)) return
    const calledTool = outcome.toolCalls.length > 0
    rung.calledTool = calledTool
    if (calledTool) rung.toolName = outcome.toolCalls[0]?.function?.name
    rung.outputChars = outcome.outputChars
    rung.success = !rung.truncated && !calledTool && outcome.outputChars > 0
    rung.status = rung.success ? 'ok' : 'error'
    if (rung.truncated) rung.error = 'truncated'
    else if (calledTool) rung.error = 'unexpected_tool_call'
    else if (outcome.outputChars <= 0) rung.error = 'empty_output'
  }

  /**
   * 写速按首字之后那段时间算。整段一次到的接口（几乎不流式）那段时间只有几毫秒，
   * 除出来是每秒几万字，几何平均会被这一项带飞——量不出生成快慢时，退回按整轮算。
   */
  private applyWriteSpeed(rung: BenchRungResult, outcome: StreamOutcome): void {
    rung.outputChars = outcome.outputChars
    const genMs = outcome.totalMs - (outcome.ttftMs ?? 0)
    const basis = genMs >= WRITE_SPEED_MIN_GEN_MS ? genMs : Math.max(1, outcome.totalMs)
    rung.outputCharsPerSec = outcome.outputChars > 0
      ? Math.round((outcome.outputChars / basis) * 1000)
      : 0
  }

  private async runContext(
    profileId: string,
    display: BenchRungResult,
    report: BenchReport,
    shot: number,
  ): Promise<void> {
    const built = buildBenchRequest(display.targetChars, 'context', 0, shot)
    const attempt = emptyRung(display.targetChars, built.estimatedTokens, built.charCount)
    display.status = 'running'
    this.emit(report, 'context', display.targetChars, shot + 1)
    // 不传 toolChoice：题里叮嘱了别调工具，但清单要照真实请求发出去。
    // 写死 none 的话，有的接口会把整份清单摘掉，主轴就发得比其它轴轻。
    const outcome = await this.streamOnce({
      profileId,
      messages: built.messages,
      tools: built.tools,
      maxOutputTokens: BENCH_OUTPUT_MAX_TOKENS,
    })
    // 成没成一律走同一套判法；长度档只多两件事：记写速、看照没照抄
    this.applyWriteSpeed(attempt, outcome)
    this.finishShort(attempt, outcome)
    if (attempt.success) attempt.offPassage = isOffPassage(outcome.answer)
    mergeShot(display, attempt)
    this.emit(report, 'context', display.targetChars, shot + 1)
  }

  private async runShort(
    profileId: string,
    display: BenchRungResult,
    report: BenchReport,
    section: BenchSection,
    lane: number,
    shot: number,
  ): Promise<void> {
    const axis = section === 'concurrency' ? 'concurrency' : 'context'
    const built = buildBenchRequest(display.targetChars, axis, lane, shot)
    const attempt = emptyRung(display.targetChars, built.estimatedTokens, built.charCount)
    display.status = 'running'
    this.emit(report, section, display.targetChars, shot + 1)
    // 不另卡一道更小的输出上限：思考型模型会先把额度花在想上，一卡就被当成说到一半。
    const outcome = await this.streamOnce({
      profileId,
      messages: built.messages,
      tools: built.tools,
    })
    this.finishShort(attempt, outcome)
    mergeShot(display, attempt)
    this.emit(report, section, display.targetChars, shot + 1)
  }

  private async runTools(profileId: string, report: BenchReport, shot: number): Promise<void> {
    const tools = report.tools
    if (!tools || tools.call.status === 'skipped') return
    const first = buildBenchRequest(BENCH_PROBE_CHARS, 'tools', 0, shot)
    const call: BenchToolTurn = {
      ...emptyRung(BENCH_PROBE_CHARS, first.estimatedTokens, first.charCount),
      calledTool: false,
    }
    const after = emptyRung(BENCH_PROBE_CHARS, first.estimatedTokens, first.charCount)
    tools.call.status = 'running'
    this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)

    const callOutcome = await this.streamOnce({
      profileId,
      messages: first.messages,
      tools: first.tools,
      toolChoice: 'auto',
    })
    const named = callOutcome.toolCalls.find(c => c.function.name === 'read_file') ?? callOutcome.toolCalls[0]
    call.calledTool = callOutcome.toolCalls.length > 0
    call.toolName = named?.function.name
    if (!this.applyOutcome(call, callOutcome)) {
      after.status = this.aborted ? 'aborted' : 'skipped'
      after.skipReason = this.aborted ? undefined : 'no_tool_call'
      after.error = this.aborted ? 'aborted' : 'no_tool_call'
      mergeToolPair(tools, call, after)
      this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)
      return
    }
    if (!call.calledTool) {
      call.success = false
      call.status = 'error'
      call.error = 'no_tool_call'
      after.status = 'skipped'
      after.skipReason = 'no_tool_call'
      mergeToolPair(tools, call, after)
      this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)
      return
    }
    call.success = true
    call.status = 'ok'

    if (this.aborted) {
      this.markAborted(after)
      mergeToolPair(tools, call, after)
      this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)
      return
    }

    tools.after.status = 'running'
    this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)
    const follow = buildToolFollowUp(first, callOutcome.toolCalls)
    // 同样不写死 none：清单要照真实请求发满，各家才可比。拿到结果还去叫下一个工具，
    // 就是没把这一轮收住，按不通过记。
    const afterOutcome = await this.streamOnce({
      profileId,
      messages: follow,
      tools: first.tools,
    })
    this.finishShort(after, afterOutcome)
    mergeToolPair(tools, call, after)
    this.emit(report, 'tools', BENCH_PROBE_CHARS, shot + 1)
  }

  private async runConcurrency(profileId: string, report: BenchReport, shot: number): Promise<void> {
    const block = report.concurrency
    if (!block || block.lanes.every(l => l.status === 'skipped')) return
    for (const lane of block.lanes) {
      if (lane.status !== 'skipped') lane.status = 'running'
    }
    this.emit(report, 'concurrency', BENCH_PROBE_CHARS, shot + 1)
    await Promise.all(block.lanes.map((lane, index) => {
      if (lane.status === 'skipped') return Promise.resolve()
      return this.runShort(profileId, lane, report, 'concurrency', index + 1, shot)
    }))
    block.okCount = block.lanes.filter(l => l.success).length
    block.rateLimitedCount = block.lanes.filter(l => l.rateLimited).length
    this.emit(report, 'concurrency', BENCH_PROBE_CHARS, shot + 1)
  }
}
