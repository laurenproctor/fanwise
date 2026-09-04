import Link from "next/link"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-8 px-6 py-16">
      <Link href="/" className="flex flex-col gap-3">
        <span className="label-mono">Fanwise</span>
        <span className="font-display text-4xl font-extralight tracking-[-0.03em]">
          One catalog. Every channel.
        </span>
      </Link>
      {children}
    </main>
  )
}
