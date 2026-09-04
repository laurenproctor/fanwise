import { NextResponse } from "next/server"

// Liveness probe. Deliberately does not touch the database: it answers
// "is the app running", not "is everything healthy".
export function GET() {
  return NextResponse.json({ ok: true, step: "A0" })
}
