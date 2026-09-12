/**
 * Joining names into a sentence, in one place.
 *
 * Three surfaces needed the same list — the readiness summary, the checklist
 * and the suggestion acknowledgment — and three hand-rolled versions is three
 * chances to write "a, b" where the others write "a and b". It also removes the
 * `array[length - 1]` that TypeScript is right to call possibly-undefined.
 */
export function joinWords(words: readonly string[]): string {
  if (words.length === 0) return ""
  if (words.length === 1) return words[0]!
  const last = words[words.length - 1]!
  return `${words.slice(0, -1).join(", ")} and ${last}`
}

/** "1 item" / "3 items". The count and its noun never disagree. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
