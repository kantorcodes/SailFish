/**
 * 整窗界面缩放。和菜单「放大 / 缩小 / 实际大小」同一套比例。
 * 档位对齐 Chromium 页面缩放（快捷键每按一次跳一档）。
 */

export const UI_ZOOM_PRESETS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

export const UI_ZOOM_DEFAULT = 1
export const UI_ZOOM_MIN = UI_ZOOM_PRESETS[0]
export const UI_ZOOM_MAX = UI_ZOOM_PRESETS[UI_ZOOM_PRESETS.length - 1]

export function clampUiZoomFactor(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return UI_ZOOM_DEFAULT
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(n * 100) / 100))
}

export function stepUiZoomFactor(current: number, direction: 1 | -1): number {
  const factor = clampUiZoomFactor(current)
  if (direction > 0) {
    const next = UI_ZOOM_PRESETS.find((p) => p > factor + 1e-6)
    return next ?? UI_ZOOM_MAX
  }
  const prev = [...UI_ZOOM_PRESETS].reverse().find((p) => p < factor - 1e-6)
  return prev ?? UI_ZOOM_MIN
}

export function uiZoomFactorToPercent(factor: number): number {
  return Math.round(clampUiZoomFactor(factor) * 100)
}

export function uiZoomPercentToFactor(percent: number): number {
  return clampUiZoomFactor(percent / 100)
}
