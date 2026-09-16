/**
 * 新建撞上已有文件：按普通覆盖处理，不再早失败、不再让模型整段重写。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    getName: vi.fn().mockReturnValue('SailFish'),
    getVersion: vi.fn().mockReturnValue('1.0.0')
  },
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() }
}))

vi.mock('../../im/im.service', () => ({
  getIMService: vi.fn().mockReturnValue(null)
}))

vi.mock('../../user-skill.service', () => ({
  getUserSkillService: () => ({ getEnabledSkills: () => [] })
}))

vi.mock('../../config.service', () => ({
  getConfigService: () => ({ get: () => undefined })
}))

vi.mock('../../web-search/index', () => ({
  isConfigured: () => false,
  getApiKey: () => ''
}))

vi.mock('../../terminal-state.service', () => ({
  getTerminalStateService: () => ({ getState: () => null })
}))

import { getAgentTools } from '../tools'
import type { ToolDefinitionWithMeta } from '../tools'
import { writeTextFile, writeRemoteTextFile } from '../tools/file'
import type { ToolExecutorConfig } from '../tools/types'
import type { AgentConfig } from '../types'

function makeConfig(executionMode: AgentConfig['executionMode'] = 'relaxed'): AgentConfig {
  return {
    enabled: true,
    maxSteps: 0,
    commandTimeout: 30000,
    autoExecuteSafe: true,
    autoExecuteModerate: true,
    executionMode,
    debugMode: false,
  }
}

function makeExecutor(waitForConfirmation = vi.fn().mockResolvedValue(true)): ToolExecutorConfig {
  return {
    terminalService: { write: vi.fn() } as unknown as ToolExecutorConfig['terminalService'],
    addStep: vi.fn().mockImplementation((step) => ({ ...step, id: 's1', timestamp: Date.now() })),
    updateStep: vi.fn(),
    waitForConfirmation,
    requestSecureInput: vi.fn(),
    isAborted: () => false,
    getHostId: () => undefined,
    hasPendingUserMessage: () => false,
    peekPendingUserMessage: () => undefined,
    consumePendingUserMessage: () => undefined,
    getRealtimeTerminalOutput: () => [],
    getCurrentPlan: () => undefined,
    setCurrentPlan: vi.fn(),
    getTaskMemory: vi.fn(),
  } as unknown as ToolExecutorConfig
}

describe('write_text_file 新建撞上已有文件', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sft-create-exists-'))
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('不再对流式新建做早失败', () => {
    const tools = getAgentTools(undefined, { mode: 'assistant' })
    const write = tools.find((t) => t.function.name === 'write_text_file') as ToolDefinitionWithMeta | undefined
    expect(write?._meta?.streamValidate).toBeUndefined()
  })

  it('自由区已有文件：直接覆盖，不问', async () => {
    const filePath = path.join('/tmp', `sft-create-exists-${Date.now()}.txt`)
    fs.writeFileSync(filePath, 'old')
    const confirm = vi.fn().mockResolvedValue(true)
    try {
      const result = await writeTextFile(
        'pty1',
        { path: filePath, mode: 'create', content: 'new' },
        'tc1',
        makeConfig('relaxed'),
        makeExecutor(confirm),
      )
      expect(result.success).toBe(true)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(filePath, { force: true })
    }
  })

  it('工作区外已有文件：按覆盖询问', async () => {
    const filePath = path.join(os.homedir(), `sft-create-exists-${Date.now()}.txt`)
    fs.writeFileSync(filePath, 'old')
    const confirm = vi.fn().mockResolvedValue(true)
    try {
      const result = await writeTextFile(
        'pty1',
        { path: filePath, mode: 'create', content: 'new' },
        'tc1',
        makeConfig('relaxed'),
        makeExecutor(confirm),
      )
      expect(result.success).toBe(true)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new')
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm.mock.calls[0][2]).toMatchObject({ mode: 'overwrite', path: filePath })
      expect(confirm.mock.calls[0][3]).toBe('dangerous')
    } finally {
      fs.rmSync(filePath, { force: true })
    }
  })

  it('你不同意覆盖则不写', async () => {
    const filePath = path.join(os.homedir(), `sft-create-exists-reject-${Date.now()}.txt`)
    fs.writeFileSync(filePath, 'old')
    const confirm = vi.fn().mockResolvedValue(false)
    try {
      const result = await writeTextFile(
        'pty1',
        { path: filePath, mode: 'create', content: 'new' },
        'tc1',
        makeConfig('relaxed'),
        makeExecutor(confirm),
      )
      expect(result.success).toBe(false)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('old')
    } finally {
      fs.rmSync(filePath, { force: true })
    }
  })

  it('远程已有文件：只按覆盖问一次', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const executor = makeExecutor(confirm)
    executor.getSftpService = () => ({
      hasSession: () => true,
      exists: vi.fn().mockResolvedValue('-'),
      writeFile,
    }) as never
    executor.getSshConfig = () => ({ host: 'h', port: 22, username: 'u' }) as never

    const result = await writeRemoteTextFile(
      'pty1',
      { path: '/home/u/out.html', mode: 'create', content: 'new' },
      'tc1',
      makeConfig('relaxed'),
      executor,
    )
    expect(result.success).toBe(true)
    expect(writeFile).toHaveBeenCalledWith('pty1', '/home/u/out.html', 'new')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][2]).toMatchObject({ mode: 'overwrite', path: '/home/u/out.html' })
    expect(confirm.mock.calls[0][3]).toBe('dangerous')
  })

  it('目标不存在时仍是新建', async () => {
    const filePath = path.join(tmpRoot, 'brand-new.txt')
    const confirm = vi.fn().mockResolvedValue(true)
    const result = await writeTextFile(
      'pty1',
      { path: filePath, mode: 'create', content: 'hello' },
      'tc1',
      makeConfig('relaxed'),
      makeExecutor(confirm),
    )
    expect(result.success).toBe(true)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello')
    expect(confirm).not.toHaveBeenCalled()
  })
})
