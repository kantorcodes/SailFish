import { describe, expect, it } from 'vitest'
import {
  clampUiZoomFactor,
  stepUiZoomFactor,
  UI_ZOOM_DEFAULT,
  uiZoomFactorToPercent,
  uiZoomPercentToFactor,
} from '@shared/types'

describe('ui zoom', () => {
  it('falls back to 100% for garbage values', () => {
    expect(clampUiZoomFactor(undefined)).toBe(UI_ZOOM_DEFAULT)
    expect(clampUiZoomFactor('nope')).toBe(UI_ZOOM_DEFAULT)
    expect(clampUiZoomFactor(Number.NaN)).toBe(UI_ZOOM_DEFAULT)
  })

  it('clamps to 50%–200%', () => {
    expect(clampUiZoomFactor(0.2)).toBe(0.5)
    expect(clampUiZoomFactor(3)).toBe(2)
    expect(uiZoomFactorToPercent(1.1)).toBe(110)
    expect(uiZoomPercentToFactor(80)).toBe(0.8)
  })

  it('steps through Chromium-style presets', () => {
    expect(stepUiZoomFactor(1, 1)).toBe(1.1)
    expect(stepUiZoomFactor(1.1, 1)).toBe(1.25)
    expect(stepUiZoomFactor(1, -1)).toBe(0.9)
    expect(stepUiZoomFactor(0.5, -1)).toBe(0.5)
    expect(stepUiZoomFactor(2, 1)).toBe(2)
  })
})
