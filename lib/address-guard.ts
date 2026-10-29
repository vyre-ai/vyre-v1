// Which IP addresses a server must never dial on a stranger's say-so. One list, used by the public document fetcher and by the connector HTTP step.
// An address is refused when it is loopback, private, link-local, shared (carrier-grade NAT, where a tailnet lives), unspecified, multicast, reserved, or an IPv6 form that wraps one of those (mapped, NAT64, 6to4).
import { isIP } from "node:net";

export function normalizedHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.+$/, "");
  const zone = host.indexOf("%");
  if (zone !== -1) host = host.slice(0, zone);
  return host;
}

function parseV4(ip: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  const parts = [match[1], match[2], match[3], match[4]].map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

export function blockedV4(first: number, second: number, third = 0): boolean {
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;   // shared address space, where the tailnet lives
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 192 && second === 0 && third === 0) return true;     // protocol assignments
  if (first === 198 && (second === 18 || second === 19)) return true; // benchmarking
  if (first >= 224) return true;                                      // multicast, reserved, broadcast
  return false;
}

function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  try {
    text = new URL(`https://[${text}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const side = (part: string): number[] | null => {
    if (part === "") return [];
    const labels = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] ?? "";
      if (label.includes(".")) {
        if (i !== labels.length - 1) return null;
        const v4 = parseV4(label);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(label)) return null;
      out.push(parseInt(label, 16));
    }
    return out;
  };
  if (halves.length === 1) {
    const full = side(text);
    return full && full.length === 8 ? full : null;
  }
  const left = side(halves[0] ?? "");
  const right = side(halves[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function blockedV6(words: number[]): boolean {
  const w0 = words[0] ?? 0;
  const w1 = words[1] ?? 0;
  const w2 = words[2] ?? 0;
  const w3 = words[3] ?? 0;
  const w4 = words[4] ?? 0;
  const w5 = words[5] ?? 0;
  const w6 = words[6] ?? 0;
  const w7 = words[7] ?? 0;
  if (words.every((w) => w === 0)) return true;                     // "::" dials localhost on Linux
  if (w0 === 0x0064 && w1 === 0xff9b && w2 === 1) return true;      // 64:ff9b:1::/48, local-use NAT64
  if ((w0 & 0xff00) === 0xff00) return true;                        // multicast
  if ((w0 & 0xfe00) === 0xfc00) return true;
  if ((w0 & 0xffc0) === 0xfe80) return true;
  if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && w6 === 0 && w7 === 1) return true;
  const mapped = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && (w5 === 0 || w5 === 0xffff);
  const nat64 = w0 === 0x0064 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0;
  const sixToFour = w0 === 0x2002;
  if ((mapped || nat64) && blockedV4(w6 >> 8, w6 & 0xff, w7 >> 8)) return true;
  if (sixToFour && blockedV4(w1 >> 8, w1 & 0xff, w2 >> 8)) return true;
  return false;
}

/** True when the address text is not a public unicast address, or is not an address at all. */
export function refusesAddress(raw: string): boolean {
  const host = normalizedHost(raw);
  if (isIP(host) === 4) {
    const parts = parseV4(host);
    if (!parts) return true;
    return blockedV4(parts[0], parts[1], parts[2]);
  }
  if (isIP(host) !== 6) return true;
  const words = expandV6(host);
  if (!words) return true;
  return blockedV6(words);
}


/** The addresses that are wrong for anyone to dial, even a caller's own computer: multicast, reserved, broadcast, benchmarking, protocol assignments, local-use NAT64. */
export function reservedAddress(raw: string): boolean {
  const host = normalizedHost(raw);
  const v4 = (a: number, b: number, c: number): boolean => a >= 224 || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0);
  if (isIP(host) === 4) {
    const parts = parseV4(host);
    return parts ? v4(parts[0], parts[1], parts[2]) : true;
  }
  if (isIP(host) !== 6) return true;
  const w = expandV6(host);
  if (!w) return true;
  const w0 = w[0] ?? 0;
  if ((w0 & 0xff00) === 0xff00) return true;
  if (w0 === 0x0064 && w[1] === 0xff9b && w[2] === 1) return true;
  const mapped = w0 === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && (w[5] === 0 || w[5] === 0xffff);
  const nat64 = w0 === 0x0064 && w[1] === 0xff9b && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0;
  if ((mapped || nat64) && v4((w[6] ?? 0) >> 8, (w[6] ?? 0) & 0xff, (w[7] ?? 0) >> 8)) return true;
  if (w0 === 0x2002 && v4((w[1] ?? 0) >> 8, (w[1] ?? 0) & 0xff, (w[2] ?? 0) >> 8)) return true;
  return false;
}
