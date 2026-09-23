import { describe, it, expect } from 'vitest'
import { raceWithTimeout, watchExecutionTimeoutMs } from '../execution-timeout'

describe('watchExecutionTimeoutMs', () => {
  it('defaults to 900s', () => {
    expect(watchExecutionTimeoutMs()).toBe(900_000)
  })

  it('uses explicit seconds', () => {
    expect(watchExecutionTimeoutMs(30)).toBe(30_000)
  })
})

describe('raceWithTimeout', () => {
  it('resolves when work finishes first', async () => {
    const value = await raceWithTimeout(Promise.resolve('ok'), 200, 'timeout')
    expect(value).toBe('ok')
  })

  it('rejects when work hangs past the wall clock', async () => {
    const hang = new Promise<string>(() => { /* never settles */ })
    await expect(raceWithTimeout(hang, 30, 'Watch timeout (0s)')).rejects.toThrow('Watch timeout (0s)')
  })
})
