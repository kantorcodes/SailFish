/**
 * 图表数据文件：异步读绝对路径，只把结构摘要交给对话，数组正文留在本机。
 */
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import { isUserDataForbidden } from '../../command-audit/userdata-guard'
import { isLexicallyAbsolutePath, resolveCommandPath } from '../../command-audit/workspace-guard'
import { t } from '../../i18n'

export const CHART_JSON_MAX_BYTES = 8 * 1024 * 1024

export type ExclusiveSource =
  | { kind: 'inline' }
  | { kind: 'file'; path: string }
  | { kind: 'error'; reason: 'both' | 'neither' }

export function resolveExclusiveSource(inline: unknown, file: unknown): ExclusiveSource {
  const hasInline = inline !== undefined && inline !== null && inline !== ''
  const hasFile = typeof file === 'string' && file.trim().length > 0
  if (hasInline && hasFile) return { kind: 'error', reason: 'both' }
  if (!hasInline && !hasFile) return { kind: 'error', reason: 'neither' }
  if (hasFile) return { kind: 'file', path: (file as string).trim() }
  return { kind: 'inline' }
}

export interface ChartJsonSummary {
  path: string
  bytes: number
  sha256: string
  root: 'array' | 'object' | 'string' | 'number' | 'boolean' | 'null'
  length?: number
  keys?: string[]
  itemKeys?: string[]
  arrayLengths?: Record<string, number>
}

export interface ChartJsonFile {
  path: string
  value: unknown
  summary: ChartJsonSummary
}

function rootKind(value: unknown): ChartJsonSummary['root'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const kind = typeof value
  if (kind === 'object' || kind === 'string' || kind === 'number' || kind === 'boolean') return kind
  return 'null'
}

export function summarizeChartJson(
  filePath: string,
  bytes: number,
  sha256: string,
  value: unknown
): ChartJsonSummary {
  const summary: ChartJsonSummary = { path: filePath, bytes, sha256, root: rootKind(value) }
  if (Array.isArray(value)) {
    summary.length = value.length
    const first = value[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      summary.itemKeys = Object.keys(first)
    }
    return summary
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    summary.keys = Object.keys(obj)
    const arrayLengths: Record<string, number> = {}
    for (const [key, item] of Object.entries(obj)) {
      if (Array.isArray(item)) arrayLengths[key] = item.length
    }
    if (Object.keys(arrayLengths).length > 0) summary.arrayLengths = arrayLengths
  }
  return summary
}

export async function readChartJsonFile(rawPath: string): Promise<ChartJsonFile> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error(t('chart.file_path_required'))
  }

  const trimmed = rawPath.trim()
  if (!isLexicallyAbsolutePath(trimmed)) {
    throw new Error(t('chart.file_path_must_be_absolute', { path: trimmed }))
  }

  const expanded = resolveCommandPath(trimmed)
  if (isUserDataForbidden(expanded, undefined, 'read')) {
    throw new Error(t('chart.file_forbidden', { path: expanded }))
  }

  let filePath: string
  try {
    filePath = await fs.realpath(expanded)
  } catch {
    throw new Error(t('chart.file_not_found', { path: expanded }))
  }

  if (isUserDataForbidden(filePath, undefined, 'read')) {
    throw new Error(t('chart.file_forbidden', { path: filePath }))
  }

  const fh = await fs.open(filePath, 'r')
  try {
    const st = await fh.stat()
    if (!st.isFile()) {
      throw new Error(t('chart.file_not_found', { path: filePath }))
    }
    if (st.size > CHART_JSON_MAX_BYTES) {
      throw new Error(t('chart.file_too_large', { path: filePath, max: String(CHART_JSON_MAX_BYTES) }))
    }

    const buf = Buffer.alloc(st.size)
    const { bytesRead } = await fh.read(buf, 0, st.size, 0)
    const bytes = buf.subarray(0, bytesRead)
    if (bytes.length > CHART_JSON_MAX_BYTES) {
      throw new Error(t('chart.file_too_large', { path: filePath, max: String(CHART_JSON_MAX_BYTES) }))
    }

    let value: unknown
    try {
      value = JSON.parse(bytes.toString('utf8'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(t('chart.file_not_json', { path: filePath, error: msg }))
    }

    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    return {
      path: filePath,
      value,
      summary: summarizeChartJson(filePath, bytes.length, sha256, value)
    }
  } finally {
    await fh.close()
  }
}
