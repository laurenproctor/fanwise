import { track } from "@vercel/analytics"
import type { InvocationMethod } from "./types"

/**
 * Two events, and the shape of each is the whole privacy policy.
 *
 * The provider Fanwise already reports page views to (app/layout.tsx) takes
 * these as custom events. They carry a command's id and how it was invoked
 * and nothing else: never a keystroke, never the palette's search text,
 * never a product's name. A command id is a word from lib/commands, not a
 * thing a creator typed.
 *
 * `track` only reports from a Vercel deployment and is silent elsewhere, and
 * it is wrapped anyway: analytics failing must never stop a command.
 */

export type CommandEvent =
  | { type: "command_palette_opened" }
  | { type: "command_executed"; id: string; method: InvocationMethod }

export function recordCommandEvent(event: CommandEvent): void {
  try {
    if (event.type === "command_palette_opened") track("command_palette_opened")
    else track("command_executed", { id: event.id, method: event.method })
  } catch {
    // Reporting is a courtesy, never a dependency.
  }
}
