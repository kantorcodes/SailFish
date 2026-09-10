/**
 * 输出 token 速度：吐字中看出速，停住后看刚结束那一段的均速。
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
      return applyRate('live', lastTokens - burstStartTokens, now - burstStartAt)
    },

    settle(): OutputRateState {
      if (!outputting) return state
      outputting = false
      return applyRate('avg', lastTokens - burstStartTokens, lastIncreaseAt - burstStartAt)
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
  const IDLE_MS = 1200

  function sync() {
    snapshot.value = { ...tracker.getState() }
  }

  function clearIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = 0
    }
  }

  function settleIdle() {
    idleTimer = 0
    tracker.settle()
    sync()
  }

  watch(sessionKey, () => {
    clearIdle()
    tracker.reset(toValue(completionTokens))
    sync()
  }, { immediate: true })

  watch(() => toValue(completionTokens), (tokens) => {
    tracker.ingest(tokens, performance.now())
    sync()
    if (snapshot.value.kind === 'live') {
      clearIdle()
      idleTimer = window.setTimeout(settleIdle, IDLE_MS)
    } else {
      clearIdle()
    }
  })

  watch(() => toValue(isRunning), (running) => {
    if (running) return
    clearIdle()
    tracker.settle()
    sync()
  })

  onBeforeUnmount(clearIdle)

  return {
    rateKind: computed(() => snapshot.value.kind),
    rateText: computed(() => {
      const rate = snapshot.value.rate
      return rate == null ? '' : formatTokenRate(rate)
    }),
  }
}
