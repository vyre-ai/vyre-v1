// The person's public address. The directory still claims the label; this is the route the server workstream serves.

const NAME = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
/** Infrastructure hosts that are not people. `<name>.vyre.run` for one of these is not a person redirect. */
export const INFRA_HOSTS = Object.freeze(new Set(["names", "app", "api", "www", "relay", "acme", "mail", "docs", "status"]));

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/\.vyre\.run$/, "");
}

export function checkUsername(raw: unknown): string {
  const name = normalizeUsername(raw);
  if (!NAME.test(name) || INFRA_HOSTS.has(name)) {
    throw Object.assign(new Error("Choose a username of letters, digits and hyphens, three to 32 characters."), { code: "bad_input" });
  }
  return name;
}

export function personUrl(name: string): string {
  return `https://vyre.run/u/${checkUsername(name)}`;
}

/**
 * A 301 from the old `<name>.vyre.run` host to the person route. Infrastructure hosts stay where they are.
 */
export function legacyRedirect(host: unknown): { status: 301; location: string } | null {
  const h = String(host ?? "").toLowerCase().split(":")[0] ?? "";
  const m = /^([a-z0-9-]+)\.vyre\.run$/.exec(h);
  const label = m?.[1];
  if (!label || INFRA_HOSTS.has(label) || !NAME.test(label)) return null;
  return { status: 301, location: `https://vyre.run/u/${label}` };
}

/**
 * What a public lookup may say. Private unless the person opted in: then the name, id and address, never a key.
 */
export function publicCard(p: { name: string; id?: string | null; discoverable?: boolean; github?: { login?: string | null } | null }): { name: string; private: true } | { name: string; id: string | null; url: string; private: false; github: string | null } {
  const name = normalizeUsername(p.name);
  if (!p.discoverable) return { name, private: true as const };
  return { name, id: p.id || null, url: `https://vyre.run/u/${name}`, private: false as const, github: p.github && p.github.login ? p.github.login : null };
}
