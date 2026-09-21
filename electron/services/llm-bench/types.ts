/** 冻住的标准题版本。换机器、换模型比的是这一版题。 */
export const BENCH_SUITE_VERSION = 'sailfish-bench-v3'

/** 短回够用即可，避免生成长短搅乱耗时。 */
export const BENCH_MAX_OUTPUT_TOKENS = 64

/** 输出速度轴：要写完那段冻住的话。 */
export const BENCH_OUTPUT_MAX_TOKENS = 1024

/** 输出 / 工具 / 并发用的固定上下文，不跟长度扫搅在一起。 */
export const BENCH_PROBE_CHARS = 4_000

/** 同时打几路，像桌上常见的三件套。 */
export const BENCH_CONCURRENCY = 3

/** 采样冻住，不跟各机配置走，报告里照抄。 */
export const BENCH_TEMPERATURE = 0.7

export const DEFAULT_BENCH_RUNGS = [4_000, 16_000, 32_000, 64_000, 128_000] as const

export type BenchSection = 'context' | 'output' | 'tools' | 'concurrency'

export type BenchRungStatus = 'pending' | 'running' | 'ok' | 'error' | 'skipped' | 'aborted'

export interface BenchProfileInfo {
  id: string
  name: string
  model: string
  apiUrl: string
  contextLength?: number
}

export interface BenchRungResult {
  targetChars: number
  actualChars: number
  estimatedTokens: number
  actualPromptTokens?: number
  actualCompletionTokens?: number
  status: BenchRungStatus
  skipReason?: string
  success: boolean
  ttftMs?: number
  totalMs?: number
  finishReason?: string
  error?: string
  rateLimited: boolean
  truncated: boolean
  httpStatus?: number
}

export interface BenchOutputResult extends BenchRungResult {
  outputChars?: number
  outputCharsPerSec?: number
}

export interface BenchToolTurn extends BenchRungResult {
  calledTool: boolean
  toolName?: string
}

export interface BenchToolResult {
  call: BenchToolTurn
  after: BenchRungResult
}

export interface BenchConcurrencyResult {
  lanes: BenchRungResult[]
  okCount: number
  rateLimitedCount: number
}

/** 分项对照：这项跑到这个数大约得 1000。只跟同一题版本比。 */
export const BENCH_SCORE_REF = {
  contextCharsPerSecSum: 40_000,
  outputCharsPerSec: 40,
  toolsRoundTripMs: 2_000,
  concurrencyCharsPerSec: 8_000,
} as const

export interface BenchScore {
  total: number
  context: number
  output: number
  tools: number
  concurrency: number
}

export interface BenchReport {
  suiteVersion: string
  startedAt: number
  finishedAt?: number
  profile: BenchProfileInfo
  contextLength: number
  inputLimit: number
  temperature: number
  rungs: BenchRungResult[]
  output?: BenchOutputResult
  tools?: BenchToolResult
  concurrency?: BenchConcurrencyResult
  score?: BenchScore
}

export interface BenchProgress {
  report: BenchReport
  currentSection?: BenchSection
  currentTargetChars?: number
}

export interface StartBenchInput {
  profileId: string
  rungs?: number[]
}
