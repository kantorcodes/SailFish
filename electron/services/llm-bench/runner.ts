import type { AiMessage, ChatWithToolsResult, ToolCall, ToolDefinition } from '../ai.service'
import type { AiProfile } from '@shared/types'
import { resolveBenchLadder } from './ladder'
import { scoreBenchReport } from './score'
import { buildBenchRequest, buildToolFollowUp } from './suite'
import {
  BENCH_CONCURRENCY,
  BENCH_MAX_OUTPUT_TOKENS,
  BENCH_OUTPUT_MAX_TOKENS,
  BENCH_PROBE_CHARS,
  BENCH_SUITE_VERSION,
  BENCH_TEMPERATURE,
  type BenchProfileInfo,
  type BenchProgress,
  type BenchReport,
  type BenchRungResult,
  type BenchSection,
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

function nextRequestId(): string {
  return `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
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

    const ladder = resolveBenchLadder(profile, input.rungs)
    const probe = buildBenchRequest(BENCH_PROBE_CHARS, 'context')
    const skipProbe = probe.estimatedTokens > ladder.inputLimit

    const report: BenchReport = {
      suiteVersion: BENCH_SUITE_VERSION,
      startedAt: Date.now(),
      profile: toProfileInfo(profile),
      contextLength: ladder.contextLength,
      inputLimit: ladder.inputLimit,
      temperature: BENCH_TEMPERATURE,
      rungs: ladder.rungs.map((item) => {
        if (item.skipReason) {
          return { ...emptyRung(item.targetChars, item.estimatedTokens), status: 'skipped', skipReason: item.skipReason }
        }
        return emptyRung(item.targetChars, item.estimatedTokens)
      }),
      output: skipProbe
        ? { ...skippedRung(BENCH_PROBE_CHARS, probe.estimatedTokens), outputChars: 0 }
        : { ...emptyRung(BENCH_PROBE_CHARS, 0), outputChars: 0 },
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
      for (const rung of report.rungs) {
        if (rung.status === 'skipped') continue
        if (this.aborted) {
          this.markAborted(rung)
          this.emit(report, 'context', rung.targetChars)
          continue
        }
        await this.runShort(profile.id, rung, report, 'context')
      }
      if (!this.aborted) await this.runOutput(profile.id, report)
      if (!this.aborted) await this.runTools(profile.id, report)
      if (!this.aborted) await this.runConcurrency(profile.id, report)
      if (this.aborted) this.abortRemaining(report)
    } finally {
      report.finishedAt = Date.now()
      report.score = scoreBenchReport(report)
      this.running = false
      this.liveRequestIds.clear()
      this.emit(report)
    }
    return report
  }

  private emit(report: BenchReport, currentSection?: BenchSection, currentTargetChars?: number): void {
    const progress: BenchProgress = { report, currentSection, currentTargetChars }
    for (const listener of this.listeners) listener(progress)
  }

  private markAborted(rung: BenchRungResult): void {
    if (rung.status === 'skipped' || rung.status === 'ok' || rung.status === 'error') return
    rung.status = 'aborted'
    rung.error = 'aborted'
  }

  private abortRemaining(report: BenchReport): void {
    for (const rung of report.rungs) this.markAborted(rung)
    if (report.output) this.markAborted(report.output)
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

  private finishShort(rung: BenchRungResult, outcome: StreamOutcome): void {
    if (!this.applyOutcome(rung, outcome)) return
    rung.success = !rung.truncated
    rung.status = rung.success ? 'ok' : 'error'
    if (!rung.success && rung.truncated) rung.error = 'truncated'
  }

  private async runShort(
    profileId: string,
    rung: BenchRungResult,
    report: BenchReport,
    section: BenchSection,
    lane = 0,
  ): Promise<void> {
    const built = buildBenchRequest(rung.targetChars, section === 'concurrency' ? 'concurrency' : 'context', lane)
    rung.estimatedTokens = built.estimatedTokens
    rung.actualChars = built.charCount
    rung.status = 'running'
    this.emit(report, section, rung.targetChars)
    const outcome = await this.streamOnce({
      profileId,
      messages: built.messages,
      tools: built.tools,
      maxOutputTokens: BENCH_MAX_OUTPUT_TOKENS,
    })
    this.finishShort(rung, outcome)
    this.emit(report, section, rung.targetChars)
  }

  private async runOutput(profileId: string, report: BenchReport): Promise<void> {
    const rung = report.output
    if (!rung || rung.status === 'skipped') return
    const built = buildBenchRequest(BENCH_PROBE_CHARS, 'output')
    rung.estimatedTokens = built.estimatedTokens
    rung.actualChars = built.charCount
    rung.status = 'running'
    this.emit(report, 'output', BENCH_PROBE_CHARS)
    const outcome = await this.streamOnce({
      profileId,
      messages: built.messages,
      tools: built.tools,
      maxOutputTokens: BENCH_OUTPUT_MAX_TOKENS,
      toolChoice: 'none',
    })
    rung.outputChars = outcome.outputChars
    const genMs = Math.max(1, outcome.totalMs - (outcome.ttftMs ?? 0))
    rung.outputCharsPerSec = outcome.outputChars > 0
      ? Math.round((outcome.outputChars / genMs) * 1000)
      : 0
    if (!this.applyOutcome(rung, outcome)) {
      this.emit(report, 'output', BENCH_PROBE_CHARS)
      return
    }
    rung.success = !rung.truncated && outcome.outputChars > 0
    rung.status = rung.success ? 'ok' : 'error'
    if (rung.truncated) rung.error = 'truncated'
    else if (outcome.outputChars <= 0) rung.error = 'empty_output'
    this.emit(report, 'output', BENCH_PROBE_CHARS)
  }

  private async runTools(profileId: string, report: BenchReport): Promise<void> {
    const tools = report.tools
    if (!tools || tools.call.status === 'skipped') return
    const first = buildBenchRequest(BENCH_PROBE_CHARS, 'tools')
    const call = tools.call
    call.estimatedTokens = first.estimatedTokens
    call.actualChars = first.charCount
    call.status = 'running'
    this.emit(report, 'tools', BENCH_PROBE_CHARS)

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
      tools.after.status = this.aborted ? 'aborted' : 'skipped'
      tools.after.skipReason = this.aborted ? undefined : 'no_tool_call'
      tools.after.error = this.aborted ? 'aborted' : 'no_tool_call'
      this.emit(report, 'tools', BENCH_PROBE_CHARS)
      return
    }
    if (!call.calledTool) {
      call.success = false
      call.status = 'error'
      call.error = 'no_tool_call'
      tools.after.status = 'skipped'
      tools.after.skipReason = 'no_tool_call'
      this.emit(report, 'tools', BENCH_PROBE_CHARS)
      return
    }
    call.success = true
    call.status = 'ok'
    this.emit(report, 'tools', BENCH_PROBE_CHARS)

    if (this.aborted) {
      this.markAborted(tools.after)
      this.emit(report, 'tools', BENCH_PROBE_CHARS)
      return
    }

    const after = tools.after
    after.status = 'running'
    this.emit(report, 'tools', BENCH_PROBE_CHARS)
    const follow = buildToolFollowUp(first, callOutcome.toolCalls)
    const afterOutcome = await this.streamOnce({
      profileId,
      messages: follow,
      tools: first.tools,
      toolChoice: 'none',
    })
    after.actualChars = first.charCount
    after.estimatedTokens = first.estimatedTokens
    this.finishShort(after, afterOutcome)
    this.emit(report, 'tools', BENCH_PROBE_CHARS)
  }

  private async runConcurrency(profileId: string, report: BenchReport): Promise<void> {
    const block = report.concurrency
    if (!block || block.lanes.every(l => l.status === 'skipped')) return
    for (const lane of block.lanes) {
      if (lane.status !== 'skipped') lane.status = 'running'
    }
    this.emit(report, 'concurrency', BENCH_PROBE_CHARS)
    await Promise.all(block.lanes.map((lane, index) => {
      if (lane.status === 'skipped') return Promise.resolve()
      return this.runShort(profileId, lane, report, 'concurrency', index + 1)
    }))
    block.okCount = block.lanes.filter(l => l.success).length
    block.rateLimitedCount = block.lanes.filter(l => l.rateLimited).length
    this.emit(report, 'concurrency', BENCH_PROBE_CHARS)
  }
}
