import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import { GLOSSARY, type GlossaryTerm } from "@/lib/ui/glossary"
import { CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/lib/channels/types"
import { LIVENESS_LABELS } from "@/lib/publishing/manual-steps"

/**
 * The glossary is copy, and copy rots quietly. Nothing fails when an
 * explanation is deleted from a screen and left in the module, or when a new
 * capability is declared and never explained — it just gets a little less true
 * every step. These are the parts of that a test can actually hold.
 */

const ROOT = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const terms = Object.keys(GLOSSARY) as GlossaryTerm[]

describe("every term the interface can render is defined", () => {
  /**
   * Both of these are keyed by something the rest of the system already
   * enumerates, so a term cannot be added there and forgotten here. TypeScript
   * catches it at the call site; this catches it at the source, which is where
   * someone adding a capability is actually looking.
   */
  it("explains every capability an adapter can declare", () => {
    for (const key of CAPABILITY_KEYS) {
      expect(GLOSSARY[key], `no explanation for the ${key} capability`).toBeDefined()
      expect(GLOSSARY[key].label).toBe(CAPABILITY_LABELS[key])
    }
  })

  it("explains every state a listing can be in", () => {
    for (const [liveness, label] of Object.entries(LIVENESS_LABELS)) {
      const entry = GLOSSARY[liveness as GlossaryTerm]
      expect(entry, `no explanation for the ${liveness} status`).toBeDefined()
      // The tip's heading and the pill's word are the same word, or the tip
      // looks like it is describing something else on the screen.
      expect(entry.label).toBe(label)
    }
  })
})

describe("the copy stays worth opening", () => {
  it.each(terms)("%s says something the label did not", (term) => {
    const { label, body } = GLOSSARY[term]

    expect(label.trim()).not.toBe("")
    expect(body.trim()).not.toBe("")
    // Short enough and it is a restatement; a tooltip that repeats the word it
    // sits beside is worse than no tooltip, because it was worth a click.
    expect(body.length).toBeGreaterThan(80)
    expect(body.endsWith(".")).toBe(true)
    expect(body.toLowerCase()).not.toBe(label.toLowerCase())
  })

  it("has no duplicate explanations", () => {
    const bodies = terms.map((term) => GLOSSARY[term].body)
    expect(new Set(bodies).size).toBe(bodies.length)
  })
})

describe("nothing is defined and left unrendered", () => {
  it("names every term it defines somewhere in the interface", () => {
    /**
     * Deliberately a search for the name rather than for <InfoTip term="x">.
     * A term reaches the component by several routes: straight through the
     * prop, through a wrapper that takes one of its own, or out of a table of
     * rows next to the label it belongs to. Following those properly means
     * type-checking the tree, which the compiler already did. What is left for
     * a test is the cheap half — copy that is written down and then named
     * nowhere at all, which is the way this file will actually rot.
     */
    const dynamic = new Set<string>([...CAPABILITY_KEYS, ...Object.keys(LIVENESS_LABELS)])

    const named = new Set<string>()
    for (const file of sourceFiles(ROOT)) {
      // The test tree names terms in assertions rather than rendering them.
      if (relative(ROOT, file).split(sep)[0] === "tests") continue
      const contents = readFileSync(file, "utf8")
      for (const quoted of contents.matchAll(/"([A-Za-z_]+)"/g)) {
        if (quoted[1]) named.add(quoted[1])
      }
    }

    const unused = terms.filter((term) => !named.has(term) && !dynamic.has(term))
    expect(unused, "defined in the glossary and shown nowhere").toEqual([])
  })

  it("renders no term the glossary has not defined", () => {
    const unknown: string[] = []
    for (const file of sourceFiles(ROOT)) {
      if (relative(ROOT, file).split(sep)[0] === "tests") continue
      const contents = readFileSync(file, "utf8")
      for (const match of contents.matchAll(/<InfoTip\s+term="([A-Za-z_]+)"/g)) {
        const name = match[1]
        if (name && !(name in GLOSSARY)) unknown.push(`${relative(ROOT, file)}: ${name}`)
      }
    }
    expect(unknown).toEqual([])
  })
})
