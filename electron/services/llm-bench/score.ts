import {
  BENCH_SCORE_REF,
  type BenchConcurrencyResult,
  type BenchReport,
  type BenchRungResult,
  type BenchScore,
  type BenchToolResult,
} from './types'

function ok(rung: BenchRungResult | undefined): boolean {
  return !!rung && rung.status === 'ok' && rung.success && !rung.rateLimited
}

function charsPerSec(chars: number, totalMs: number | undefined): number {
  const ms = totalMs ?? 0
  if (chars <= 0 || ms <= 0) return 0
  return (chars / ms) * 1000
}

function scale(raw: number, ref: number): number {
  if (raw <= 0 || ref <= 0) return 0
  return Math.round((raw / ref) * 1000)
}

function geometricMean(values: number[]): number {
  if (values.some(v => v <= 0)) return 0
  const logAvg = values.reduce((s, v) => s + Math.log(v), 0) / values.length
  return Math.round(Math.exp(logAvg))
}

export function scoreContext(rungs: BenchRungResult[]): number {
  const raw = rungs.reduce((sum, rung) => {
    if (!ok(rung)) return sum
    return sum + charsPerSec(rung.targetChars, rung.totalMs)
  }, 0)
  return scale(raw, BENCH_SCORE_REF.contextCharsPerSecSum)
}

export function scoreOutput(rungs: BenchRungResult[]): number {
  const raw = rungs.reduce((sum, rung) => {
    if (!ok(rung)) return sum
    const cps = rung.outputCharsPerSec
      ?? charsPerSec(rung.outputChars ?? 0, Math.max(1, (rung.totalMs ?? 0) - (rung.ttftMs ?? 0)))
    return sum + cps
  }, 0)
  return scale(raw, BENCH_SCORE_REF.outputCharsPerSecSum)
}

export function scoreTools(tools: BenchToolResult | undefined): number {
  if (!tools || !ok(tools.call) || !tools.call.calledTool || !ok(tools.after)) return 0
  const ms = (tools.call.totalMs ?? 0) + (tools.after.totalMs ?? 0)
  if (ms <= 0) return 0
  return scale(BENCH_SCORE_REF.toolsRoundTripMs, ms)
}

/** 三路一起上，看最慢那一路第一个字多久出来——写多写少不该影响这一项。 */
export function scoreConcurrency(block: BenchConcurrencyResult | undefined): number {
  if (!block || block.lanes.length === 0) return 0
  if (block.lanes.some(lane => !ok(lane))) return 0
  // 没量到首字就退回整轮：缺首字不等于零延迟，当零会把最慢一路悄悄抹掉
  // 量到 0 毫秒只会出现在假客户端里；给一个毫秒下限，别让它变成除零
  const slowestTtft = Math.max(1, ...block.lanes.map(lane => lane.ttftMs ?? lane.totalMs ?? 0))
  return scale(BENCH_SCORE_REF.concurrencySlowestTtftMs, slowestTtft)
}

export function scoreBenchReport(report: Pick<BenchReport, 'rungs' | 'tools' | 'concurrency'>): BenchScore {
  const context = scoreContext(report.rungs)
  const output = scoreOutput(report.rungs)
  const tools = scoreTools(report.tools)
  const concurrency = scoreConcurrency(report.concurrency)
  return {
    total: geometricMean([context, output, tools, concurrency]),
    context,
    output,
    tools,
    concurrency,
  }
}
