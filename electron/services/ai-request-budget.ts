/**
 * 一次请求「能发多少输入」的共用计算。
 *
 * 界面用量仍按整窗；这里只回答「发出去会不会先把输出额度挤没」。
 * 指定配置找不到时由调用方传 undefined，按保守窗口估，不借另一套模型的窗口。
 */
import type { AiProfile } from '@shared/types'

/** 用户未指定时的单次输出上限。主流云端模型均不低于此数。 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 32_768
export const DEFAULT_CONTEXT_LENGTH = 128_000
export const REQUEST_SAFETY_MARGIN_TOKENS = 1024
/** 写交接小结时单独收紧输出，避免小结自己把窗口吃满 */
export const SUMMARY_MAX_OUTPUT_TOKENS = 2048

export interface RequestBudget {
  contextLength: number
  outputTokens: number
  inputLimit: number
}

function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

/**
 * 能发的输入 = 窗口 − 这次输出额度 − 一点余量。
 * 未指定输出、或报的输出 ≥ 窗口：不超过默认 32768，也不超过窗口的四分之一。
 * 指定了更小的输出时听这个数，但仍保证输入至少留下窗口的四分之一。
 */
export function resolveRequestBudget(
  profile?: Pick<AiProfile, 'contextLength' | 'maxOutputTokens'> | null,
  outputOverride?: number
): RequestBudget {
  const contextLength = asPositiveInt(profile?.contextLength) ?? DEFAULT_CONTEXT_LENGTH
  const configuredOutput = asPositiveInt(outputOverride) ?? asPositiveInt(profile?.maxOutputTokens)
  const quarterWindow = Math.max(1, Math.floor(contextLength / 4))
  // 对方报的数跟窗口一样大或更大：那是「最多能写这么多」，不是每次都要预留的额度
  const usableConfigured =
    configuredOutput && configuredOutput < contextLength ? configuredOutput : undefined
  // 没填（或报的数不可用）按三万二，同时不超过窗口的四分之一——避免小窗口被默认输出掏空
  const uncappedOutput = usableConfigured ?? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, quarterWindow)
  // 预留输出不能把输入空间吃到低于窗口四分之一
  const maxOutputToLeaveInput = Math.max(1, contextLength - quarterWindow - REQUEST_SAFETY_MARGIN_TOKENS)
  const outputTokens = Math.min(uncappedOutput, maxOutputToLeaveInput)
  const inputLimit = Math.max(1, contextLength - outputTokens - REQUEST_SAFETY_MARGIN_TOKENS)
  return { contextLength, outputTokens, inputLimit }
}
