import Link from "next/link"
import { FanMark } from "./logo"
import { marketingRoutes } from "@/lib/routes"

const DEFINITION = "fanwise, adv. In the manner of a fan; spreading out from a single fixed point."

export const FANWISE_DEFINITION = DEFINITION

/**
 * The interior-page footer: mark, links, and the dictionary line.
 *
 * The link set is per page in the handoff, same as the nav, so it is passed in.
 */
export function SiteFooter({ links }: { links: { label: string; href: string }[] }) {
  return (
    <footer className="fw-footer">
      <Link href={marketingRoutes.landing} className="fw-brand">
        <FanMark />
        Fanwise
      </Link>
      <div className="fw-footer__links">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </div>
      <p className="fw-dict">{DEFINITION}</p>
    </footer>
  )
}
