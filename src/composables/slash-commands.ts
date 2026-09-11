export interface SlashCommandDef {
  id: 'compact'
  names: string[]
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { id: 'compact', names: ['compact', '压缩'] }
]

export interface ParsedSlash {
  raw: string
  name: string
  rest: string
}

/** 只认输入开头的 `/命令`，后面的字当作补充。 */
export function parseLeadingSlash(text: string): ParsedSlash | null {
  if (!text.startsWith('/')) return null
  const match = text.match(/^\/([^\s]*)(\s[\s\S]*)?$/)
  if (!match) return null
  return {
    raw: `/${match[1]}`,
    name: match[1],
    rest: (match[2] ?? '').replace(/^\s+/, '')
  }
}

export function matchSlashCommands(name: string, defs: SlashCommandDef[] = SLASH_COMMANDS): SlashCommandDef[] {
  const query = name.toLowerCase()
  if (!query) return [...defs]
  return defs.filter(def => def.names.some(n => n.toLowerCase().startsWith(query)))
}

export function exactSlashCommand(name: string, defs: SlashCommandDef[] = SLASH_COMMANDS): SlashCommandDef | null {
  const query = name.toLowerCase()
  return defs.find(def => def.names.some(n => n.toLowerCase() === query)) ?? null
}

export function primarySlashName(def: SlashCommandDef): string {
  return def.names[0]
}
