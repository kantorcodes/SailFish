/**
 * 当前对话里已经有一份足够长、逐字相同的工具原文时，只回引用。
 * 不猜内容类型——原文不在或内容和上次不一样，照常全文返回。
 * 同一轮里连着回来的几份也算：先到的留全文，后面的改引用。
 */
import type { AiMessage } from '../ai.service'
import type { ToolResult } from './types'
import { t } from './i18n'

/** 短于这个长度不值得改成引用（单次落盘管的是「一次太大」） */
export const REPEATED_TOOL_OUTPUT_MIN_CHARS = 1500

export function reduceRepeatedToolOutput(
  messages: AiMessage[],
  result: ToolResult,
  minChars = REPEATED_TOOL_OUTPUT_MIN_CHARS
): ToolResult {
  if (!result.success) return result
  const output = result.output
  if (!output || output.length < minChars) return result

  const original = messages.find(m => m.role === 'tool' && m.content === output)
  if (!original) return result

  return {
    ...result,
    output: t('tool_output.repeated_ref', {
      id: original.tool_call_id || '?',
      chars: output.length
    })
  }
}

/** 同一批结果按顺序去重：第一份留全文，后面相同的改引用。 */
export function collapseRepeatedToolOutputs(
  messages: AiMessage[],
  items: Array<{ id: string; result: ToolResult }>,
  minChars = REPEATED_TOOL_OUTPUT_MIN_CHARS
): ToolResult[] {
  const seen: AiMessage[] = [...messages]
  return items.map((item) => {
    const reduced = reduceRepeatedToolOutput(seen, item.result, minChars)
    if (item.result.success && item.result.output) {
      seen.push({
        role: 'tool',
        tool_call_id: item.id,
        content: item.result.output
      })
    }
    return reduced
  })
}
