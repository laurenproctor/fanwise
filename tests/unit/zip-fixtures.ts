import { deflateRawSync } from "node:zlib"

/**
 * Tiny ZIP archives built in memory, for the reader and the package inspector.
 *
 * Writes the two structures the reader depends on, a local header per entry
 * and the central directory, with the flags the tests care about: UTF-8
 * names, the encryption bit, and the ZIP64 markers the reader must refuse.
 * CRCs are left zero; the reader never checks them.
 */

export interface ZipFixtureEntry {
  path: string
  data: Uint8Array
  method?: "store" | "deflate"
  encrypted?: boolean
  utf8?: boolean
}

export function buildZip(
  entries: readonly ZipFixtureEntry[],
  options: { zip64?: boolean; comment?: string } = {},
): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.path, entry.utf8 === false ? "latin1" : "utf8")
    const method = entry.method === "store" ? 0 : 8
    const payload = method === 0 ? Buffer.from(entry.data) : deflateRawSync(entry.data)
    const flags = (entry.encrypted ? 0x0001 : 0) | (entry.utf8 === false ? 0 : 0x0800)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(options.zip64 ? 0xffffffff : entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, payload)
    centrals.push(central)
    offset += local.length + payload.length
  }

  const directory = Buffer.concat(centrals)
  const comment = Buffer.from(options.comment ?? "", "utf8")
  const end = Buffer.alloc(22 + comment.length)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  comment.copy(end, 22)

  return Buffer.concat([...locals, directory, end])
}
