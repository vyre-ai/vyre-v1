// Own only (owner approved, 3 Nov 2026): where an action has a part in a person's own scope and a part for the whole Space, "Own only" means the own part is allowed and the Space part is
// not. The engine answers each permission yes or no, so Own only is stored as Allow on the own permission plus Not allowed on the Space one (an own part that needs no permission, such
// as a person's own Vault items or connections, is allowed for everyone and only the Space part is set). Used by the access module (exceptions) and the Console (matrix and Add sheet).

export interface OwnPair {
  /** The catalogue area the pair belongs to (manifests/permissions.ts). */
  area: string;
  /** The permission for the person's own scope, or null when their own scope needs none. */
  own: string | null;
  /** The permission for the Space-wide part. */
  space: string;
  /** What the pair is, in the matrix's words. */
  title: string;
  /** Own only for one person, after their name: "can build their own automations, not the Space's". */
  says: string;
}

export const OWN_PAIRS: readonly OwnPair[] = [
  { area: "automations", own: "automations.personal", space: "automations.space", title: "Automations: their own, or the Space's", says: "can build their own automations, not the Space's" },
  { area: "agents", own: "agents.create", space: "agents.manage", title: "Agents: their own, or any agent", says: "can make their own agents, not change anyone else's" },
  { area: "sites", own: "sites.deploy", space: "sites.promote", title: "Sites: their own to staging, or production for the Space", says: "can deploy their own sites to staging, not promote one to production" },
  { area: "vault", own: null, space: "vault.shared_create", title: "Vault: their own items, or shared folders", says: "can keep their own Vault items, not make shared folders" },
  { area: "space", own: null, space: "connectors.manage", title: "Connections: their own apps, or apps for the Space", says: "can connect their own apps, not apps for the whole Space" },
];

/** The pairs an area or a set of permissions touches (either part of a pair counts). */
export function pairsFor(sel: { area?: string | undefined; perms?: readonly string[] | undefined }): OwnPair[] {
  const keys = new Set(sel.perms ?? []);
  // a whole area takes its pairs, except the Console area, whose one pair (connections) is offered only on that action
  return OWN_PAIRS.filter((p) => (sel.area !== undefined && p.area === sel.area && p.area !== "space") || keys.has(p.space) || (p.own !== null && keys.has(p.own)));
}

/** Own only as permissions: the own keys to allow and the Space keys to refuse. */
export function ownOnly(pairs: readonly OwnPair[]): { allow: string[]; deny: string[] } {
  return { allow: [...new Set(pairs.flatMap((p) => (p.own ? [p.own] : [])))].sort(), deny: [...new Set(pairs.map((p) => p.space))].sort() };
}
