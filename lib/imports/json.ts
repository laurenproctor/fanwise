import type { Json } from "@/lib/supabase/database.types"

/**
 * A value as the `jsonb` columns actually store it.
 *
 * A round trip rather than a cast, and the difference is real rather than
 * ceremonial: `JSON.stringify` is what the driver is going to do anyway, so
 * doing it here means a value carrying something jsonb cannot hold — a `Date`,
 * an `undefined`, a class instance with methods — is normalized at the point of
 * writing instead of arriving in the column as a shape nothing can read back.
 *
 * The cast afterwards is the honest one: whatever survives a round trip through
 * JSON is JSON. Interfaces with named keys do not satisfy `Json`'s index
 * signature structurally, which is a TypeScript detail rather than a fact about
 * the data, and this is where that detail is paid for once.
 */
export function toJson<T>(value: T): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
