// The addresses of site networks (12 Nov): each site's network has one /28 of 10.213.0.0/16, named in its create, so sites do not use Docker's default address pools, which hold about 31 networks
// for the whole host. host/src/sites-runner/policy.ts (SITE_RANGE, siteSubnetOk) accepts exactly these and nothing else.

export const SITE_RANGE = "10.213.0.0/16";
export const SITE_BLOCKS = 4096; // /28s in a /16

const ipOf = (s: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((x) => x > 255) ? null : ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
};
const BASE = ipOf("10.213.0.0") as number;

/** The /28 blocks of the site range that these subnets take (any overlap takes a block). */
export function takenBlocks(subnets: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const s of subnets) {
    const [a, b] = s.split("/");
    const at = ipOf(a ?? ""),
      bits = Number(b);
    if (at === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const lo = at,
      hi = at + 2 ** (32 - bits) - 1;
    const first = Math.max(lo, BASE),
      last = Math.min(hi, BASE + SITE_BLOCKS * 16 - 1);
    for (let k = Math.floor((first - BASE) / 16); first <= last && k <= Math.floor((last - BASE) / 16); k++) out.add(k);
  }
  return out;
}

/** The subnet of block k. */
export const blockSubnet = (k: number): string => {
  const n = BASE + k * 16;
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}/28`;
};

/** Is this subnet one of the site range's /28s? */
export const inSiteRange = (s: string | null | undefined): boolean =>
  typeof s === "string" && /^10\.213\.\d{1,3}\.\d{1,3}\/28$/.test(s) && takenBlocks([s]).size === 1;

/** The first free /28 of the site range, past the ones also to skip; null when the range is used up. */
export function freeSiteSubnet(subnets: readonly string[], skip: ReadonlySet<number> = new Set()): string | null {
  const taken = takenBlocks(subnets);
  for (let k = 0; k < SITE_BLOCKS; k++) if (!taken.has(k) && !skip.has(k)) return blockSubnet(k);
  return null;
}
