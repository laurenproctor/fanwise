/**
 * What a set of code points means to a person choosing a font.
 *
 * A cmap says "these 624 characters". A buyer wants "Latin, Cyrillic and
 * Kana", and a marketplace asks "which languages". Both answers are derived
 * here from the same ranges, deterministically, with thresholds written down,
 * so the summary a creator sees and the one a channel receives cannot disagree.
 *
 * The thresholds are deliberately high. A Latin font that happens to include
 * "Ω" for a maths symbol does not support Greek, and saying it does would be a
 * factual claim the file does not back.
 */

/** Sorted, non-overlapping, inclusive code point ranges. */
export type CodepointRanges = ReadonlyArray<readonly [number, number]>

export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges
    .filter(([start, end]) => end >= start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

export function countInRange(ranges: CodepointRanges, from: number, to: number): number {
  let count = 0
  for (const [start, end] of ranges) {
    if (end < from) continue
    if (start > to) break
    count += Math.min(end, to) - Math.max(start, from) + 1
  }
  return count
}

export function totalCodepoints(ranges: CodepointRanges): number {
  return ranges.reduce((sum, [start, end]) => sum + (end - start + 1), 0)
}

export function covers(ranges: CodepointRanges, codepoint: number): boolean {
  // Binary search: a CJK font can carry thousands of ranges.
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const [start, end] = ranges[mid]!
    if (codepoint < start) high = mid - 1
    else if (codepoint > end) low = mid + 1
    else return true
  }
  return false
}

function coversAll(ranges: CodepointRanges, text: string): boolean {
  for (const char of text) {
    if (!covers(ranges, char.codePointAt(0)!)) return false
  }
  return true
}

/* ------------------------------------------------------------------ scripts */

interface ScriptRule {
  name: string
  from: number
  to: number
  /** How many of the range must be present before the script is claimed. */
  minimum: number
}

/**
 * The scripts Fanwise will name, in the order it names them.
 *
 * Each rule is a core letter range and a count, not a Unicode block: a block
 * includes rarely-used letters, and requiring every one would say a perfectly
 * good Cyrillic font does not support Cyrillic.
 */
const SCRIPT_RULES: readonly ScriptRule[] = [
  { name: "Latin", from: 0x41, to: 0x7a, minimum: 52 },
  { name: "Greek", from: 0x391, to: 0x3c9, minimum: 48 },
  { name: "Cyrillic", from: 0x410, to: 0x44f, minimum: 60 },
  { name: "Armenian", from: 0x531, to: 0x586, minimum: 70 },
  { name: "Hebrew", from: 0x5d0, to: 0x5ea, minimum: 22 },
  { name: "Arabic", from: 0x621, to: 0x64a, minimum: 28 },
  { name: "Devanagari", from: 0x905, to: 0x939, minimum: 40 },
  { name: "Thai", from: 0xe01, to: 0xe3a, minimum: 40 },
  { name: "Georgian", from: 0x10d0, to: 0x10fa, minimum: 33 },
  { name: "Hangul", from: 0xac00, to: 0xd7a3, minimum: 2000 },
  { name: "Han", from: 0x4e00, to: 0x9fff, minimum: 1000 },
]

/** Latin needs both cases of the alphabet, which the rule range alone cannot say. */
const LATIN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

export function detectScripts(ranges: CodepointRanges): string[] {
  const found: string[] = []
  for (const rule of SCRIPT_RULES) {
    if (rule.name === "Latin") {
      if (coversAll(ranges, LATIN_ALPHABET)) found.push("Latin")
      continue
    }
    if (countInRange(ranges, rule.from, rule.to) >= rule.minimum) found.push(rule.name)
    // Kana is named after Greek-through-Georgian and before the large scripts,
    // so the order reads the way the design brief writes it.
    if (rule.name === "Georgian") {
      const hiragana = countInRange(ranges, 0x3041, 0x3096)
      const katakana = countInRange(ranges, 0x30a1, 0x30fa)
      if (hiragana >= 80 || katakana >= 80) found.push("Kana")
    }
  }
  return found
}

/** Every script name `detectScripts` can produce, for pickers and validation. */
export const KNOWN_SCRIPTS: readonly string[] = [
  "Latin",
  "Greek",
  "Cyrillic",
  "Armenian",
  "Hebrew",
  "Arabic",
  "Devanagari",
  "Thai",
  "Georgian",
  "Kana",
  "Hangul",
  "Han",
]

/* ---------------------------------------------------------------- languages */

interface LanguageRule {
  name: string
  /** Letters beyond the base alphabet. Both cases are required where a case exists. */
  letters: string
  base: "latin" | "cyrillic" | "greek" | "kana"
}

/**
 * Languages judged by the letters they cannot do without.
 *
 * Deliberately a short list of widely-sold languages rather than a CLDR
 * exemplar table: a creator can add any language by hand, and a short list
 * that is right is worth more than a long one that guesses.
 */
const LANGUAGE_RULES: readonly LanguageRule[] = [
  { name: "English", letters: "", base: "latin" },
  { name: "French", letters: "àâæçéèêëîïôœùûüÿ", base: "latin" },
  { name: "German", letters: "äöüß", base: "latin" },
  { name: "Spanish", letters: "áéíñóúü¿¡", base: "latin" },
  { name: "Portuguese", letters: "áâãàçéêíóôõú", base: "latin" },
  { name: "Italian", letters: "àèéìíîòóùú", base: "latin" },
  { name: "Dutch", letters: "éëï", base: "latin" },
  { name: "Swedish", letters: "åäö", base: "latin" },
  { name: "Danish", letters: "æøå", base: "latin" },
  { name: "Norwegian", letters: "æøåéèêóòôâ", base: "latin" },
  { name: "Polish", letters: "ąćęłńóśźż", base: "latin" },
  { name: "Czech", letters: "áčďéěíňóřšťúůýž", base: "latin" },
  { name: "Turkish", letters: "çğıöşüİ", base: "latin" },
  { name: "Vietnamese", letters: "ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ", base: "latin" },
  { name: "Russian", letters: "ё", base: "cyrillic" },
  { name: "Ukrainian", letters: "єіїґ", base: "cyrillic" },
  { name: "Greek", letters: "άέήίόύώ", base: "greek" },
  { name: "Japanese (kana)", letters: "", base: "kana" },
] // prettier-ignore

const BASES: Record<LanguageRule["base"], string> = {
  latin: LATIN_ALPHABET,
  cyrillic: "абвгдежзийклмнопрстуфхцчшщъыьэюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
  greek: "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ",
  kana: "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
}

function withUppercase(letters: string): string {
  let out = ""
  for (const char of letters) {
    out += char
    const upper = char.toUpperCase()
    // ß uppercases to "SS" and ı to "I": neither is a letter the language lacks.
    if (upper !== char && [...upper].length === 1) out += upper
  }
  return out
}

export function detectLanguages(ranges: CodepointRanges): string[] {
  return LANGUAGE_RULES.filter(
    (rule) => coversAll(ranges, BASES[rule.base]) && coversAll(ranges, withUppercase(rule.letters)),
  ).map((rule) => rule.name)
}

/* ------------------------------------------------------------------- blocks */

export interface UnicodeBlockCoverage {
  name: string
  covered: number
  total: number
}

const BLOCKS: ReadonlyArray<readonly [string, number, number]> = [
  ["Basic Latin", 0x20, 0x7e],
  ["Latin-1 Supplement", 0xa0, 0xff],
  ["Latin Extended-A", 0x100, 0x17f],
  ["Latin Extended-B", 0x180, 0x24f],
  ["Greek and Coptic", 0x370, 0x3ff],
  ["Cyrillic", 0x400, 0x4ff],
  ["Cyrillic Supplement", 0x500, 0x52f],
  ["Armenian", 0x530, 0x58f],
  ["Hebrew", 0x590, 0x5ff],
  ["Arabic", 0x600, 0x6ff],
  ["Devanagari", 0x900, 0x97f],
  ["Thai", 0xe00, 0xe7f],
  ["Georgian", 0x10a0, 0x10ff],
  ["Latin Extended Additional", 0x1e00, 0x1eff],
  ["General Punctuation", 0x2000, 0x206f],
  ["Currency Symbols", 0x20a0, 0x20cf],
  ["Letterlike Symbols", 0x2100, 0x214f],
  ["Number Forms", 0x2150, 0x218f],
  ["Arrows", 0x2190, 0x21ff],
  ["Mathematical Operators", 0x2200, 0x22ff],
  ["Hiragana", 0x3040, 0x309f],
  ["Katakana", 0x30a0, 0x30ff],
  ["CJK Unified Ideographs", 0x4e00, 0x9fff],
  ["Hangul Syllables", 0xac00, 0xd7af],
  ["Alphabetic Presentation Forms", 0xfb00, 0xfb4f],
]

export function detectBlocks(ranges: CodepointRanges): UnicodeBlockCoverage[] {
  return BLOCKS.map(([name, from, to]) => ({
    name,
    covered: countInRange(ranges, from, to),
    total: to - from + 1,
  })).filter((block) => block.covered > 0)
}

/* ----------------------------------------------------------------- features */

/**
 * OpenType feature tags in words.
 *
 * Grouped by what a buyer is choosing between. A tag missing from this table
 * is still listed in the detail view by its tag; it is just not summarised.
 */
export const FEATURE_GROUPS = {
  ligatures: { label: "Ligatures", tags: ["liga", "dlig", "clig", "rlig"] },
  alternates: {
    label: "Alternates",
    tags: ["salt", "calt", "swsh", "aalt", "cswh", "titl"],
    prefixes: ["ss", "cv"],
  },
  numerals: { label: "Numerals", tags: ["lnum", "onum", "tnum", "pnum", "frac", "zero", "sups", "subs", "ordn"] },
  caps: { label: "Capitals", tags: ["smcp", "c2sc", "pcap", "c2pc", "case", "unic"] },
  spacing: { label: "Spacing", tags: ["kern", "cpsp"] },
} as const // prettier-ignore

export const FEATURE_LABELS: Record<string, string> = {
  liga: "Standard ligatures",
  dlig: "Discretionary ligatures",
  clig: "Contextual ligatures",
  rlig: "Required ligatures",
  salt: "Stylistic alternates",
  calt: "Contextual alternates",
  swsh: "Swashes",
  cswh: "Contextual swashes",
  aalt: "Access all alternates",
  titl: "Titling alternates",
  lnum: "Lining figures",
  onum: "Oldstyle figures",
  tnum: "Tabular figures",
  pnum: "Proportional figures",
  frac: "Fractions",
  zero: "Slashed zero",
  sups: "Superscript",
  subs: "Subscript",
  ordn: "Ordinals",
  smcp: "Small capitals",
  c2sc: "Capitals to small capitals",
  pcap: "Petite capitals",
  c2pc: "Capitals to petite capitals",
  case: "Case-sensitive forms",
  unic: "Unicase",
  kern: "Kerning",
  cpsp: "Capital spacing",
}

export function featureLabel(tag: string): string {
  if (FEATURE_LABELS[tag]) return FEATURE_LABELS[tag]
  const set = /^ss(\d\d)$/.exec(tag)
  if (set) return `Stylistic set ${Number(set[1])}`
  const variant = /^cv(\d\d)$/.exec(tag)
  if (variant) return `Character variant ${Number(variant[1])}`
  return tag
}

export type FeatureGroupKey = keyof typeof FEATURE_GROUPS

export function groupFeatures(tags: readonly string[]): Record<FeatureGroupKey, string[]> {
  const out: Record<FeatureGroupKey, string[]> = {
    ligatures: [],
    alternates: [],
    numerals: [],
    caps: [],
    spacing: [],
  }
  for (const tag of tags) {
    for (const [key, group] of Object.entries(FEATURE_GROUPS) as Array<
      [FeatureGroupKey, (typeof FEATURE_GROUPS)[FeatureGroupKey]]
    >) {
      const prefixes = "prefixes" in group ? group.prefixes : []
      if (
        (group.tags as readonly string[]).includes(tag) ||
        prefixes.some((prefix) => tag.startsWith(prefix) && /\d\d$/.test(tag))
      ) {
        out[key].push(tag)
      }
    }
  }
  return out
}
