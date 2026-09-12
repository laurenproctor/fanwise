/**
 * The public loading state.
 *
 * Blocks in the shape of the page that is coming — an avatar, a title, a grid
 * of cards — at the sizes those elements actually occupy, so the content
 * arriving does not move anything. A spinner would reserve no space and let
 * the whole page jump into place.
 */
export default function PublicLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-[1160px] px-5 pt-14 sm:px-8"
    >
      <span className="sr-only">Loading</span>
      <div className="flex gap-6 border-b border-[var(--color-rule)] pb-10">
        <div className="h-[96px] w-[96px] shrink-0 rounded-[20px] bg-[var(--color-paper-2)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="h-10 w-[min(320px,70%)] rounded bg-[var(--color-paper-2)]" />
          <div className="h-4 w-[min(440px,90%)] rounded bg-[var(--color-paper-2)]" />
          <div className="h-4 w-[min(200px,50%)] rounded bg-[var(--color-paper-2)]" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 pt-12 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            style={{ aspectRatio: "4 / 3" }}
            className="w-full rounded-[16px] bg-[var(--color-paper-2)]"
          />
        ))}
      </div>
    </div>
  )
}
