import type { AiMessage, ToolCall, ToolDefinition } from '../ai.service'
import { estimateTextTokens } from '../agent/token-estimate'
import { BENCH_SUITE_VERSION, type BenchSection } from './types'
import { BENCH_TOOLS } from './suite-tools'

export { BENCH_SUITE_VERSION, BENCH_TOOLS }

export const BENCH_TOOL_PATH = '/tmp/sailfish-bench-probe.txt'

export const BENCH_TOOL_OBSERVATION = [
  '这是压测用的冻住文件内容，不是本机真文件。',
  '周报草稿第三点：预算对齐改到下周一，数据由丙方核对。',
  '待办未勾：寄发票、回客户邮件、更新看板。',
].join('\n')

/** 冻住的指定正文，每一档长度都原样抄这一段。 */
export const BENCH_OUTPUT_PASSAGE = [
  '本周工作对齐如下。产品侧完成设置页改版草案，待设计确认间距和暗色对比。',
  '工程侧修了远程会话重连后输出丢行的问题，回归尚未跑满。',
  '商务侧客户要一份能力清单，周五前给初稿，不要写未上线的承诺。',
  '风险：跳板机证书下周三过期，需要提前轮换，否则周五演示连不上。',
  '待办：寄发票、回两封询盘、把看板里卡住的三张票分给值班。',
  '下周一只对齐预算数字，不讨论新需求。纪要发出前先给老板过一眼。',
].join('')

/**
 * 冻住的系统说明主体：块齐全，份量像旗鱼助手真在发。
 * 各轴自己的收尾指令另拼，避免短回说明污染输出和工具轴。
 */
export const BENCH_SYSTEM_CORE = [
  '用中文回复。用户用中文时始终用中文。',
  '',
  '你是旗鱼（SailFish）AI Agent，一个能帮助用户完成各类任务的智能助手。',
  '软件启动时间：2026-09-18 09:00:00',
  '每条用户消息开头的 [时间] 标记由系统自动注入，表示该消息的发送时间。',
  '',
  '你沉稳、直接、少废话。先做再解释。不确定就查，不要编。',
  '',
  '# 用户',
  '- 称呼：老板',
  '- 时区：Asia/Shanghai',
  '- 常用：本机文件、周报、待办、偶尔连公司跳板机',
  '',
  '# 私有工作空间',
  '- `/Users/demo/.sailfish/agent-workspace` 是你的默认工作目录：临时脚本、草稿、中间产物放这里，读写无需确认。',
  '- 免确认只认绝对路径。用户要长期保留的最终产物请写到桌面、文档等正式目录。',
  '- 文件名即用户可见名，用简洁可读的中文名，禁止时间戳和随机 ID。',
  '- USER.md：用户画像。待办用 todo 技能，数据在 TODO.json。CONTACTS.md：联系人。',
  '',
  '# 核心规则',
  '- 先读再改。改文件前必须先 read_file。',
  '- 能用工具就不要空口猜路径、猜文件内容。',
  '- 危险命令要说清楚再做。删除、覆盖、发到外部渠道之前想清楚。',
  '- 不要把密钥、Cookie、密码写进回复或文件。',
  '- 窗口快满时先自己交接，再继续干。',
  '',
  '# 可用技能',
  'excel / word / pdf / email / browser / calendar / todo / chart / personality / skill-manager',
  '涉及表格、文档、邮件、浏览器时先 skill load 再做。',
  '',
  '# 环境',
  '- 形态：独立助手（无眼前终端窗格）',
  '- 系统：macOS 15.6，shell：zsh',
  '- 当前目录：/Users/demo/Documents',
  '- 浏览器助手：未连接',
  '- MCP：未连接',
  '- 执行模式：宽松——普通操作自动执行，危险操作需确认',
  '',
  '# 主机备忘',
  '本机是开发机。桌面常放周报草稿。公司跳板机别名 jump，办公网 10.0.0.0/8。nginx 没有在本机常驻。',
  '',
  '# 历史任务',
  '对话历史里带着你说过的话。窗口真满了会交接。需要取回更早整轮时用 recall。',
  '- `task-20260917-weekly`：整理上周周报提纲',
  '- `task-20260916-inbox`：清了一轮邮件待办',
].join('\n')

const SYSTEM_CLOSER: Record<BenchSection, string> = {
  context: '本轮是标准化接口压测。不要调用任何工具。只输出指定正文，不要加别的字。',
  tools: '本轮是标准化接口压测。必须调用指定工具，不要用文字代替。',
  concurrency: '本轮是标准化接口压测。不要调用任何工具。只回复：好',
}

export const BENCH_USER_INSTRUCTION = [
  '[时间 2026-09-18 10:12]',
  '帮我理一下这周工作：桌面上有一份周报草稿，待办里还有几条没勾。先看内容，不要改文件。',
  '本轮压测，不要调用工具，只回复：好',
  '--- 以下是垫上下文的历史摘录，请忽略 ---',
].join('\n')

export const BENCH_USER_OUTPUT = [
  '[时间 2026-09-18 10:12]',
  '请把下面「指定正文」原样输出一遍，一个字都不要多，不要调用工具。',
  '--- 指定正文 ---',
  BENCH_OUTPUT_PASSAGE,
  '--- 以上是指定正文 ---',
  '--- 以下是垫上下文的历史摘录，请忽略 ---',
].join('\n')

export const BENCH_USER_TOOL = [
  '[时间 2026-09-18 10:12]',
  `请调用 read_file，path 固定为 ${BENCH_TOOL_PATH}。不要用文字代替工具调用，不要回复别的。`,
  '--- 以下是垫上下文的历史摘录，请忽略 ---',
].join('\n')

/** 短回题的系统说明（上下文 / 并发）。 */
export const BENCH_SYSTEM_PROMPT = `${BENCH_SYSTEM_CORE}\n\n${SYSTEM_CLOSER.context}`

function userHeadFor(axis: BenchSection): string {
  if (axis === 'context') return BENCH_USER_OUTPUT
  if (axis === 'tools') return BENCH_USER_TOOL
  return BENCH_USER_INSTRUCTION
}

function systemFor(axis: BenchSection): string {
  return `${BENCH_SYSTEM_CORE}\n\n${SYSTEM_CLOSER[axis]}`
}

/** 挡开各档、各轴、各路共享的前缀。 */
export function benchIsolateLine(targetChars: number, axis: BenchSection = 'context', lane = 0): string {
  return `${BENCH_SUITE_VERSION} 隔离=${targetChars} 轴=${axis} 路=${lane}`
}

export function benchPadUnit(targetChars: number): string {
  return `（档${targetChars}）会议室纪要补充：甲方确认下周一对齐预算，乙方先出草稿，丙方负责数据核对。`
}

export interface BuiltBenchRequest {
  messages: AiMessage[]
  tools: ToolDefinition[]
  charCount: number
  estimatedTokens: number
}

export function countChars(text: string): number {
  return text.length
}

export function estimateBenchBaseChars(
  targetChars: number,
  axis: BenchSection = 'context',
  lane = 0,
): number {
  const isolate = benchIsolateLine(targetChars, axis, lane)
  return countChars(`${isolate}\n${systemFor(axis)}`)
    + countChars(`${isolate}\n${userHeadFor(axis)}`)
}

export function padToTargetChars(baseChars: number, targetChars: number): string {
  const need = targetChars - baseChars
  if (need <= 0) return ''
  const unit = benchPadUnit(targetChars)
  const units = Math.ceil(need / unit.length)
  let pad = unit.repeat(units)
  while (baseChars + pad.length > targetChars && pad.length > unit.length) {
    pad = pad.slice(0, pad.length - unit.length)
  }
  while (baseChars + pad.length < targetChars) {
    pad += '甲'
  }
  if (baseChars + pad.length > targetChars) {
    pad = pad.slice(0, Math.max(0, targetChars - baseChars))
  }
  return pad
}

export function buildBenchRequest(
  targetChars: number,
  axis: BenchSection = 'context',
  lane = 0,
): BuiltBenchRequest {
  const isolate = benchIsolateLine(targetChars, axis, lane)
  const system = `${isolate}\n${systemFor(axis)}`
  const userHead = `${isolate}\n${userHeadFor(axis)}`
  const headChars = countChars(system) + countChars(userHead)
  const ballast = padToTargetChars(headChars + 1, targetChars)
  const userContent = ballast ? `${userHead}\n${ballast}` : userHead
  const messages: AiMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ]
  const charCount = countChars(system) + countChars(userContent)
  const estimatedTokens = estimateTextTokens(system)
    + estimateTextTokens(userContent)
    + estimateTextTokens(JSON.stringify(BENCH_TOOLS))
  return { messages, tools: BENCH_TOOLS, charCount, estimatedTokens }
}

export function buildToolFollowUp(first: BuiltBenchRequest, toolCalls: ToolCall[]): AiMessage[] {
  const follow: AiMessage[] = [
    ...first.messages,
    { role: 'assistant', content: '', tool_calls: toolCalls },
  ]
  for (const call of toolCalls) {
    follow.push({
      role: 'tool',
      tool_call_id: call.id,
      content: BENCH_TOOL_OBSERVATION,
    })
  }
  return follow
}
