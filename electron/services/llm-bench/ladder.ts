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
  /** 按字数排好，含要跳过的档。 */
  rungs: Array<{ targetChars: number; estimatedTokens: number; skipReason?: string }>
  /** 跑的是不是冻住的那整套档位。不是的话分数只能跟同样档位的报告比。 */
  standard: boolean
}

/** 跑的档位是不是冻住的那一整套（超窗口被跳过的仍算标准，那是这款模型的实情）。 */
function isStandardLadder(targets: number[]): boolean {
  const want = [...DEFAULT_BENCH_RUNGS].sort((a, b) => a - b)
  return targets.length === want.length && targets.every((n, i) => n === want[i])
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
    // 底稿自带系统说明、用户话、指令和整份工具清单，太短的档凑不出那个字数。
    // 判法是「真发出去的字数对不上表上写的」——比估一个底稿长度去卡更准，
    // 底稿长度本身还随档位位数浮动，估出来的界线会在边界上漏掉几个档
    if (built.charCount !== targetChars) {
      return { targetChars, estimatedTokens: built.estimatedTokens, skipReason: 'below_base' }
    }
    return built.estimatedTokens > budget.inputLimit
      ? { targetChars, estimatedTokens: built.estimatedTokens, skipReason: 'exceeds_window' }
      : { targetChars, estimatedTokens: built.estimatedTokens }
  })
  return {
    contextLength: budget.contextLength,
    inputLimit: budget.inputLimit,
    rungs,
    standard: isStandardLadder(requested),
  }
}
