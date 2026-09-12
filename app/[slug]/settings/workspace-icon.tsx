import { initialsOf } from "@/lib/workspaces/icons"

/**
 * The workspace's icon, or its initials.
 *
 * The image is decorative: the workspace name is always beside it in the form
 * and is the page's own h1 context, so an alt text here would read the name out
 * twice. The initials fallback is aria-hidden for the same reason.
 *
 * Not next/image. The source is a short-lived signed URL into a private bucket,
 * or a blob: URL for a pick that has not been saved, and neither is something
 * the optimizer can fetch and cache.
 */
export function WorkspaceIcon({
  name,
  url,
  size,
}: {
  name: string
  url: string | null
  size: number
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--color-rule)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
    >
      {url ? (
        <img src={url} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <span
          className="font-mono font-medium tracking-[0.04em]"
          style={{ fontSize: Math.round(size * 0.3) }}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  )
}
