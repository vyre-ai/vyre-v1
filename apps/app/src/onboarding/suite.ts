// Team steps 3 to 6 call the suite's capabilities (names agreed with the suite builder). Nothing here builds a backend. A capability the Space does not have yet reads "not set up yet",
// never an error: the step stays on the rail and can be done later.
import type { CapCall } from "../shell/session/caps.ts";

export type Probe<T> = { kind: "ready"; value: T } | { kind: "not_yet" } | { kind: "failed" };

const missing = (e: unknown): boolean => {
  const c = (e as { code?: string; error?: { code?: string } }).code ?? (e as { error?: { code?: string } }).error?.code;
  return c === "validation.unknown_capability" || c === "internal.not_implemented" || c === "internal.unavailable";
};

/** Reads a capability that may not exist here yet. */
export async function probe<T>(call: CapCall, cap: string, input: Record<string, unknown> = {}): Promise<Probe<T>> {
  try { return { kind: "ready", value: (await call(cap, input)) as T }; } catch (e) { return missing(e) ? { kind: "not_yet" } : { kind: "failed" }; }
}

export interface Connection { name: "Google Workspace" | "Microsoft 365"; configured: boolean; ok: boolean; note: string }

/** Step 3: Google is done when configured and the last live test passed; Microsoft when configured and consent is given. Not set up reads calmly, with a hint. */
export async function connections(call: CapCall): Promise<{ google: Probe<Connection>; microsoft: Probe<Connection> }> {
  const g = await probe<{ configured: boolean; lastProbeOk: boolean | null }>(call, "google.dwd.status");
  const m = await probe<{ configured: boolean; consentGiven: boolean }>(call, "ms.consent.status");
  return {
    google: g.kind !== "ready" ? g : { kind: "ready", value: { name: "Google Workspace", configured: g.value.configured, ok: g.value.configured && g.value.lastProbeOk === true, note: !g.value.configured ? "Not set up. Open the setup in the Console." : g.value.lastProbeOk === true ? "Connected. The last test passed." : "Set up, but the last test has not passed yet." } },
    microsoft: m.kind !== "ready" ? m : { kind: "ready", value: { name: "Microsoft 365", configured: m.value.configured, ok: m.value.configured && m.value.consentGiven, note: !m.value.configured ? "Not set up. Open the setup in the Console." : m.value.consentGiven ? "Connected. Admin consent is given." : "Set up, waiting for admin consent." } },
  };
}

export const stepDoneBy = (c: { google: Probe<Connection>; microsoft: Probe<Connection> }): boolean => [c.google, c.microsoft].some((p) => p.kind === "ready" && p.value.ok);

/** Step 4 (sign-in for the domain): members.sso.list shows what is set today; the new names come from the suite when built. */
export async function ssoProviders(call: CapCall): Promise<Probe<{ provider: string }[]>> {
  const r = await probe<{ providers?: { provider: string }[]; sso?: { provider: string }[] }>(call, "members.sso.list");
  return r.kind === "ready" ? { kind: "ready", value: r.value.providers ?? r.value.sso ?? [] } : r;
}

/** Step 5: the directory of the connected tenant. Both reads are the suite's, to be confirmed. */
export async function directory(call: CapCall): Promise<Probe<{ people: number }>> {
  const g = await probe<{ people?: unknown[] }>(call, "google.directory.list");
  const m = await probe<{ people?: unknown[] }>(call, "ms.directory.list");
  const n = (p: Probe<{ people?: unknown[] }>): number => (p.kind === "ready" ? (p.value.people ?? []).length : 0);
  if (g.kind === "ready" || m.kind === "ready") return { kind: "ready", value: { people: n(g) + n(m) } };
  return g.kind === "failed" || m.kind === "failed" ? { kind: "failed" } : { kind: "not_yet" };
}

export interface InviteRow { id: string; email?: string; state: string }
/** Step 6: invites that exist now (members.invites.list). */
export async function invites(call: CapCall): Promise<Probe<InviteRow[]>> {
  const r = await probe<{ invites: InviteRow[] }>(call, "members.invites.list", {});
  return r.kind === "ready" ? { kind: "ready", value: r.value.invites } : r;
}

/** One invite link for a role by name (the Member role by default). Creating a link sends nothing; the owner shares it, or the suite's draft-and-approve send takes over when built. */
export async function createInviteLink(call: CapCall, roleName: string, email: string | undefined, idempotencyKey: string): Promise<string> {
  const roles = (await call("access.roles.list", {})) as { roles: { id: string; name: string }[] };
  const role = roles.roles.find((r) => r.name === roleName) ?? roles.roles[0];
  if (!role) throw new Error("This Space has no roles to invite into.");
  const out = (await call("members.invites.create", { role: role.id, ...(email ? { email } : {}), idempotencyKey })) as { link: string };
  return out.link;
}
