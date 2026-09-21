/** 冻住的标准题版本。换机器、换模型比的是这一版题。 */
export const BENCH_SUITE_VERSION = 'sailfish-bench-v6'

/** 长度档要写完那段冻住的话。 */
export const BENCH_OUTPUT_MAX_TOKENS = 1024

/** 工具 / 并发用的固定上下文，不跟长度扫搅在一起。 */
export const BENCH_PROBE_CHARS = 4_000

/** 同时打几路，像桌上常见的三件套。 */
export const BENCH_CONCURRENCY = 3

/** 采样冻住，不跟各机配置走，报告里照抄。 */
export const BENCH_TEMPERATURE = 0.7

export const DEFAULT_BENCH_RUNGS = [4_000, 16_000, 32_000, 64_000, 128_000] as const

/** 每档默认打几发，取中间那一发。一发的数噪声太大，不够拿来比两台机器。 */
export const BENCH_DEFAULT_SHOTS = 3

/** 用户能选的发数。 */
export const BENCH_SHOT_CHOICES = [1, 3, 5] as const

export type BenchSection = 'context' | 'tools' | 'concurrency'

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
  outputChars?: number
  outputCharsPerSec?: number
  /** 这一档没照抄指定正文（长度档专用）。不算失败，但写速不好跟别档比。 */
  offPassage?: boolean
  /** 长度档不该调工具；调了就记下来判不通过。工具轴则必须为 true。 */
  calledTool?: boolean
  toolName?: string
  /**
   * 这一档打过的每一发。上面那些字段是它的投影——按首字延迟排在中间的那一发，
   * 有失败则是第一发失败的那一发。不是另一份真相，别分头改。
   */
  shots?: BenchRungResult[]
  /** 展示的这一行来自第几发（从 1 数）。 */
  shotIndex?: number
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
  outputCharsPerSecSum: 2_000,
  toolsRoundTripMs: 2_000,
  /** 三路一起上时，最慢那一路的首字延迟——不看谁写得长。 */
  concurrencySlowestTtftMs: 800,
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
  /** 指定正文的字数。写出的字数跟它差太多，说明这一档没照抄，写速不好横着比。 */
  passageChars: number
  /** 这次每档打了几发。两份报告对着看，先确认口径一样。 */
  shotsPerRung: number
  rungs: BenchRungResult[]
  tools?: BenchToolResult
  concurrency?: BenchConcurrencyResult
  score?: BenchScore
}

export interface BenchProgress {
  report: BenchReport
  currentSection?: BenchSection
  currentTargetChars?: number
  /** 正在跑第几遍（从 1 数），共几遍看报告里的 shotsPerRung。 */
  currentShot?: number
}

export interface StartBenchInput {
  profileId: string
  rungs?: number[]
  shots?: number
}
