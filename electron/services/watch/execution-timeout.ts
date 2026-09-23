/** 未显式配置时的墙钟超时（秒） */
export const DEFAULT_WATCH_TIMEOUT_SECONDS = 900

/** 墙钟超时（毫秒） */
export function watchExecutionTimeoutMs(timeoutSec?: number): number {
  return (timeoutSec ?? DEFAULT_WATCH_TIMEOUT_SECONDS) * 1000
}

/** 整段执行的墙钟上限；超时后调用方须 abort 并释放锁 */
export async function raceWithTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
