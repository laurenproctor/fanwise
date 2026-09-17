import { z } from "zod"

/**
 * What an image asset's `metadata` may carry, read from one place.
 *
 * `product_assets.metadata` is the one column of a ready image that may still
 * change: the immutability trigger leaves it alone so a picture can be
 * described, measured or re-read without being replaced. Everything written
 * there about an image is named here, so the finalize job, the alt text job,
 * the channel adapters and the editors agree on the keys.
 *
 *   width, height   measured by the finalize job for pictures it can decode
 *   altText         what a screen reader says for the image, at most 250 chars
 *   altTextSource   who wrote it: the creator, or a suggestion from the model
 *
 * None of this is on the product. An image is a fact about the product that
 * several channels want, not a channel field (architecture invariant 1).
 */

export const ALT_TEXT_MAX = 250

export const altTextSchema = z
  .string()
  .trim()
  .max(ALT_TEXT_MAX, `Keep alt text under ${ALT_TEXT_MAX} characters.`)

export type AltTextSource = "creator" | "generated"

/** Image dimensions, written by the finalize job for pictures it can decode. */
export const imageDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export function readImageDimensions(metadata: unknown): { width: number; height: number } | null {
  const parsed = imageDimensionsSchema.safeParse(metadata)
  return parsed.success ? parsed.data : null
}

/** The alt text on an image, or an empty string when nobody has written one. */
export function readAltText(metadata: unknown): string {
  const alt = (metadata as { altText?: unknown } | null)?.altText
  return typeof alt === "string" ? alt : ""
}

/** Who wrote the alt text. Null when there is none, or when it predates the label. */
export function readAltTextSource(metadata: unknown): AltTextSource | null {
  if (readAltText(metadata).trim().length === 0) return null
  const source = (metadata as { altTextSource?: unknown } | null)?.altTextSource
  return source === "generated" ? "generated" : "creator"
}

/**
 * What a channel is told an image shows.
 *
 * The creator's or the model's words when there are any, otherwise the
 * product's name. Never the filename: alt text is read aloud to a buyer, and
 * "Screenshot 2026-09-05 at 6.51.39 PM.jpg" tells them nothing.
 */
export function altTextFor(metadata: unknown, fallback: string): string {
  const written = readAltText(metadata).trim()
  return (written.length > 0 ? written : fallback).slice(0, ALT_TEXT_MAX)
}
