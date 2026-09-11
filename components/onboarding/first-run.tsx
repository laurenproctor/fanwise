import { ButtonLink } from "@/components/ui/button"
import { FanOutGraphic } from "@/components/channels/fan-out-graphic"
import { routes } from "@/lib/routes"
import { ImportListingAction } from "./import-listing-action"
import { PublishPath } from "./publish-path"

/**
 * The catalog, before it has anything in it.
 *
 * Rendered by the workspace root whenever the workspace has no products, not
 * once after signup, so leaving and coming back before the first product lands
 * in the same place. It is not a wizard and remembers no step of its own:
 * everything it shows is read from the workspace, which today means no products,
 * which is step one of four with nothing complete.
 *
 * One primary action. The populated catalog's "New product" button and its
 * table are not repeated here.
 */
export function FirstRun({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <div className="flex flex-col">
      <section
        aria-labelledby="first-run-heading"
        className="grid items-center gap-x-10 gap-y-12 pb-14 pt-2 sm:pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-6 xl:pb-12"
      >
        <div className="flex flex-col items-start">
          <span className="label-mono">Catalog</span>
          <h1
            id="first-run-heading"
            className="mt-5 font-display text-[clamp(2.5rem,6.6vw,6rem)] font-extralight leading-none tracking-[-0.045em] text-balance"
          >
            Your first product starts here.
          </h1>
          <p className="mt-6 max-w-[40rem] font-display text-[clamp(1.25rem,2.3vw,2rem)] font-light leading-[1.3] tracking-[-0.02em] text-pretty text-[var(--color-ink-2)]">
            Add the source once. Fanwise will build the{" "}
            <span className="whitespace-nowrap">marketplace-ready</span> versions.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ButtonLink href={routes.newProduct(workspaceSlug)} className="min-h-[52px]">
              Create first product
              <ArrowIcon />
            </ButtonLink>
            {/* No import flow exists yet. When one does, pass its route here. */}
            <ImportListingAction href={null} />
          </div>
        </div>
        <FanOutGraphic className="lg:justify-self-end" />
      </section>

      <hr className="border-0 border-t border-[var(--color-rule)]" />

      <PublishPath completed={0} />
    </div>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="ml-1">
      <path
        d="M3 8h10m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
