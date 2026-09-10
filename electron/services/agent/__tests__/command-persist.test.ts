/**
 * 超长命令落盘：正文已有则写入文件，提示只陈述事实，不让模型重写。
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TEST_USERDATA = path.join(os.tmpdir(), 'sailfish-command-persist-test')

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockImplementation(() => TEST_USERDATA),
    getName: vi.fn().mockReturnValue('SailFish'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
  },
}))

import {
  persistOversizedCommand,
  formatOversizedCommandMessage,
  rejectOversizedCommand,
} from '../tools/command-persist'
import type { ToolExecutorConfig } from '../tools/types'

afterAll(() => {
  fs.rmSync(TEST_USERDATA, { recursive: true, force: true })
})

function stubExecutor(overrides: Partial<ToolExecutorConfig> = {}): ToolExecutorConfig {
  return {
    addStep: vi.fn(),
    isAborted: () => false,
    ...overrides,
  } as unknown as ToolExecutorConfig
}

describe('persistOversizedCommand', () => {
  it('本机落盘：正文原样写入，缺换行则补一行', async () => {
    const command = 'python3 -c "print(1)"'
    const result = await persistOversizedCommand(command, { kind: 'local' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remote).toBe(false)
    expect(result.filePath).toContain('oversized-commands')
    expect(fs.readFileSync(result.filePath, 'utf-8')).toBe(command + '\n')
  })

  it('本机落盘：已有末尾换行则不重复追加', async () => {
    const command = 'echo hi\n'
    const result = await persistOversizedCommand(command, { kind: 'local' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.readFileSync(result.filePath, 'utf-8')).toBe(command)
  })

  it('远程落盘：写到对面仅属主目录，不写本机', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const connect = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const chmod = vi.fn().mockResolvedValue(undefined)
    const executor = stubExecutor({
      getSftpService: () => ({
        hasSession: () => false,
        connect,
        mkdir,
        writeFile,
        chmod,
      } as never),
      getSshConfig: () => ({ host: 'example', port: 22, username: 'u' } as never),
    })

    const command = 'echo remote'
    const result = await persistOversizedCommand(command, {
      kind: 'remote',
      ptyId: 'pty-1',
      executor,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remote).toBe(true)
    expect(result.filePath).toMatch(/^\/tmp\/sailfish-cmd-.+\/cmd\.sh$/)
    expect(connect).toHaveBeenCalled()
    expect(mkdir).toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledWith('pty-1', result.filePath, command + '\n')
    expect(chmod).toHaveBeenCalledWith('pty-1', path.posix.dirname(result.filePath), 0o700)
    expect(chmod).toHaveBeenCalledWith('pty-1', result.filePath, 0o600)
    expect(fs.existsSync(result.filePath)).toBe(false)
  })

  it('远程已中止则不建连', async () => {
    const connect = vi.fn()
    const result = await persistOversizedCommand('echo x', {
      kind: 'remote',
      ptyId: 'pty-1',
      executor: stubExecutor({
        isAborted: () => true,
        getSftpService: () => ({ connect, hasSession: () => false } as never),
        getSshConfig: () => ({ host: 'example', port: 22, username: 'u' } as never),
      }),
    })
    expect(result.ok).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })

  it('远程无 SFTP 时失败，不抛错', async () => {
    const result = await persistOversizedCommand('echo x', {
      kind: 'remote',
      ptyId: 'pty-1',
      executor: stubExecutor({
        getSftpService: () => undefined,
        getSshConfig: () => ({ host: 'example', port: 22, username: 'u' } as never),
      }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.length).toBeGreaterThan(0)
  })
})

describe('formatOversizedCommandMessage', () => {
  it('落盘成功：陈述路径并可直接执行，不点名写文件工具', () => {
    const msg = formatOversizedCommandMessage({
      length: 72778,
      max: 35000,
      saved: { filePath: '/tmp/sailfish-cmd.sh', remote: false },
    })
    expect(msg).toContain('72778')
    expect(msg).toContain('35000')
    expect(msg).toContain('/tmp/sailfish-cmd.sh')
    expect(msg).toMatch(/可直接执行脚本文件|not executed/)
    expect(msg).not.toContain('write_text_file')
    expect(msg).not.toContain('write_remote_text_file')
  })

  it('远程落盘：标明在远程主机', () => {
    const msg = formatOversizedCommandMessage({
      length: 100,
      max: 50,
      saved: { filePath: '/tmp/sailfish-cmd.sh', remote: true },
    })
    expect(msg).toMatch(/远程主机|remote host/)
    expect(msg).toContain('/tmp/sailfish-cmd.sh')
    expect(msg).not.toContain('write_text_file')
  })

  it('落盘失败：只报原因，不改口让它重写', () => {
    const msg = formatOversizedCommandMessage({
      length: 100,
      max: 50,
      saveError: 'disk full',
    })
    expect(msg).toContain('disk full')
    expect(msg).not.toContain('write_text_file')
    expect(msg).not.toContain('write_remote_text_file')
  })

  it('落盘失败且没有原因：只陈述过长，不带空冒号', () => {
    const msg = formatOversizedCommandMessage({
      length: 100,
      max: 50,
      saveError: '   ',
    })
    expect(msg).toContain('100')
    expect(msg).not.toMatch(/：\s*$/)
    expect(msg).not.toContain('write_text_file')
  })
})

describe('rejectOversizedCommand', () => {
  it('返回失败结果，步骤里带上落盘路径', async () => {
    const addStep = vi.fn()
    const executor = stubExecutor({ addStep })
    const command = 'x'.repeat(200)
    const result = await rejectOversizedCommand({
      command,
      maxChars: 50,
      toolName: 'execute_command',
      executor,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.error).not.toContain('write_text_file')
    expect(result.error).toContain('oversized-commands')
    expect(addStep).toHaveBeenCalledTimes(2)
  })
})
