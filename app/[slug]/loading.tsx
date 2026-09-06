export default function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="label-mono">Loading</span>
      <div className="h-6 w-48 rounded bg-[var(--color-paper-2)]" />
      <div className="h-32 w-full rounded-[14px] bg-[var(--color-paper-2)]" />
    </div>
  )
}
