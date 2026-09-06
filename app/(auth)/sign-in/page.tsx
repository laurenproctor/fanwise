import Link from "next/link"
import { redirect } from "next/navigation"
import { signInAction } from "@/lib/auth/actions"
import { getCurrentUser } from "@/lib/workspaces/queries"
import { CredentialsForm } from "../credentials-form"

export const metadata = { title: "Sign in · Fanwise" }

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/")

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-[-0.02em]">Sign in</h1>
      <CredentialsForm
        action={signInAction}
        submitLabel="Sign in"
        passwordAutoComplete="current-password"
      />
      <p className="text-[14px] text-[var(--color-ink-2)]">
        <Link
          href="/forgot-password"
          className="text-[var(--color-accent)] underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </p>
      <p className="text-[14px] text-[var(--color-ink-2)]">
        No account?{" "}
        <Link href="/sign-up" className="text-[var(--color-accent)] underline underline-offset-4">
          Create one
        </Link>
        .
      </p>
    </div>
  )
}
