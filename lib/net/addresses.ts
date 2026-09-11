import { BlockList, isIP } from "node:net"

/**
 * Which addresses an outbound request may never be sent to.
 *
 * A creator types a hostname and Fanwise then makes authenticated requests
 * to it from a server that can also reach things a browser cannot: the loopback
 * interface, the private network the server sits on, and the cloud metadata
 * service that hands out the machine's own credentials. The hostname is
 * resolved and every address it yields is checked here before a socket is
 * opened. This is the whole of the list, so a reader can audit it in one
 * place.
 *
 * `net.BlockList` does the parsing and the range arithmetic. It understands
 * IPv4, IPv6 and the IPv4-mapped IPv6 form, which is what keeps this file from
 * growing an address parser of its own. The one thing done by hand is
 * unwrapping the two well-known prefixes that embed an IPv4 address inside an
 * IPv6 one, so the embedded address is judged as IPv4.
 */

export type Family = 4 | 6

export interface ResolvedAddress {
  address: string
  family: Family
}

const blocked = new BlockList()

// IPv4. RFC 6890 special-purpose ranges, plus the two carrier and cloud
// ranges that are not private on paper and are on every real network.
const IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT; also Alibaba Cloud metadata
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local; also AWS, GCP, Azure, Oracle metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation, TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast, deprecated
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation, TEST-NET-2
  ["203.0.113.0", 24], // documentation, TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and 255.255.255.255 broadcast
  ["168.63.129.16", 32], // Azure wire server, a public-looking address
]

// IPv6. Unspecified, loopback, the documentation and discard prefixes, the
// three tunnelling prefixes that embed an IPv4 address, unique-local (which
// is where AWS's IPv6 metadata endpoint lives), link-local, the deprecated
// site-local range, and multicast.
const IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible, deprecated; ::a.b.c.d
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo, embeds an IPv4 address
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, embeds an IPv4 address
  ["fc00::", 7], // unique local; fd00:ec2::254 is AWS metadata
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local, deprecated
  ["ff00::", 8], // multicast
]

for (const [address, prefix] of IPV4) blocked.addSubnet(address, prefix, "ipv4")
for (const [address, prefix] of IPV6) blocked.addSubnet(address, prefix, "ipv6")

/**
 * The IPv4 address embedded in an IPv4-mapped (`::ffff:0:0/96`) or NAT64
 * well-known-prefix (`64:ff9b::/96`) IPv6 address, in dotted form, or null
 * when the address is not one of those.
 *
 * `net.BlockList` already treats the dotted mapped form correctly; the hex
 * spellings of the same address (`::ffff:7f00:1`) and the NAT64 prefix are
 * the reason this exists. The arithmetic is on the last 32 bits only, which
 * is not an address parser: `isIP` has already said the string is IPv6.
 */
export function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase()
  const match = /^(?:::ffff:|64:ff9b::)(.+)$/.exec(lower)
  if (!match) return null
  const tail = match[1]!
  if (isIP(tail) === 4) return tail

  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
  if (!hex) return null
  const high = parseInt(hex[1]!, 16)
  const low = parseInt(hex[2]!, 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * True when a request must not be sent to this address. Anything that is not
 * an address at all is refused too: the only way to reach a socket is with a
 * string `isIP` accepts.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return true
  // A zone index names an interface on this machine. Never ours to use.
  if (address.includes("%")) return true

  if (family === 6) {
    const embedded = embeddedIpv4(address)
    if (embedded) return isBlockedAddress(embedded)
    return blocked.check(address, "ipv6")
  }
  return blocked.check(address, "ipv4")
}
