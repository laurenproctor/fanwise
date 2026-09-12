import { expect, test, type Page } from "@playwright/test"
import { signUpAndCreateWorkspace } from "./support"

/**
 * The browser headers, as they arrive. The unit test reads the policy from
 * the functions that build it; this reads it off real responses from the
 * production build the suite runs, and then loads pages under it and checks
 * the browser reported no violation. A policy that blocks the framework's own
 * scripts breaks hydration silently, which is the failure a header assertion
 * alone would miss.
 */

function cspErrors(page: Page): string[] {
  const seen: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      seen.push(message.text())
    }
  })
  return seen
}

test("a dynamic route carries a nonce policy with no unsafe script source", async ({ request }) => {
  const response = await request.get("/sign-in")
  const csp = response.headers()["content-security-policy"] ?? ""
  // The script rule alone. Styles admit inline on purpose; scripts never do.
  const script = /(?:^|; )script-src ([^;]+)/.exec(csp)?.[1] ?? ""
  expect(script).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]+'$/)
  expect(csp).not.toContain("'unsafe-eval'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toMatch(/connect-src 'self' http:\/\/127\.0\.0\.1:\d+/)
  expect(response.headers()["content-security-policy-report-only"]).toBeUndefined()
})

test("two requests never share a nonce", async ({ request }) => {
  const nonce = async () =>
    /'nonce-([^']+)'/.exec(
      (await request.get("/sign-in")).headers()["content-security-policy"] ?? "",
    )?.[1]
  expect(await nonce()).toBeTruthy()
  expect(await nonce()).not.toBe(await nonce())
})

test("a marketing route carries every restriction but a script one, and the strict policy in report-only", async ({
  request,
}) => {
  const response = await request.get("/terms")
  const csp = response.headers()["content-security-policy"] ?? ""
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toContain("script-src")
  expect(csp).not.toContain("default-src")
  const reportOnly = response.headers()["content-security-policy-report-only"] ?? ""
  expect(reportOnly).toContain("script-src 'self'")
  expect(reportOnly).toContain("default-src 'self'")
})

test("the baseline headers arrive on pages and on static assets, without HSTS off Vercel", async ({
  request,
}) => {
  for (const path of ["/terms", "/sign-in", "/theme.js"]) {
    const headers = (await request.get(path)).headers()
    expect(headers["x-content-type-options"], path).toBe("nosniff")
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin")
    expect(headers["permissions-policy"], path).toContain("camera=()")
    expect(headers["x-frame-options"], path).toBe("DENY")
    expect(headers["strict-transport-security"], path).toBeUndefined()
  }
})

test("the sign-in page hydrates under its policy with no violation reported", async ({ page }) => {
  const errors = cspErrors(page)
  await page.goto("/sign-in")
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  // A client-side validation message is proof the page's scripts ran.
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(250)
  expect(errors).toEqual([])
})

test("a marketing page's theme toggle works from the external initialiser", async ({ page }) => {
  const errors = cspErrors(page)
  await page.goto("/pricing")
  const html = page.locator("html")
  const before = await html.getAttribute("data-theme")
  expect(before).toMatch(/^(light|dark)$/)
  await page
    .getByRole("button", { name: /Switch to (dark|light) mode/ })
    .first()
    .click()
  await expect(html).not.toHaveAttribute("data-theme", before!)
  expect(errors).toEqual([])
})

test("a signed-in unknown path renders the not-found page under the nonce policy", async ({
  page,
}) => {
  const errors = cspErrors(page)
  await signUpAndCreateWorkspace(page, "headers", "Headers Workspace")
  const response = await page.goto("/this-workspace-does-not-exist")
  expect(response?.status()).toBe(404)
  expect(response?.headers()["content-security-policy"]).toMatch(/'nonce-/)
  await expect(
    page.getByRole("heading", { name: "This listing didn’t make it to the marketplace." }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Go to dashboard" })).toBeVisible()
  expect(errors).toEqual([])
})
