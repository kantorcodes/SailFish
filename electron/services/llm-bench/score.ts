import {
  BENCH_PROBE_CHARS,
  BENCH_SCORE_REF,
  type BenchConcurrencyResult,
  type BenchOutputResult,
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

export function scoreOutput(output: BenchOutputResult | undefined): number {
  if (!ok(output)) return 0
  const raw = output.outputCharsPerSec ?? charsPerSec(output.outputChars ?? 0, Math.max(1, (output.totalMs ?? 0) - (output.ttftMs ?? 0)))
  return scale(raw, BENCH_SCORE_REF.outputCharsPerSec)
}

export function scoreTools(tools: BenchToolResult | undefined): number {
  if (!tools || !ok(tools.call) || !tools.call.calledTool || !ok(tools.after)) return 0
  const ms = (tools.call.totalMs ?? 0) + (tools.after.totalMs ?? 0)
  if (ms <= 0) return 0
  return scale(BENCH_SCORE_REF.toolsRoundTripMs, ms)
}

export function scoreConcurrency(block: BenchConcurrencyResult | undefined): number {
  if (!block || block.lanes.length === 0) return 0
  if (block.lanes.some(lane => !ok(lane))) return 0
  const slowest = Math.max(...block.lanes.map(lane => lane.totalMs ?? 0))
  const raw = charsPerSec(BENCH_PROBE_CHARS, slowest)
  return scale(raw, BENCH_SCORE_REF.concurrencyCharsPerSec)
}

export function scoreBenchReport(report: Pick<BenchReport, 'rungs' | 'output' | 'tools' | 'concurrency'>): BenchScore {
  const context = scoreContext(report.rungs)
  const output = scoreOutput(report.output)
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
