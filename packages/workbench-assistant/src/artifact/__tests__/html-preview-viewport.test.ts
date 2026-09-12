// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  elementClipsOverflow,
  htmlPreviewViewportGuestScript,
  installHtmlPreviewViewportGuest,
  isCaretTextHit,
  isDocumentScrollport,
  isHtmlPreviewViewportEnabled,
  isInteractivePanTarget,
  isTextSelectionTarget,
  shouldBeginPan,
  shouldUnfixOversizedStage,
  HTML_PREVIEW_VIEWPORT_STYLE_ID
} from '../domain/html-preview-viewport'

describe('html-preview-viewport', () => {
  it('PPT 预览不接管滚动和拖拽', () => {
    expect(isHtmlPreviewViewportEnabled({ isPptPreview: true })).toBe(false)
    expect(isHtmlPreviewViewportEnabled({ isPptPreview: false })).toBe(true)
  })

  it('只在真正裁掉溢出时才解锁', () => {
    expect(elementClipsOverflow({
      scrollWidth: 2400,
      scrollHeight: 800,
      clientWidth: 800,
      clientHeight: 800,
      overflowX: 'hidden',
      overflowY: 'hidden'
    })).toBe(true)
    expect(elementClipsOverflow({
      scrollWidth: 800,
      scrollHeight: 800,
      clientWidth: 800,
      clientHeight: 800,
      overflowX: 'hidden',
      overflowY: 'hidden'
    })).toBe(false)
    expect(elementClipsOverflow({
      scrollWidth: 2400,
      scrollHeight: 800,
      clientWidth: 800,
      clientHeight: 800,
      overflowX: 'visible',
      overflowY: 'visible'
    })).toBe(false)
  })

  it('钉在视口上却比窗口大的画布才改成可滚动', () => {
    expect(shouldUnfixOversizedStage({
      position: 'fixed',
      width: 2400,
      height: 1600,
      viewportWidth: 900,
      viewportHeight: 700
    })).toBe(true)
    expect(shouldUnfixOversizedStage({
      position: 'absolute',
      width: 2400,
      height: 1600,
      viewportWidth: 900,
      viewportHeight: 700
    })).toBe(false)
    expect(shouldUnfixOversizedStage({
      position: 'fixed',
      width: 280,
      height: 700,
      viewportWidth: 900,
      viewportHeight: 700
    })).toBe(false)
  })

  it('按点命中文字节点才算选字', () => {
    expect(isCaretTextHit(3, '西山龙门')).toBe(true)
    expect(isCaretTextHit(1, '西山龙门')).toBe(false)
    expect(isCaretTextHit(3, '   ')).toBe(false)
    expect(isTextSelectionTarget({ nodeType: 3, text: '西山龙门', childElementCount: 0 })).toBe(true)
    expect(isTextSelectionTarget({ nodeType: 1, text: '西山龙门', childElementCount: 0 })).toBe(true)
    expect(isTextSelectionTarget({ nodeType: 1, text: '', childElementCount: 0 })).toBe(false)
  })

  it('文档根不算嵌套滚动体，避免拖一次滚两倍', () => {
    expect(isDocumentScrollport('HTML')).toBe(true)
    expect(isDocumentScrollport('body')).toBe(true)
    expect(isDocumentScrollport('div')).toBe(false)
  })

  it('画布、控件、可拖元素不抢走页面自己的拖拽', () => {
    expect(isInteractivePanTarget({
      tagName: 'DIV', closestFormControl: false, draggable: false, role: null
    })).toBe(false)
    expect(isInteractivePanTarget({
      tagName: 'CANVAS', closestFormControl: false, draggable: false, role: null
    })).toBe(true)
    expect(isInteractivePanTarget({
      tagName: 'DIV', closestFormControl: true, draggable: false, role: null
    })).toBe(true)
    expect(isInteractivePanTarget({
      tagName: 'DIV', closestFormControl: false, draggable: true, role: null
    })).toBe(true)
    expect(isInteractivePanTarget({
      tagName: 'DIV', closestFormControl: false, draggable: false, role: 'slider'
    })).toBe(true)
  })

  it('空白处拖过阈值才开始挪画面，划字或点控件不挪', () => {
    expect(shouldBeginPan({
      button: 0,
      pannable: true,
      interactive: false,
      textual: false,
      selectionCollapsed: true,
      moved: 8
    })).toBe(true)
    expect(shouldBeginPan({
      button: 0,
      pannable: false,
      interactive: false,
      textual: false,
      selectionCollapsed: true,
      moved: 20
    })).toBe(false)
    expect(shouldBeginPan({
      button: 0,
      pannable: true,
      interactive: false,
      textual: false,
      selectionCollapsed: true,
      moved: 2
    })).toBe(false)
    expect(shouldBeginPan({
      button: 0,
      pannable: true,
      interactive: true,
      textual: false,
      selectionCollapsed: true,
      moved: 20
    })).toBe(false)
    expect(shouldBeginPan({
      button: 0,
      pannable: true,
      interactive: false,
      textual: true,
      selectionCollapsed: true,
      moved: 20
    })).toBe(false)
    expect(shouldBeginPan({
      button: 0,
      pannable: true,
      interactive: false,
      textual: false,
      selectionCollapsed: false,
      moved: 20
    })).toBe(false)
    expect(shouldBeginPan({
      button: 2,
      pannable: true,
      interactive: false,
      textual: false,
      selectionCollapsed: true,
      moved: 20
    })).toBe(false)
  })

  it('注入脚本是自包含 IIFE', () => {
    const src = htmlPreviewViewportGuestScript()
    expect(src.startsWith('(')).toBe(true)
    expect(src).toContain('__sfArtifactViewport')
    expect(src).not.toContain('import ')
  })

  it('客页只挂一次，并写入视口样式', () => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
    delete (window as Window & { __sfArtifactViewport?: boolean }).__sfArtifactViewport
    installHtmlPreviewViewportGuest()
    installHtmlPreviewViewportGuest()
    expect(document.getElementById(HTML_PREVIEW_VIEWPORT_STYLE_ID)).toBeTruthy()
    expect(document.querySelectorAll(`#${HTML_PREVIEW_VIEWPORT_STYLE_ID}`).length).toBe(1)
    document.body.innerHTML = ''
    document.documentElement.className = ''
    delete (window as Window & { __sfArtifactViewport?: boolean }).__sfArtifactViewport
  })

  it('内容比窗口大时可以拖着挪', () => {
    document.documentElement.className = ''
    document.body.innerHTML = '<div id="stage"></div>'
    delete (window as Window & { __sfArtifactViewport?: boolean }).__sfArtifactViewport
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 2400 })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1600 })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 600 })
    const scrolled: Array<[number, number]> = []
    window.scrollBy = ((x?: number, y?: number) => {
      scrolled.push([Number(x) || 0, Number(y) || 0])
    }) as typeof window.scrollBy

    installHtmlPreviewViewportGuest()
    expect(document.documentElement.classList.contains('sf-html-pannable')).toBe(true)

    const stage = document.getElementById('stage')
    stage?.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, clientX: 120, clientY: 80, pointerId: 1, bubbles: true
    }))
    document.dispatchEvent(new PointerEvent('pointermove', {
      button: 0, buttons: 1, clientX: 90, clientY: 40, pointerId: 1, bubbles: true
    }))
    expect(scrolled.length).toBeGreaterThan(0)
    expect(scrolled[0]).toEqual([30, 40])

    document.body.innerHTML = ''
    document.documentElement.className = ''
    delete (window as Window & { __sfArtifactViewport?: boolean }).__sfArtifactViewport
  })
})
