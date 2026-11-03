// What the app hides by permission (l-perms, owner 3 Nov: "What you aren't allowed to do, you shouldn't be able to see"). Each control a role may lack names the catalogue key that lets a
// person use it (manifests/permissions.ts). identity.whoami says which keys the person's roles carry; a control whose key they lack is not drawn, or is drawn read-only with Ask an admin.
// Anything in the person's own scope (Mine automations, own agents, files, skills, connections, sites) needs only what every Member holds.

/** The permission behind each control the app hides. */
export const GATE = {
  /** + on the Space section of Automations, Promote to Space, and changing a Space automation (it opens read-only with Ask an admin) */
  spaceAutomations: "automations.space",
  newChat: "chats.private",
  newChannel: "channels.create",
  newAgent: "agents.create",
  /** New shared folder in the Vault */
  sharedVault: "vault.shared_create",
  /** Add and Remove on a site's domains */
  siteDomains: "sites.domains",
  /** Take over an agent's computer */
  takeOver: "computers.take_over",
  /** Set up an agent's computer: computers.provision takes Manage on the Space, which only owners and admins hold, the same people as access.manage */
  provisionComputer: "access.manage",
  /** Invite People in the Space menu */
  invite: "members.invite",
} as const;
export type Gate = keyof typeof GATE;

/** May the person do what this permission covers? True when nobody said (no list: a server that does not send one) and in a Personal Space, which is the person's own. */
export function allows(rt: { readonly permissions?: ReadonlySet<string> | undefined; readonly space: { readonly kind: string } } | null | undefined, perm: string): boolean {
  if (!rt?.permissions || rt.space.kind === "personal") return true;
  return rt.permissions.has(perm);
}

/** The controls a person with these permissions sees, in a Team Space. */
export function shownGates(permissions: readonly string[]): Gate[] {
  const rt = { permissions: new Set(permissions), space: { kind: "team" } };
  return (Object.keys(GATE) as Gate[]).filter((g) => allows(rt, GATE[g]));
}
