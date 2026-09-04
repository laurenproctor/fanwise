import Link from "next/link"
import { redirect } from "next/navigation"
import { signUpAction } from "@/lib/auth/actions"
import { getCurrentUser } from "@/lib/workspaces/queries"
import { CredentialsForm } from "../credentials-form"

export const metadata = { title: "Create an account · Fanwise" }

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/")

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-light tracking-[-0.02em]">Create an account</h1>
      <CredentialsForm
        action={signUpAction}
        submitLabel="Create account"
        passwordHint="At least 10 characters."
        passwordAutoComplete="new-password"
      />
      <p className="text-[14px] text-[var(--color-ink-2)]">
        Already have one?{" "}
        <Link href="/sign-in" className="text-[var(--color-accent)] underline underline-offset-4">
          Sign in
        </Link>
        .
      </p>
    </div>
  )
}
