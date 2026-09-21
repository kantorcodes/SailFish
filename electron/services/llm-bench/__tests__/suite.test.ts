import { describe, expect, it } from 'vitest'
import {
  BENCH_SUITE_VERSION,
  BENCH_SYSTEM_PROMPT,
  BENCH_TOOLS,
  BENCH_USER_INSTRUCTION,
  buildBenchRequest,
  estimateBenchBaseChars,
  padToTargetChars,
} from '../suite'

describe('llm-bench suite', () => {
  it('题版本锁死', () => {
    expect(BENCH_SUITE_VERSION).toBe('sailfish-bench-v6')
  })

  it('工具清单冻住完整一套，不读运行时工具表', () => {
    const names = BENCH_TOOLS.map(t => t.function.name)
    expect(names).toEqual([
      'exec', 'await_exec', 'read_file', 'file_search', 'search_knowledge',
      'get_knowledge_doc', 'web_search', 'web_fetch', 'edit_file', 'write_text_file',
      'write_remote_text_file', 'sftp_put', 'sftp_get', 'skill', 'ask_user',
      'plan', 'recall', 'search_history', 'dispatch_agents', 'wait_agents',
      'manage_pane', 'list_ssh_sessions', 'talk_to_user', 'context', 'manage_memory',
    ])
  })

  it('系统说明、用户话、工具三块都在，而且是中文', () => {
    const built = buildBenchRequest(4_000)
    expect(built.messages[0].content).toContain('你是旗鱼')
    expect(built.messages[0].content).toContain('核心规则')
    expect(built.messages[0].content).toContain('私有工作空间')
    expect(built.messages[1].content).toContain('指定正文')
    expect(BENCH_SYSTEM_PROMPT).toMatch(/[\u4e00-\u9fff]/)
    expect(BENCH_USER_INSTRUCTION).toMatch(/[\u4e00-\u9fff]/)
    expect(built.tools.length).toBe(BENCH_TOOLS.length)
  })

  it('垫到目标字数', () => {
    const target = 4_000
    const built = buildBenchRequest(target)
    expect(built.charCount).toBe(target)
    expect(built.messages[1].content).toContain('会议室纪要补充')
  })

  it('要做的事压在垫料之后，紧挨着生成处', () => {
    for (const axis of ['context', 'tools', 'concurrency'] as const) {
      const built = buildBenchRequest(128_000, axis)
      const user = built.messages[1].content as string
      const askAt = user.indexOf('现在是本轮要做的事')
      const ballastAt = user.indexOf('会议室纪要补充')
      expect(askAt).toBeGreaterThan(ballastAt)
      // 指令离结尾不超过几百字，不再被十几万字垫料埋在前面
      expect(user.length - askAt).toBeLessThan(500)
    }
  })

  it('目标小于底座时不垫', () => {
    const base = estimateBenchBaseChars(4_000)
    const pad = padToTargetChars(base, Math.max(1, base - 100))
    expect(pad).toBe('')
  })

  it('填充可复现', () => {
    const a = buildBenchRequest(8_000)
    const b = buildBenchRequest(8_000)
    expect(a.messages[1].content).toBe(b.messages[1].content)
    expect(a.charCount).toBe(8_000)
  })

  it('不同长度不共享前缀，避免吃上一档缓存', () => {
    const short = buildBenchRequest(4_000)
    const long = buildBenchRequest(16_000)
    expect(long.messages[0].content.startsWith(short.messages[0].content)).toBe(false)
    expect(long.messages[1].content.startsWith(short.messages[1].content)).toBe(false)
    expect(short.messages[0].content).toContain('隔离=4000')
    expect(long.messages[0].content).toContain('隔离=16000')
  })

  it('长度档带指定正文，并发短回不共享前缀', () => {
    const context = buildBenchRequest(4_000, 'context')
    const concurrent = buildBenchRequest(4_000, 'concurrency')
    expect(context.messages[1].content).toContain('指定正文')
    expect(concurrent.messages[1].content).toContain('只回复：好')
    expect(context.messages[0].content.startsWith(concurrent.messages[0].content)).toBe(false)
    expect(context.charCount).toBe(4_000)
  })

  it('工具轴要求读冻住路径', () => {
    const built = buildBenchRequest(4_000, 'tools')
    expect(built.messages[1].content).toContain('/tmp/sailfish-bench-probe.txt')
    expect(built.messages[1].content).toContain('read_file')
  })

  it('三路并发题头互不相同', () => {
    const a = buildBenchRequest(4_000, 'concurrency', 1)
    const b = buildBenchRequest(4_000, 'concurrency', 2)
    expect(a.messages[0].content.startsWith(b.messages[0].content)).toBe(false)
    expect(a.messages[0].content).toContain('路=1')
    expect(b.messages[0].content).toContain('路=2')
  })
})
