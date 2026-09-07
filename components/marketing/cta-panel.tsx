import Link from "next/link"
import { FanMark } from "./logo"

/**
 * The ink panel that closes four of the interior pages.
 *
 * `mark` is the 40px fan, which only the About page carries; `fine` is the
 * mono line under the button, which only Pricing carries.
 */
export function CtaPanel({
  title,
  body,
  action,
  mark = false,
  fine,
  size = "regular",
}: {
  title: string
  body: string
  action: { label: string; href: string }
  mark?: boolean
  fine?: string
  size?: "regular" | "large"
}) {
  return (
    <section style={{ padding: "0 0 92px" }}>
      <div className={size === "large" ? "fw-cta fw-cta--tall" : "fw-cta"}>
        {mark ? (
          <span style={{ color: "#ffffff" }}>
            <FanMark size={40} />
          </span>
        ) : null}
        <h2 className={size === "large" ? "fw-cta__title fw-cta__title--lg" : "fw-cta__title"}>
          {title}
        </h2>
        <p className="fw-cta__body">{body}</p>
        <Link href={action.href} className="fw-btn fw-btn--white">
          {action.label}
        </Link>
        {fine ? <small className="fw-cta__fine">{fine}</small> : null}
      </div>
    </section>
  )
}
