import { expect, test } from "@playwright/test"

/**
 * The deployment answers at all.
 *
 * What used to sit beside this — the root serving the landing page to a
 * stranger, and the application turning a stranger away — is asserted more
 * strongly elsewhere: marketing.spec.ts loads `/` signed out and reads its
 * headline, journey-09-tenancy.spec.ts sends a stranger to a private workspace
 * and watches them land on sign-in, and tests/unit/proxy.test.ts runs the proxy
 * over every private route.
 */
test("the health endpoint answers", async ({ request }) => {
  const response = await request.get("/api/health")
  expect(response.ok()).toBeTruthy()
  expect(await response.json()).toMatchObject({ ok: true })
})
