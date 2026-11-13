// How many networks a host's Docker has left (12 Nov). Docker hands each new network a block from its address pools; with the defaults (172.17.0.0/16 cut into /16s, 192.168.0.0/16 cut into /20s)
// that is 31 blocks, and the default bridge holds one. Each site has a network of its own; agent workspaces share one. A network made with a subnet of its own outside the pools takes no block.
// A Docker with its own default-address-pools has a different total, which this cannot see; the count then says "about".

export interface Pool {
  base: string;
  size: number;
}
export const DEFAULT_POOLS: readonly Pool[] = [
  { base: "172.17.0.0/16", size: 16 },
  { base: "172.18.0.0/15", size: 16 },
  { base: "172.20.0.0/14", size: 16 },
  { base: "172.24.0.0/13", size: 16 },
  { base: "192.168.0.0/16", size: 20 },
];

const ip = (s: string): number | null => {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((x) => x > 255) ? null : ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
};
const cidr = (s: string): { at: number; bits: number } | null => {
  const [a, b] = s.split("/");
  const at = ip(a ?? ""),
    bits = Number(b);
  return at === null || !Number.isInteger(bits) || bits < 0 || bits > 32 ? null : { at, bits };
};

/** The blocks of the pools the given subnets take, of how many. */
export function networkRoom(
  subnets: readonly string[],
  pools: readonly Pool[] = DEFAULT_POOLS,
): { used: number; total: number; left: number } {
  let total = 0;
  const taken = new Set<string>();
  for (const [i, pool] of pools.entries()) {
    const b = cidr(pool.base);
    if (!b || pool.size < b.bits) continue;
    const block = 2 ** (32 - pool.size),
      span = 2 ** (32 - b.bits);
    total += span / block;
    for (const s of subnets) {
      const c = cidr(s);
      if (!c) continue;
      const lo = c.at,
        hi = c.at + 2 ** (32 - c.bits) - 1;
      if (hi < b.at || lo > b.at + span - 1) continue;
      for (
        let k = Math.floor((Math.max(lo, b.at) - b.at) / block);
        k <= Math.floor((Math.min(hi, b.at + span - 1) - b.at) / block);
        k++
      )
        taken.add(`${i}:${k}`);
    }
  }
  return { used: taken.size, total, left: Math.max(0, total - taken.size) };
}

/** The /28s of the site range (10.213.0.0/16, modules/sites/handlers/site-subnets.ts) the subnets take: each site has one since 12 Nov. */
export function siteRoom(subnets: readonly string[]): { used: number; total: number; left: number } {
  return networkRoom(subnets, [{ base: "10.213.0.0/16", size: 28 }]);
}

/** Fewer than this many left: server health says so before a site is refused. */
export const FEW_NETWORKS_LEFT = 5;

export interface RoomFinding {
  key: string;
  state: "healthy" | "degraded";
  detail: string;
  next: string;
}

/** Server health's line for it (the Console's health facts and `vyre-server doctor` from inside the gateway). With `sites`, the room for sites in their own range too. */
export function networkRoomFinding(
  r: { used: number; total: number; left: number },
  ok: string,
  sites?: { used: number; total: number; left: number },
): RoomFinding {
  const detail = sites
    ? `Room for ${sites.left} more sites (of ${sites.total}). Docker on this server has about ${r.left} of ${r.total} other networks left; agent workspaces share one.`
    : `Docker on this server has about ${r.left} of ${r.total} networks left. Each site takes one; agent workspaces share one.`;
  return r.left >= FEW_NETWORKS_LEFT && (sites === undefined || sites.left >= FEW_NETWORKS_LEFT)
    ? { key: "host.docker_networks", state: "healthy", detail, next: ok }
    : {
        key: "host.docker_networks",
        state: "degraded",
        detail,
        next: "Remove sites you no longer use, or give Docker more address pools (default-address-pools in its daemon.json) and restart it.",
      };
}
