import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser, getWorkspaceBySlug } from "@/lib/workspaces/queries"
import { getImport, listDeliverables } from "@/lib/imports/queries"
import {
  deliverablesFor,
  draftFor,
  evidenceChanges,
  licenseFor,
  rightsFor,
  stateFor,
} from "@/lib/imports/view"
import { isContentSourceKind } from "@/lib/imports/types"
import { ImportDetail } from "./import-detail"

export const metadata = { title: "Import a product · Fanwise" }

/**
 * One import.
 *
 * Every read goes through the signed-in member's client, so RLS is the tenancy
 * boundary: an import belonging to another workspace comes back as null and is
 * answered with the not-found page, which is indistinguishable from an id that
 * was never real. The workspace check above it is the same one every workspace
 * page repeats, per docs/security.md rule 7.
 *
 * The page is dynamic, so a refresh — including the client's poll while a job
 * is reading — always asks the database rather than a cache.
 */
export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ slug: string; importId: string }>
}) {
  if (!(await getCurrentUser())) redirect("/sign-in")

  const { slug, importId } = await params
  const workspace = await getWorkspaceBySlug(slug)
  if (!workspace) notFound()

  const supabase = await createClient()
  const record = await getImport(supabase, workspace.id, importId)
  if (!record) notFound()

  // A discarded import has no screen of its own; its product is gone with it.
  if (record.row.status === "discarded") redirect(`/${workspace.slug}/new/link`)

  const assets = await listDeliverables(supabase, workspace.id, record.row.product_id)

  return (
    <ImportDetail
      workspaceSlug={workspace.slug}
      importId={record.row.id}
      productSlug={record.product.slug}
      productId={record.row.product_id}
      state={stateFor(record)}
      draft={draftFor(record)}
      deliverables={deliverablesFor(assets)}
      license={licenseFor(record)}
      rights={rightsFor(record)}
      missingInformation={record.missingInformation}
      withheld={record.withheld}
      aiUnavailable={record.aiUnavailable}
      changes={evidenceChanges(record)}
      sourceMode={isContentSourceKind(record.row.provider) ? "content" : "link"}
    />
  )
}
