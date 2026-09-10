/**
 * 输出 token 速度：吐字中跟这一段走，停住后留下刚结束那一段的平均。
 */
import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

export type OutputRateKind = 'live' | 'avg'

export interface OutputRateState {
  kind: OutputRateKind | null
  rate: number | null
}

/** 开口后至少过这么久才报速度，避免首包把数字打飞 */
export const OUTPUT_RATE_MIN_ELAPSED_MS = 200

export function formatTokenRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return ''
  if (rate < 10) return rate.toFixed(1)
  return String(Math.round(rate))
}

export function computeTokenRate(tokens: number, elapsedMs: number): number | null {
  if (tokens <= 0 || elapsedMs < OUTPUT_RATE_MIN_ELAPSED_MS) return null
  return tokens / (elapsedMs / 1000)
}

export function createOutputRateTracker() {
  let lastTokens = 0
  let burstStartTokens = 0
  let burstStartAt = 0
  let lastIncreaseAt = 0
  let outputting = false
  let state: OutputRateState = { kind: null, rate: null }

  function applyRate(kind: OutputRateKind, tokens: number, elapsedMs: number): OutputRateState {
    const next = computeTokenRate(tokens, elapsedMs)
    if (next != null) state = { kind, rate: next }
    return state
  }

  function burstTokens(): number {
    return lastTokens - burstStartTokens
  }

  function reset(tokens = 0): OutputRateState {
    lastTokens = Math.max(0, tokens)
    burstStartTokens = lastTokens
    burstStartAt = 0
    lastIncreaseAt = 0
    outputting = false
    state = { kind: null, rate: null }
    return state
  }

  return {
    getState(): OutputRateState {
      return state
    },

    isOutputting(): boolean {
      return outputting
    },

    reset,

    ingest(tokens: number, now: number): OutputRateState {
      const next = Math.max(0, tokens)
      if (next < lastTokens) return reset(next)
      if (next === lastTokens) return state

      if (!outputting) {
        outputting = true
        burstStartTokens = lastTokens
        burstStartAt = now
      }
      lastTokens = next
      lastIncreaseAt = now
      return applyRate('live', burstTokens(), now - burstStartAt)
    },

    /** 吐字中按墙上时钟刷新，首包之后不用等下一跳也能出价 */
    tick(now: number): OutputRateState {
      if (!outputting) return state
      return applyRate('live', burstTokens(), now - burstStartAt)
    },

    /**
     * 只跳过一次数字时，起止时刻相同，必须用停住的时刻当终点，否则平均永远算不出来。
     */
    settle(now?: number): OutputRateState {
      if (!outputting) return state
      outputting = false
      const endAt = lastIncreaseAt > burstStartAt
        ? lastIncreaseAt
        : (now ?? lastIncreaseAt)
      return applyRate('avg', burstTokens(), endAt - burstStartAt)
    },
  }
}

export function useOutputTokenRate(
  completionTokens: MaybeRefOrGetter<number>,
  isRunning: MaybeRefOrGetter<boolean>,
  sessionKey: MaybeRefOrGetter<string>,
): {
  rateKind: Ref<OutputRateKind | null>
  rateText: Ref<string>
} {
  const tracker = createOutputRateTracker()
  const snapshot = ref<OutputRateState>(tracker.getState())
  let idleTimer = 0
  let tickTimer = 0
  const IDLE_MS = 1200
  const TICK_MS = 200

  function sync() {
    snapshot.value = { ...tracker.getState() }
  }

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = 0
    }
  }

  function stopTicking() {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = 0
    }
  }

  function startTicking() {
    if (tickTimer) return
    tickTimer = window.setInterval(() => {
      tracker.tick(performance.now())
      sync()
    }, TICK_MS)
  }

  function settleNow() {
    clearIdle()
    stopTicking()
    tracker.settle(performance.now())
    sync()
  }

  watch(sessionKey, () => {
    clearIdle()
    stopTicking()
    tracker.reset(toValue(completionTokens))
    sync()
  }, { immediate: true })

  watch(() => toValue(completionTokens), (tokens) => {
    tracker.ingest(tokens, performance.now())
    sync()
    if (tracker.isOutputting()) {
      startTicking()
      clearIdle()
      idleTimer = window.setTimeout(settleNow, IDLE_MS)
    } else {
      clearIdle()
      stopTicking()
    }
  })

  watch(() => toValue(isRunning), (running) => {
    if (running) return
    settleNow()
  })

  onBeforeUnmount(() => {
    clearIdle()
    stopTicking()
  })

  return {
    rateKind: computed(() => snapshot.value.kind),
    rateText: computed(() => {
      const rate = snapshot.value.rate
      return rate == null ? '' : formatTokenRate(rate)
    }),
  }
}
