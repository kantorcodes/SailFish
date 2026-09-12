/**
 * HTML 文件预览视口：内容比窗口大时解锁滚动，并允许拖着挪。
 * 客页逻辑必须自包含（toString 注入 webview），不能闭包外部 import。
 */

export const HTML_PREVIEW_VIEWPORT_STYLE_ID = 'sf-html-viewport-style'
export const HTML_PREVIEW_VIEWPORT_SPACER_ID = 'sf-html-viewport-spacer'
export const HTML_PREVIEW_PAN_THRESHOLD_PX = 6

export function isHtmlPreviewViewportEnabled(opts: { isPptPreview: boolean }): boolean {
  return !opts.isPptPreview
}

/** 元素裁掉了比自己更大的内容时，才需要放开滚动 */
export function elementClipsOverflow(metrics: {
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
  overflowX: string
  overflowY: string
}): boolean {
  const clipsX = metrics.overflowX === 'hidden' || metrics.overflowX === 'clip'
  const clipsY = metrics.overflowY === 'hidden' || metrics.overflowY === 'clip'
  const extra = 2
  return (
    (clipsX && metrics.scrollWidth > metrics.clientWidth + extra) ||
    (clipsY && metrics.scrollHeight > metrics.clientHeight + extra)
  )
}

/** 钉在视口上、却比窗口大的画布，按普通文档流处理，否则滚不到 */
export function shouldUnfixOversizedStage(opts: {
  position: string
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}): boolean {
  if (opts.position !== 'fixed') return false
  return opts.width > opts.viewportWidth + 8 || opts.height > opts.viewportHeight + 8
}

/** 按点命中文字节点才算选字；叶子文字是没有 caret API 时的退路 */
export function isCaretTextHit(caretNodeType: number | null, caretText: string): boolean {
  return caretNodeType === 3 && caretText.trim().length > 0
}

export function isTextSelectionTarget(opts: {
  nodeType: number
  text: string
  childElementCount: number
}): boolean {
  if (isCaretTextHit(opts.nodeType, opts.text)) return true
  return opts.childElementCount === 0 && opts.text.trim().length > 0
}

export function isDocumentScrollport(nodeName: string): boolean {
  const name = nodeName.toLowerCase()
  return name === 'html' || name === 'body'
}

export function isInteractivePanTarget(opts: {
  tagName: string
  closestFormControl: boolean
  draggable: boolean
  role: string | null
}): boolean {
  if (opts.closestFormControl || opts.draggable) return true
  const tag = opts.tagName.toLowerCase()
  if (tag === 'canvas' || tag === 'video' || tag === 'audio' || tag === 'iframe') return true
  const role = (opts.role || '').toLowerCase()
  return role === 'button' || role === 'slider' || role === 'scrollbar'
}

export function shouldBeginPan(opts: {
  button: number
  pannable: boolean
  interactive: boolean
  textual: boolean
  selectionCollapsed: boolean
  moved: number
  threshold?: number
}): boolean {
  if (!opts.pannable) return false
  if (opts.button !== 0) return false
  if (opts.interactive || opts.textual) return false
  if (!opts.selectionCollapsed) return false
  return opts.moved >= (opts.threshold ?? HTML_PREVIEW_PAN_THRESHOLD_PX)
}

export function htmlPreviewViewportGuestScript(): string {
  return `(${installHtmlPreviewViewportGuest.toString()})()`
}

/**
 * 跑在预览页主世界。toString 后注入，禁止引用外部绑定。
 */
export function installHtmlPreviewViewportGuest(): void {
  const w = window as Window & { __sfArtifactViewport?: boolean }
  if (w.__sfArtifactViewport) return
  w.__sfArtifactViewport = true

  const STYLE_ID = 'sf-html-viewport-style'
  const SPACER_ID = 'sf-html-viewport-spacer'
  const THRESHOLD = 6
  let lastExtentW = 0
  let lastExtentH = 0
  let applying = false
  let applyTick = 0

  function clips(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false
    const style = getComputedStyle(el)
    const ox = style.overflowX
    const oy = style.overflowY
    const extra = 2
    return (
      ((ox === 'hidden' || ox === 'clip') && el.scrollWidth > el.clientWidth + extra) ||
      ((oy === 'hidden' || oy === 'clip') && el.scrollHeight > el.clientHeight + extra)
    )
  }

  function unlock(el: HTMLElement): void {
    el.style.setProperty('overflow', 'auto', 'important')
  }

  function unlockTree(): void {
    unlock(document.documentElement)
    if (document.body) unlock(document.body)
    if (!document.body) return
    for (const node of document.body.querySelectorAll('*')) {
      if (node instanceof HTMLElement && clips(node)) unlock(node)
    }
  }

  function unfixOversizedStages(): void {
    if (!document.body) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    for (const node of document.body.querySelectorAll('*')) {
      if (!(node instanceof HTMLElement) || node.id === SPACER_ID) continue
      const style = getComputedStyle(node)
      if (style.position !== 'fixed') continue
      const r = node.getBoundingClientRect()
      if (r.width > vw + 8 || r.height > vh + 8) {
        node.style.setProperty('position', 'absolute', 'important')
      }
    }
  }

  function contentExtent(): { width: number; height: number } {
    const spacer = document.getElementById(SPACER_ID) as HTMLElement | null
    const prevDisplay = spacer?.style.display
    if (spacer) spacer.style.display = 'none'
    let width = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0)
    let height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)
    if (document.body) {
      for (const node of document.body.querySelectorAll('*')) {
        if (!(node instanceof HTMLElement) || node.id === SPACER_ID) continue
        if (getComputedStyle(node).position === 'fixed') continue
        const r = node.getBoundingClientRect()
        width = Math.max(width, r.right + window.scrollX)
        height = Math.max(height, r.bottom + window.scrollY)
      }
    }
    if (spacer) spacer.style.display = prevDisplay ?? ''
    return { width, height }
  }

  function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = [
      'html.sf-html-pannable,html.sf-html-pannable body{overflow:auto!important;height:auto!important;min-height:100%!important;max-height:none!important}',
      'html.sf-html-pannable{cursor:grab}',
      'html.sf-html-pannable.sf-html-panning,html.sf-html-pannable.sf-html-panning *{cursor:grabbing!important;user-select:none!important}',
      'html.sf-html-pannable::-webkit-scrollbar{width:11px;height:11px}',
      'html.sf-html-pannable::-webkit-scrollbar-thumb{background:rgba(127,127,127,0.45);border-radius:6px}'
    ].join('')
    document.documentElement.appendChild(style)
  }

  function ensureSpacer(width: number, height: number): void {
    if (!document.body) return
    const w = Math.ceil(width)
    const h = Math.ceil(height)
    if (Math.abs(w - lastExtentW) < 2 && Math.abs(h - lastExtentH) < 2) return
    lastExtentW = w
    lastExtentH = h
    let spacer = document.getElementById(SPACER_ID)
    if (!spacer) {
      spacer = document.createElement('div')
      spacer.id = SPACER_ID
      spacer.setAttribute('aria-hidden', 'true')
      spacer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;visibility:hidden;z-index:-1'
      document.body.appendChild(spacer)
    }
    spacer.style.width = `${w}px`
    spacer.style.height = `${h}px`
  }

  function clearSpacer(): void {
    document.getElementById(SPACER_ID)?.remove()
    lastExtentW = 0
    lastExtentH = 0
  }

  function apply(): void {
    if (applying) return
    applying = true
    try {
      ensureStyle()
      unfixOversizedStages()
      unlockTree()
      const extent = contentExtent()
      if (extent.width > window.innerWidth + 2 || extent.height > window.innerHeight + 2) {
        document.documentElement.classList.add('sf-html-pannable')
        ensureSpacer(extent.width, extent.height)
        unlockTree()
      } else {
        document.documentElement.classList.remove('sf-html-pannable')
        clearSpacer()
      }
    } finally {
      applying = false
    }
  }

  function scheduleApply(): void {
    if (applying || applyTick) return
    applyTick = window.requestAnimationFrame(() => {
      applyTick = 0
      apply()
    })
  }

  function asElement(target: EventTarget | null): Element | null {
    const node = target instanceof Node ? target : null
    if (!node) return null
    return node instanceof Element ? node : node.parentElement
  }

  function isInteractive(target: EventTarget | null): boolean {
    const el = asElement(target)
    if (!el) return false
    if (el.closest('a,button,input,textarea,select,option,label,summary,canvas,video,audio,iframe,[contenteditable="true"],[contenteditable=""],[draggable="true"]')) {
      return true
    }
    const role = (el.closest('[role]')?.getAttribute('role') || '').toLowerCase()
    return role === 'button' || role === 'slider' || role === 'scrollbar'
  }

  function isTextual(target: EventTarget | null, x: number, y: number): boolean {
    const doc = document as Document & { caretRangeFromPoint?: (cx: number, cy: number) => Range | null }
    if (typeof doc.caretRangeFromPoint === 'function') {
      try {
        const range = doc.caretRangeFromPoint(x, y)
        const node = range?.startContainer
        if (node && node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true
      } catch {
        /* 有的节点算不出 caret */
      }
    }
    const node = target instanceof Node ? target : null
    if (!node) return false
    if (node.nodeType === 3) return (node.textContent ?? '').trim().length > 0
    if (!(node instanceof Element)) return false
    return node.childElementCount === 0 && (node.textContent ?? '').trim().length > 0
  }

  function isPannable(): boolean {
    return document.documentElement.classList.contains('sf-html-pannable')
  }

  function selectionCollapsed(): boolean {
    const sel = window.getSelection()
    return !sel || sel.rangeCount === 0 || sel.isCollapsed
  }

  function scrollablesFrom(target: EventTarget | null): HTMLElement[] {
    const out: HTMLElement[] = []
    const skip = new Set<Element | null>([
      document.documentElement,
      document.body,
      document.scrollingElement
    ])
    let el: Element | null = asElement(target)
    while (el) {
      if (el instanceof HTMLElement && el.id !== SPACER_ID && !skip.has(el)) {
        const style = getComputedStyle(el)
        const extra = 2
        const canX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + extra
        const canY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + extra
        if (canX || canY) out.push(el)
      }
      el = el.parentElement
    }
    return out
  }

  let armed = false
  let panning = false
  let pointerId = 0
  let button = 0
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let startedInteractive = false
  let pans: HTMLElement[] = []

  function endPan(): void {
    if (panning) document.documentElement.classList.remove('sf-html-panning')
    armed = false
    panning = false
    pans = []
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !isPannable()) return
    armed = true
    panning = false
    pointerId = e.pointerId
    button = e.button
    startX = e.clientX
    startY = e.clientY
    lastX = e.clientX
    lastY = e.clientY
    startedInteractive = isInteractive(e.target) || isTextual(e.target, e.clientX, e.clientY)
    pans = scrollablesFrom(e.target)
  }

  function onPointerMove(e: PointerEvent): void {
    if (!armed || e.pointerId !== pointerId) return
    if ((e.buttons & 1) === 0) {
      endPan()
      return
    }
    const moved = Math.hypot(e.clientX - startX, e.clientY - startY)
    if (!panning) {
      if (startedInteractive) return
      if (!selectionCollapsed()) {
        armed = false
        return
      }
      if (moved < THRESHOLD) return
      if (button !== 0 || !isPannable()) return
      panning = true
      document.documentElement.classList.add('sf-html-panning')
      window.getSelection()?.removeAllRanges()
      try {
        document.documentElement.setPointerCapture(e.pointerId)
      } catch {
        /* 有的环境不支持 capture */
      }
    }
    if (!panning) return
    e.preventDefault()
    const dx = lastX - e.clientX
    const dy = lastY - e.clientY
    lastX = e.clientX
    lastY = e.clientY
    window.scrollBy(dx, dy)
    for (const el of pans) {
      el.scrollLeft += dx
      el.scrollTop += dy
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return
    endPan()
  }

  function onSelectStart(e: Event): void {
    if (panning) e.preventDefault()
  }

  function onDragStart(e: Event): void {
    if (panning || armed) e.preventDefault()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false })
  document.addEventListener('pointerup', onPointerUp, true)
  document.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('selectstart', onSelectStart, true)
  document.addEventListener('dragstart', onDragStart, true)
  window.addEventListener('blur', endPan)
  window.addEventListener('resize', scheduleApply)
  window.visualViewport?.addEventListener('resize', scheduleApply)
  window.addEventListener('load', scheduleApply)
  document.addEventListener('load', scheduleApply, true)
  if (document.body) {
    new MutationObserver(() => scheduleApply()).observe(document.body, { childList: true, subtree: true })
  }
  apply()
  scheduleApply()
  window.setTimeout(scheduleApply, 200)
  window.setTimeout(scheduleApply, 800)
}
