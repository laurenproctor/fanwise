import { z } from "zod"

/**
 * Environment validation. Fails fast at boot rather than at the first request.
 *
 * Server secrets live in `serverSchema` and must never be imported into a client
 * component. Anything the browser may see is prefixed NEXT_PUBLIC_ and lives in
 * `clientSchema`.
 */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.url(),
})

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SENTRY_DSN: z.url().optional().or(z.literal("")),
  // Required from step A5, when the first marketplace credentials are stored.
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
})

export type ClientEnv = z.infer<typeof clientSchema>
export type ServerEnv = z.infer<typeof serverSchema>

function format(error: z.ZodError): string {
  return error.issues.map((i) => "  " + i.path.join(".") + ": " + i.message).join("\n")
}

let cachedClient: ClientEnv | null = null
let cachedServer: ServerEnv | null = null

export function clientEnv(): ClientEnv {
  if (cachedClient) return cachedClient
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  })
  if (!parsed.success) {
    throw new Error("Invalid public environment variables:\n" + format(parsed.error))
  }
  cachedClient = parsed.data
  return cachedClient
}

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser. Server secrets never cross that line.")
  }
  if (cachedServer) return cachedServer
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error("Invalid server environment variables:\n" + format(parsed.error))
  }
  cachedServer = parsed.data
  return cachedServer
}

/** Test seam. Never call from application code. */
export function resetEnvCacheForTests(): void {
  cachedClient = null
  cachedServer = null
}

export const schemas = { clientSchema, serverSchema }
