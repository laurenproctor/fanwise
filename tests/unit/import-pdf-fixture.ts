/**
 * A real, minimal PDF, built byte by byte with correct cross-reference offsets.
 *
 * Built rather than checked in, so the fixture is readable in review and a test
 * can say exactly what text the document holds. One page, Helvetica, one line of
 * text per entry. PDF.js opens it without warnings.
 */
export function buildPdf(lines: readonly string[], options: { title?: string } = {}): Uint8Array {
  const escape = (text: string) => text.replace(/[()\\]/g, (c) => `\\${c}`)
  const content = [
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "72 720 Td",
    ...lines.flatMap((line) => [`(${escape(line)}) Tj`, "T*"]),
    "ET",
  ].join("\n")

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  if (options.title !== undefined) objects.push(`<< /Title (${escape(options.title)}) >>`)

  let out = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"))
    out += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, "latin1")
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")
  const info = options.title !== undefined ? ` /Info ${objects.length} 0 R` : ""
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${info} >>\nstartxref\n${xref}\n%%EOF\n`

  return new Uint8Array(Buffer.from(out, "latin1"))
}
