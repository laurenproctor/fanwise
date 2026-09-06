import { z } from "zod"
import { SLUG_LIMITS } from "@/lib/slug"

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(80, "Keep the name under 80 characters.")

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_LIMITS.min, `Slugs are at least ${SLUG_LIMITS.min} characters.`)
  .max(SLUG_LIMITS.max, `Slugs are at most ${SLUG_LIMITS.max} characters.`)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.")

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema })

export const emailSchema = z.email("Enter a valid email address.")

// Supabase Auth's own floor is 6. Ours is higher because raising it later
// strands existing accounts.
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Passwords are limited to 72 characters.")

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type CredentialsInput = z.infer<typeof credentialsSchema>

export const passwordResetRequestSchema = z.object({ email: emailSchema })

/**
 * Setting a password with no old password to check against, so the confirmation
 * field is the only guard against a typo locking someone out of the account
 * they just recovered.
 */
export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: "Those passwords do not match.",
    path: ["confirm"],
  })

export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>
export type NewPasswordInput = z.infer<typeof newPasswordSchema>
