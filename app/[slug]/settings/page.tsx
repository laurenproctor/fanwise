import { notFound, redirect } from "next/navigation"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getBillingOverview, listBillingLedger } from "@/lib/billing/queries"
import { createIconUrl } from "@/lib/workspaces/icons"
import { accountProfile } from "@/lib/account/profile"
import { appOrigin } from "@/lib/channels/oauth"
import { BillingPanel } from "@/components/billing/billing-panel"
import { BillingLedger } from "@/components/billing/billing-ledger"
import { FanLines } from "@/components/ui/fan-lines"
import { AccountForm } from "./account-form"
import { SettingsSection } from "./settings-section"
import { StudioDetailsForm } from "./studio-details-form"

export const metadata = { title: "Settings · Fanwise" }

/**
 * Three sections: the studio, what it costs, and the person signed in.
 *
 * A server component that reads everything once and hands it down. The two forms
 * below it are client components because a dirty-state button and a staged file
 * pick are browser behaviour; nothing else here is.
 *
 * There is no Access or Permissions section. Every workspace has exactly one
 * owner in V1 and no way to invite anybody, so a members table was a list of one
 * row saying "you", and a roles column describing a model nothing can yet
 * change. The ownership model itself is untouched: workspace_members still
 * carries the role, the RLS policies still read it, and listWorkspaceMembers()
 * is still there for the step that gives it a UI worth having.
 */
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ billing?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in")

  const { slug } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const [billing, ledger, { billing: billingNotice }, iconUrl] = await Promise.all([
    getBillingOverview(workspace),
    listBillingLedger(workspace.id),
    searchParams,
    // Short lived and minted per render. Null when the object is gone, which
    // falls back to initials rather than to a broken image.
    workspace.icon_path ? createIconUrl(workspace.icon_path) : Promise.resolve(null),
  ])

  const profile = accountProfile(user)

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-12 pb-24 sm:gap-14 lg:gap-16">
      <header className="relative isolate flex flex-col gap-4 overflow-hidden pt-4 pb-2">
        <FanLines className="-top-4 -right-6 -z-10 hidden h-[230px] w-[280px] opacity-60 lg:block" />
        <span className="label-mono">Settings</span>
        <h1 className="font-display max-w-[16ch] text-[44px] leading-[1.05] font-extralight tracking-[-0.04em] text-balance sm:text-[56px]">
          Studio settings
        </h1>
        <p className="max-w-prose text-[16px] text-[var(--color-ink-2)]">
          Manage the studio behind every product and marketplace: its identity, what it costs, and
          the personal account you sign in with.
        </p>
      </header>

      <SettingsSection
        id="studio-details"
        heading="Studio details"
        description="Icon, name and address."
      >
        <StudioDetailsForm
          workspaceSlug={workspace.slug}
          appOrigin={appOrigin()}
          name={workspace.name}
          iconUrl={iconUrl}
          hasIcon={workspace.icon_path !== null}
        />
      </SettingsSection>

      <SettingsSection
        id="subscription"
        heading="Subscription"
        description="Plan, marketplaces and what they cost."
      >
        <div className="flex flex-col gap-10">
          <BillingPanel
            workspaceSlug={workspace.slug}
            state={billing.state}
            billableConnections={billing.billableConnections}
            notice={billingNotice ?? null}
          />

          <div className="flex flex-col gap-4">
            <h3 className="label-mono">Billing history</h3>
            <BillingLedger entries={ledger} />
            <p className="max-w-prose text-[13px] text-[var(--color-ink-3)]">
              Connecting a marketplace adds it to the next invoice, prorated for the rest of the
              period. Disconnecting one keeps it through the end of the period you have paid for and
              takes it off the invoice after that. Nothing is refunded mid-period.
              {billing.hasCustomer ? " Invoices and receipts live in the billing portal." : null}
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        id="account"
        heading="Account"
        description="Personal details and sign-in security."
      >
        <AccountForm workspaceSlug={workspace.slug} profile={profile} />
      </SettingsSection>
    </div>
  )
}
