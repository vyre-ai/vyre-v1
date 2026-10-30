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

export interface DirectoryPerson { email: string; name?: string; suspended: boolean; userId?: string; source: "google" | "microsoft" }
export interface DirectoryPage { people: DirectoryPerson[]; /** the next page of each source, when it has one */ next: { google?: string; microsoft?: string } }

type RawPage = { people?: Omit<DirectoryPerson, "source">[]; nextPageToken?: string; nextSkipToken?: string };

/** Step 5: the people of the connected tenant, one page at a time (admin read). userId set means already in the Space. Pass the previous `next` to read the following page. */
export async function directory(call: CapCall, from?: DirectoryPage["next"], query?: string): Promise<Probe<DirectoryPage>> {
  const first = from === undefined;
  const g = !first && !from.google ? ({ kind: "ready", value: {} } as Probe<RawPage>) : await probe<RawPage>(call, "google.directory.list", { ...(from?.google ? { pageToken: from.google } : {}), ...(query ? { query } : {}) });
  const m = !first && !from.microsoft ? ({ kind: "ready", value: {} } as Probe<RawPage>) : await probe<RawPage>(call, "ms.directory.list", { ...(from?.microsoft ? { skipToken: from.microsoft } : {}), ...(query ? { query } : {}) });
  const take = (p: Probe<RawPage>, source: DirectoryPerson["source"]): DirectoryPerson[] => (p.kind === "ready" ? (p.value.people ?? []).map((x) => ({ ...x, source })) : []);
  if (g.kind === "ready" || m.kind === "ready") {
    return { kind: "ready", value: { people: [...take(g, "google"), ...take(m, "microsoft")], next: { ...(g.kind === "ready" && g.value.nextPageToken ? { google: g.value.nextPageToken } : {}), ...(m.kind === "ready" && m.value.nextSkipToken ? { microsoft: m.value.nextSkipToken } : {}) } } };
  }
  return g.kind === "failed" || m.kind === "failed" ? { kind: "failed" } : { kind: "not_yet" };
}

/** People who can be brought in: not suspended and not in the Space already. */
export const importable = (people: readonly DirectoryPerson[]): DirectoryPerson[] => people.filter((p) => !p.suspended && !p.userId);

export interface ImportResult { invited: { email: string; inviteId: string; link: string }[]; skipped: { email: string; reason: string }[] }
/** Makes one invite per ticked person, as the Member role. It sends nothing: the links are shown once and the owner shares or approves them. */
export async function importPeople(call: CapCall, people: readonly DirectoryPerson[], roleId: string, idempotencyKey: string): Promise<ImportResult> {
  const out: ImportResult = { invited: [], skipped: [] };
  for (const source of ["google", "microsoft"] as const) {
    const mine = people.filter((p) => p.source === source);
    if (mine.length === 0) continue;
    const cap = source === "google" ? "google.directory.import" : "ms.directory.import";
    const r = (await call(cap, { people: mine.map((p) => ({ email: p.email, role: roleId })), idempotencyKey: `${idempotencyKey}:${source}` })) as ImportResult;
    out.invited.push(...r.invited); out.skipped.push(...r.skipped);
  }
  return out;
}

/** The id of the Member role, so the import does not guess it. */
export async function memberRoleId(call: CapCall): Promise<string> {
  const roles = (await call("access.roles.list", {})) as { roles: { id: string; name: string }[] };
  const role = roles.roles.find((r) => r.name === "Member") ?? roles.roles[0];
  if (!role) throw new Error("This Space has no roles to invite into.");
  return role.id;
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

// ---- email the invites

export interface InviteDraft { to: string; name?: string; subject: string; text: string }

/** One email per invited person: their link, who invited them, and a line on what Vyre is. Nothing is sent by drafting. */
export function draftInvites(invited: readonly { email: string; link: string }[], names: ReadonlyMap<string, string>, by: string, space: string): InviteDraft[] {
  return invited.map((i) => {
    const name = names.get(i.email);
    return {
      to: i.email, ...(name ? { name } : {}), subject: `${by} invited you to ${space} on Vyre`,
      text: `${name ? `Hi ${name.split(" ")[0]},` : "Hi,"}\n\n${by} invited you to join ${space} on Vyre, a shared workspace where your team and its AI assistants work together.\n\nOpen this link to set up your account:\n${i.link}\n\nThe link works once and expires. If you were not expecting this, you can ignore it.\n`,
    };
  });
}

export interface MailSender { mailboxId: string; address: string }
/** The mailbox the owner sends from: their own, connected and working. Null when they have none, so the card can say so and keep the links. */
export async function ownMailbox(call: CapCall): Promise<MailSender | null> {
  const r = await probe<{ mailboxes: { id: string; kind: string; address: string; state: string }[] }>(call, "mail.mailbox.list", { scope: "mine" });
  if (r.kind !== "ready") return null;
  const box = r.value.mailboxes.find((b) => b.kind === "personal" && (b.state === "syncing" || b.state === "pending")) ?? r.value.mailboxes.find((b) => b.state === "syncing");
  return box ? { mailboxId: box.id, address: box.address } : null;
}

export interface SendOutcome { to: string; status: "queued" | "sent" | "held" | "suppressed" | "failed" }
/** One press sends every draft through the single send API, so the Space's send rule (caps, windows, suppression, the Gate) applies to each. A refusal on one does not stop the rest. */
export async function sendDrafts(call: CapCall, from: MailSender, drafts: readonly InviteDraft[], idempotencyKey: string): Promise<SendOutcome[]> {
  const out: SendOutcome[] = [];
  for (const d of drafts) {
    try {
      const r = (await call("mail.send", { mailboxId: from.mailboxId, to: [{ address: d.to, ...(d.name ? { name: d.name } : {}) }], subject: d.subject, text: d.text, idempotencyKey: `${idempotencyKey}:${d.to}` })) as { status: SendOutcome["status"] };
      out.push({ to: d.to, status: r.status });
    } catch { out.push({ to: d.to, status: "failed" }); }
  }
  return out;
}
