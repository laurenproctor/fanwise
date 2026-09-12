import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CHANNEL_MARKS, findChannelMark } from "@/components/channels/channel-mark"
import { SHOP_MARKS, findShopMark } from "@/components/marketing/shop-mark"
import { RAIL, SHOPS } from "@/components/marketing/channels"
import { listAdapters } from "@/lib/channels/registry"
import { CHANNEL_KEYS } from "@/lib/channels/types"

/**
 * A logo is the one piece of copy on the channels page that a creator reads
 * before the words. Getting it wrong is not a cosmetic failure: the mark sits
 * directly above a button that starts an authorization, so a card wearing the
 * wrong shop's logo is a creator handing Fanwise the keys to a shop they did
 * not mean to connect.
 *
 * None of that is checkable by looking at the picture, which is why these tests
 * hold the structure around it instead.
 */

const ROOT = join(__dirname, "..", "..")

describe("the mark table only describes channels that exist", () => {
  it("keys every mark to a registered channel", () => {
    // Typed as Partial<Record<ChannelKey, …>> already, so this is the runtime
    // half: a key removed from the union during a channel's retirement should
    // not leave a mark behind pointing at nothing.
    for (const key of Object.keys(CHANNEL_MARKS)) {
      expect(CHANNEL_KEYS, `${key} has a mark but is not a channel key`).toContain(key)
    }
  })

  it("gives every mark a colour and a path", () => {
    for (const [key, mark] of Object.entries(CHANNEL_MARKS)) {
      expect(mark.hex, `${key}`).toMatch(/^#[0-9A-F]{6}$/)
      // Every mark is one path on the same 24 by 24 box as the fan mark, so the
      // component can size them all the same way. A path that starts anywhere
      // but a move command is a path that was pasted in wrong.
      expect(mark.path.startsWith("M") || mark.path.startsWith("m"), `${key}`).toBe(true)
      expect(mark.path.length).toBeGreaterThan(50)
    }
  })

  it("never gives two channels the same mark", () => {
    // The failure this catches is a copy-paste during the next channel's
    // wiring, which produces a card that looks finished and is wrong.
    const paths = Object.values(CHANNEL_MARKS).map((mark) => mark.path)
    expect(new Set(paths).size).toBe(paths.length)

    const hexes = Object.values(CHANNEL_MARKS).map((mark) => mark.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
  })
})

describe("a channel without a mark degrades instead of guessing", () => {
  it("returns null rather than a stand-in for an unregistered key", () => {
    expect(findChannelMark("not_a_channel")).toBeNull()
  })

  it("leaves the mock channels unmarked", () => {
    // They are not shops. A logo on a development channel is a logo nobody
    // could have drawn from life.
    expect(findChannelMark("mock_api")).toBeNull()
    expect(findChannelMark("mock_assisted")).toBeNull()
  })

  it("marks every real channel currently registered", () => {
    // The one test here that will fail on purpose. A new adapter lands, this
    // goes red, and somebody has to decide what the card shows before the
    // channel reaches a creator.
    const unmarked = listAdapters()
      .filter((adapter) => !adapter.key.startsWith("mock_"))
      .filter((adapter) => findChannelMark(adapter.key) === null)
      .map((adapter) => adapter.key)

    expect(unmarked).toEqual([])
  })
})

/**
 * The marketing site keeps its own table, the same bargain
 * components/marketing/channels.ts already strikes: the public site does not
 * read the adapter layer, so adding a channel cannot quietly rewrite the
 * public copy, and the site names four shops that have no adapter at all.
 *
 * The price of two tables is that they can disagree, and a creator who sees
 * one logo on the Marketplaces page and a different one after signing up has
 * been shown two different companies. This is what holds them together.
 */
describe("the marketing marks and the channel marks agree", () => {
  // Every shop the site names anywhere: the spec cards and the landing rail,
  // which are not the same list. The rail names Gumroad, which has no card.
  const shopNames = new Set<string>([
    ...SHOPS.map((shop) => shop.name),
    ...RAIL.map(([name]) => name),
  ])

  it("only marks shops the marketing site actually names", () => {
    for (const name of Object.keys(SHOP_MARKS)) {
      expect(shopNames, `${name} has a mark but is named on no page`).toContain(name)
    }
  })

  it("marks the rail, or falls back without throwing", () => {
    // The rail cell has no room for a word of explanation, so every cell has
    // to render something: a mark, or the initial. Neither may be blank.
    for (const [name] of RAIL) {
      const rendered = SHOP_MARKS[name] ?? name.trim().charAt(0)
      expect(rendered, `${name} renders nothing in the rail`).toBeTruthy()
    }
  })

  it("draws a shop the same way on both surfaces", () => {
    // Matched through the adapter's own name rather than a hand-written map,
    // so a channel renamed on one side and not the other fails here too.
    const overlapping = listAdapters()
      .map((adapter) => ({
        channel: findChannelMark(adapter.key),
        shop: findShopMark(adapter.name),
      }))
      .filter(({ channel, shop }) => channel && shop)

    // If this is empty the test has stopped testing anything, which is the
    // quiet way a pin like this dies.
    expect(overlapping.length).toBeGreaterThan(0)

    for (const { channel, shop } of overlapping) {
      expect(shop!.hex).toBe(channel!.hex)
      expect(shop!.path).toBe(channel!.path)
    }
  })

  it("marks every shop the product can already publish to", () => {
    // A shop Fanwise has an adapter for is one a visitor is most likely to
    // recognise, and the one least excusable to leave as a grey initial.
    const unmarked = listAdapters()
      .filter((adapter) => shopNames.has(adapter.name))
      .filter((adapter) => !findShopMark(adapter.name))
      .map((adapter) => adapter.name)

    expect(unmarked).toEqual([])
  })
})

describe("the mark is drawn as decoration", () => {
  const source = readFileSync(join(ROOT, "components", "channels", "channel-mark.tsx"), "utf8")

  it("hides both the tile and the glyph from assistive technology", () => {
    // The channel's name is the heading beside it. A mark announced as well
    // reads the shop's name twice and adds nothing.
    expect(source.match(/aria-hidden/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it("styles its own surfaces through tokens, and spends literals only on the brand", () => {
    // docs/design-system.md: style through tokens. The brand hexes are the
    // stated exception and live in the table; the fallback tile has no such
    // excuse, so it may not carry a literal of its own.
    const fallback = source.slice(
      source.indexOf("if (!mark)"),
      source.indexOf("return (\n    <span"),
    )
    expect(fallback).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    expect(fallback).toMatch(/var\(--color-/)
  })
})
