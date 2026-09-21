import { resolveRequestBudget } from '../ai-request-budget'
import type { AiProfile } from '@shared/types'
import { buildBenchRequest } from './suite'
import {
  BENCH_OUTPUT_MAX_TOKENS,
  DEFAULT_BENCH_RUNGS,
} from './types'

export interface ResolvedLadder {
  contextLength: number
  inputLimit: number
  /** 按字数排好，含超窗口要跳过的档。 */
  rungs: Array<{ targetChars: number; estimatedTokens: number; skipReason?: string }>
}

function uniquePositiveInts(values: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const raw of values) {
    const n = Math.floor(raw)
    if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.sort((a, b) => a - b)
}

export function resolveBenchLadder(
  profile: Pick<AiProfile, 'contextLength' | 'maxOutputTokens'> | null | undefined,
  customRungs?: number[],
): ResolvedLadder {
  const budget = resolveRequestBudget(profile, BENCH_OUTPUT_MAX_TOKENS)
  const requested = customRungs && customRungs.length > 0
    ? uniquePositiveInts(customRungs)
    : uniquePositiveInts([...DEFAULT_BENCH_RUNGS])

  const rungs = requested.map((targetChars) => {
    const built = buildBenchRequest(targetChars)
    return built.estimatedTokens > budget.inputLimit
      ? { targetChars, estimatedTokens: built.estimatedTokens, skipReason: 'exceeds_window' }
      : { targetChars, estimatedTokens: built.estimatedTokens }
  })
  return {
    contextLength: budget.contextLength,
    inputLimit: budget.inputLimit,
    rungs,
  }
}
