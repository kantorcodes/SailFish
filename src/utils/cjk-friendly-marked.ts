import { marked } from 'marked'
import markedCjkFriendly from 'marked-cjk-friendly'

/**
 * 给 marked 挂上中日韩标点旁的加粗/斜体识别。
 * marked.use 会叠加，只挂一次。
 * 插件覆盖强调分隔符规则，升级 marked 后应回看这里是否还对得上。
 */
let applied = false

export function applyCjkFriendlyMarkdown(): void {
  if (applied) return
  marked.use(markedCjkFriendly())
  applied = true
}
