import { redirect } from "next/navigation"
import { marketingRoutes } from "@/lib/routes"

/**
 * `/start` is the address the handoff gave its own signup page, which collected
 * a name, an email, a product category and a first shop, and did nothing with
 * any of them. The real account form asks for an email and a password, so there
 * was nothing to port: a second form that cannot create an account is worse than
 * no form.
 *
 * The route stays as a redirect rather than disappearing, because the mockups
 * are published and a link written against them should still arrive somewhere
 * that works. It also keeps "start" honestly reserved in lib/slug.ts — a
 * workspace slugged `start` would still be unreachable behind this.
 */
export default function StartPage() {
  redirect(marketingRoutes.signUp)
}
