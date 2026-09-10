/**
 * 超长命令落盘：正文已经生成，不再让模型重写一遍。
 * 只写文件、不执行；远程写到将要跑命令的那台机器。
 */
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from '../../../utils/logger'
import { t } from '../i18n'
import { getScratchPath } from '../workspace-paths'
import type { ToolExecutorConfig, ToolResult } from './types'

const log = createLogger('CommandPersist')

/** 远程落盘含 SFTP 建连，必须有上限，避免「本应拒绝」的路径反而卡住整场 */
const REMOTE_PERSIST_TIMEOUT_MS = 15_000

export type PersistDest =
  | { kind: 'local' }
  | { kind: 'remote'; ptyId: string; executor: ToolExecutorConfig }

export type PersistResult =
  | { ok: true; filePath: string; remote: boolean }
  | { ok: false; reason: string }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function stampParts(now = new Date()): { day: string; time: string; nonce: string } {
  const day = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return { day, time, nonce: crypto.randomBytes(4).toString('hex') }
}

async function withTimeout<T>(work: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function scriptExt(dest: PersistDest): string {
  if (dest.kind === 'remote') return '.sh'
  return process.platform === 'win32' ? '.ps1' : '.sh'
}

function asScriptBody(command: string): string {
  return command.endsWith('\n') ? command : `${command}\n`
}

function localScriptPath(dest: PersistDest): string {
  const { day, time, nonce } = stampParts()
  return path.join(getScratchPath(), 'oversized-commands', day, `cmd-${time}-${nonce}${scriptExt(dest)}`)
}

function remoteScriptDir(): string {
  const { day, time, nonce } = stampParts()
  return `/tmp/sailfish-cmd-${day}-${time}-${nonce}`
}

async function persistLocal(command: string, dest: Extract<PersistDest, { kind: 'local' }>): Promise<PersistResult> {
  const filePath = localScriptPath(dest)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  // 落在 scratch 下，跟既有临时区过期清理走，不另起一套
  await fs.promises.writeFile(filePath, asScriptBody(command), { encoding: 'utf-8', mode: 0o600 })
  log.info(`oversized command persisted locally: ${filePath} (${command.length} chars)`)
  return { ok: true, filePath, remote: false }
}

async function persistRemote(
  command: string,
  dest: Extract<PersistDest, { kind: 'remote' }>
): Promise<PersistResult> {
  const { ptyId, executor } = dest
  if (executor.isAborted()) return { ok: false, reason: t('error.operation_aborted') }

  const sftpService = executor.getSftpService?.()
  const sshConfig = executor.getSshConfig?.(ptyId)
  if (!sftpService) return { ok: false, reason: t('error.sftp_not_initialized') }
  if (!sshConfig) return { ok: false, reason: t('error.ssh_config_unavailable') }

  const dir = remoteScriptDir()
  const filePath = `${dir}/cmd.sh`

  await withTimeout((async () => {
    if (!sftpService.hasSession(ptyId)) {
      await sftpService.connect(ptyId, {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        password: sshConfig.password,
        privateKey: sshConfig.privateKey,
        privateKeyPath: sshConfig.privateKeyPath,
        passphrase: sshConfig.passphrase,
      })
    }
    await sftpService.mkdir(ptyId, dir, true)
    await sftpService.chmod(ptyId, dir, 0o700)
    await sftpService.writeFile(ptyId, filePath, asScriptBody(command))
    await sftpService.chmod(ptyId, filePath, 0o600)
  })(), REMOTE_PERSIST_TIMEOUT_MS, t('hint.command_too_long_remote_timeout'))

  log.info(`oversized command persisted remotely: ${filePath} (${command.length} chars)`)
  return { ok: true, filePath, remote: true }
}

export async function persistOversizedCommand(command: string, dest: PersistDest): Promise<PersistResult> {
  try {
    return dest.kind === 'remote' ? await persistRemote(command, dest) : await persistLocal(command, dest)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn(`failed to persist oversized command: ${reason}`)
    return { ok: false, reason }
  }
}

export function formatOversizedCommandMessage(opts: {
  length: number
  max: number
  saved?: { filePath: string; remote: boolean }
  saveError?: string
}): string {
  const head = t('hint.command_too_long', { length: opts.length, max: opts.max })
  if (opts.saved) {
    const tail = opts.saved.remote
      ? t('hint.command_too_long_saved_remote', { path: opts.saved.filePath })
      : t('hint.command_too_long_saved', { path: opts.saved.filePath })
    return `${head} ${tail}`
  }
  const reason = (opts.saveError ?? '').trim()
  if (!reason) return head
  return `${head} ${t('hint.command_too_long_save_failed', { reason })}`
}

export async function rejectOversizedCommand(opts: {
  command: string
  maxChars: number
  toolName: string
  executor: ToolExecutorConfig
  remotePtyId?: string
}): Promise<ToolResult> {
  const dest: PersistDest = opts.remotePtyId
    ? { kind: 'remote', ptyId: opts.remotePtyId, executor: opts.executor }
    : { kind: 'local' }
  const persisted = await persistOversizedCommand(opts.command, dest)
  const errorMsg = persisted.ok
    ? formatOversizedCommandMessage({
        length: opts.command.length,
        max: opts.maxChars,
        saved: { filePath: persisted.filePath, remote: persisted.remote },
      })
    : formatOversizedCommandMessage({
        length: opts.command.length,
        max: opts.maxChars,
        saveError: persisted.reason,
      })

  opts.executor.addStep({
    type: 'tool_call',
    content: `🚫 ${opts.command.slice(0, 100)}...`,
    toolName: opts.toolName,
    toolArgs: { command: opts.command.slice(0, 100) + '...' },
    riskLevel: 'blocked',
  })
  opts.executor.addStep({
    type: 'tool_result',
    content: errorMsg,
    toolName: opts.toolName,
    toolResult: errorMsg,
  })
  return { success: false, output: '', error: errorMsg }
}
