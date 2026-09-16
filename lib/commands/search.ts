import {
  COMMAND_GROUP_LABELS,
  COMMAND_GROUP_ORDER,
  type CommandGroup,
  type FanwiseCommand,
} from "./types"

/**
 * What the palette shows for a query.
 *
 * Pure, so the ranking is a unit test rather than a screenshot. A query is
 * split into words and every word has to land somewhere — the label, a
 * keyword or the description — with the label counting for most. With no
 * query, the groups are listed in their fixed order and hidden commands stay
 * hidden; the catalog's products are searchable but not a wall of rows.
 */

export interface PaletteSection {
  group: CommandGroup
  label: string
  commands: FanwiseCommand[]
}

function normalise(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
}

function scoreWord(command: FanwiseCommand, word: string): number {
  const label = normalise(command.label)
  if (label === word) return 100
  if (label.startsWith(word)) return 80
  if (label.split(/\s+/).some((part) => part.startsWith(word))) return 60
  if (label.includes(word)) return 40
  for (const keyword of command.keywords ?? []) {
    const k = normalise(keyword)
    if (k === word || k.startsWith(word)) return 50
    if (k.includes(word)) return 30
  }
  if (command.description && normalise(command.description).includes(word)) return 10
  return 0
}

/** The score for a whole query, or 0 when any word finds nothing. */
export function scoreCommand(command: FanwiseCommand, query: string): number {
  const words = normalise(query).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  let total = 0
  for (const word of words) {
    const score = scoreWord(command, word)
    if (score === 0) return 0
    total += score
  }
  return total
}

export function searchCommands(
  commands: readonly FanwiseCommand[],
  query: string,
  { suggested = [] }: { suggested?: readonly string[] } = {},
): PaletteSection[] {
  const trimmed = query.trim()
  const byGroup = new Map<CommandGroup, Array<{ command: FanwiseCommand; score: number }>>()

  if (trimmed === "") {
    const suggestedRows: FanwiseCommand[] = []
    for (const id of suggested) {
      const command = commands.find((c) => c.id === id)
      if (command && !suggestedRows.includes(command)) suggestedRows.push(command)
    }
    if (suggestedRows.length > 0)
      byGroup.set(
        "suggested",
        suggestedRows.map((command) => ({ command, score: 0 })),
      )
    for (const command of commands) {
      if (command.hidden || suggestedRows.includes(command)) continue
      const rows = byGroup.get(command.group) ?? []
      rows.push({ command, score: 0 })
      byGroup.set(command.group, rows)
    }
  } else {
    for (const command of commands) {
      const score = scoreCommand(command, trimmed)
      if (score === 0) continue
      const rows = byGroup.get(command.group) ?? []
      rows.push({ command, score })
      byGroup.set(command.group, rows)
    }
    for (const rows of byGroup.values()) rows.sort((a, b) => b.score - a.score)
  }

  return COMMAND_GROUP_ORDER.flatMap((group) => {
    const rows = byGroup.get(group)
    if (!rows || rows.length === 0) return []
    return [{ group, label: COMMAND_GROUP_LABELS[group], commands: rows.map((row) => row.command) }]
  })
}

/** The rows in reading order, which is the order the arrow keys walk. */
export function flattenSections(sections: readonly PaletteSection[]): FanwiseCommand[] {
  return sections.flatMap((section) => section.commands)
}
