// The extras identity, members and spaces expect on their ctx besides what the invoke pipeline builds (ruling 31/32): the host reads them from the access projection and the module tables, or hands the work to the
// module that owns it. Each is a plain object on the ctx of that module's capabilities; a module without the extra answers the way its handler says (empty directory, no invites wired).
//   identity.membership whether the access projection has the person active; issueSession refuses a suspended, removed or unknown person, and answers unavailable while the snapshot is stale
//   identity.directory  roles (names) and groups of a person, from the access projection
//   identity.invites    peek and accept, run by the members module through its host calls (members.invite_peek, members.invite_accept), so identity never touches members tables
//   identity.github     GitHub sign-in and linking, only when VYRE_GH_OAUTH_CLIENT_ID and _SECRET are set
//   identity.session    the device of the call, for whoami
//   identity.keyring    clears the person's key from this node's memory at sign-out and password change (ruling 62); the key itself arrives from their client over loopback
//   identity.losses     what a reset would lose: Mine vault items counted from the vault table (chat and memory counts follow when those modules count their private rows)
//   members.factors     second factors per person: TOTP when identity holds a secret for them
//   members.owned      routines, agents, automations, Mine vault items, records, projects, files, channels, private chats, memory and mailbox connections, through those modules' host calls (P-L7_21)
//   spaces.directory    the role name shown in the switcher
//   spaces.attention    Needs you from tasks (tasks.attention) and unread from chat (chat.attention), asked as the person
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import type { Keyring } from "./keyring.ts";

export interface PeopleDeps {
  access(): AccessSnapshot;
  db: { all(sql: string, ...args: unknown[]): unknown[] };
  /** run a module's host call as that module */
  call(name: string, input: unknown, as?: { principal: { kind: "person" | "agent" | "service"; id: string } }): Promise<unknown>;
  /** GitHub sign-in; omitted: identity answers that it is not set up on this server */
  github?: GithubOAuth | null;
  /** true while the access snapshot cannot be vouched for and this person is not the owner (ruling 70): sessions are not opened */
  stale?(principalId: string): boolean;
  /** the person key this node holds (ruling 62, 63); identity clears it at sign-out */
  keyring?: Keyring;
}

const count = (db: PeopleDeps["db"], sql: string, ...args: unknown[]): number => {
  try { return Number((db.all(sql, ...args)[0] as { n?: number } | undefined)?.n ?? 0); } catch { return 0; }
};

/** The GitHub OAuth app of this server (VYRE_GH_OAUTH_CLIENT_ID and VYRE_GH_OAUTH_CLIENT_SECRET, set by the installer from the owner's vault); both or neither. */
export interface GithubOAuth { clientId: string; clientSecret: string; fetch?: typeof globalThis.fetch }
export function githubOAuthFromEnv(env: NodeJS.ProcessEnv): GithubOAuth | null {
  const clientId = env["VYRE_GH_OAUTH_CLIENT_ID"], clientSecret = env["VYRE_GH_OAUTH_CLIENT_SECRET"];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Trade a sign-in code for who it belongs to: the code goes to GitHub with the app's secret, the token that comes back is used once to read the user, then dropped. */
export function createGithub(o: GithubOAuth): { resolve(code: string): Promise<{ id: string; login: string }> } {
  const f = o.fetch ?? globalThis.fetch;
  return {
    async resolve(code) {
      const t = await f("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code }), redirect: "error",
      });
      const token = ((await t.json()) as { access_token?: unknown }).access_token;
      if (typeof token !== "string" || token === "") throw new Error("GitHub did not accept the code");
      const u = await f("https://api.github.com/user", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "vyre-server" }, redirect: "error" });
      const user = (await u.json()) as { id?: unknown; login?: unknown };
      if ((typeof user.id !== "number" && typeof user.id !== "string") || typeof user.login !== "string") throw new Error("GitHub did not say who this is");
      return { id: String(user.id), login: user.login };
    },
  };
}

export function createPeopleExtras(d: PeopleDeps): (module: string, ctx: { device?: string; principal?: { kind: string; id: string } }) => Record<string, unknown> | null {
  const directory = {
    of(personId: string) {
      const info = d.access().info(personId);
      return { roles: info && info.roleNames !== "no role" ? info.roleNames.split(", ") : [], groups: d.access().groupsOf(personId) };
    },
    roleName(personId: string) { return d.access().info(personId)?.roleNames.split(", ")[0] ?? "member"; },
  };
  // the removal wizard: each owning module answers for its own kinds through its host calls (<module>.owned_by, <module>.reassign_owned), run as the admin doing the removal; a module that is not live has
  // no host call and owns nothing here. HOOK for a module that joins (files, channels, private chats, memory): export `hostCalls` with "<module>.owned_by" answering { <kind>: { count, sample, ids } } and
  // "<module>.reassign_owned" taking { person, kind, action, to? } and answering how many it touched, then add the kind to OWNERS below.
  const OWNERS: Record<string, string> = {
    routines: "agents", agents: "agents", automations: "automations", vault_mine: "vault", records: "records", projects: "projects",
    files: "files", channels: "chat", private_chats: "chat", memory_from_you: "memory", mailbox_connections: "mail",
  };
  const ownedFor = (as: { principal: { kind: "person" | "agent" | "service"; id: string } } | undefined) => {
    const gather = async (personId: string) => {
      const out: Record<string, { count: number; sample: unknown[]; ids?: string[] }> = {};
      for (const module of new Set(Object.values(OWNERS))) {
        try { Object.assign(out, (await d.call(`${module}.owned_by`, { person: personId }, as)) as object); } catch { /* module not live */ }
      }
      return out;
    };
    return {
      async of(personId: string) {
        const all = await gather(personId);
        return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { count: v.count, sample: v.sample }]));
      },
      /** items the person owns that are on legal hold (governance answers; a hold on the person counts) */
      async holds(personId: string) {
        const ids = Object.values(await gather(personId)).flatMap((v) => v.ids ?? []);
        try { return Number(await d.call("governance.held_among", { person: personId, ids }, as)); } catch { return 0; }
      },
      async apply(personId: string, kind: string, action: string, to?: string) {
        const module = OWNERS[kind];
        if (!module) return 0;
        try { return Number(await d.call(`${module}.reassign_owned`, { person: personId, kind, action, ...(to ? { to } : {}) }, as)); } catch { return 0; }
      },
    };
  };
  const extras: Record<string, Record<string, unknown>> = {
    identity: {
      directory,
      // a person the access projection does not know as active gets no session, whatever proves who they are; the one exception is the call that creates the person (the account comes first, the principal event commits with the call)
      membership: {
        check: (personId: string, o?: { joining?: boolean }): "ok" | "refused" | "unavailable" => {
          if (d.stale?.(personId)) return "unavailable";
          const p = d.access().principal(personId);
          if (p === undefined) return o?.joining ? "ok" : "refused";   // only the call that creates the person may meet an unknown one
          return p.status === "active" ? "ok" : "refused";
        },
      },
      ...(d.github ? { github: createGithub(d.github) } : {}),
      ...(d.keyring ? { keyring: { clear: (personId: string) => d.keyring!.clear(personId) } } : {}),
      invites: {
        peek: (code: string) => d.call("members.invite_peek", { code }),
        accept: (inviteId: string, personId: string) => d.call("members.invite_accept", { inviteId, personId }).then(() => undefined),
      },
      losses: { of: (personId: string) => ({ vault_mine: count(d.db, `SELECT count(*) AS n FROM vault_meta WHERE owner = ? AND scope = 'mine' AND deleted_at IS NULL`, personId), private_chats: 0, personal_memory: 0 }) },
    },
    members: {
      factors: { of: (personId: string) => (count(d.db, `SELECT count(*) AS n FROM identity_accounts WHERE person_id = ? AND totp_secret IS NOT NULL`, personId) > 0 ? ["totp"] : []) },
      owned: ownedFor(undefined),
    },
    spaces: {
      directory,
      // the tile's counts come from the modules that own them, asked as the person: tasks (Ready requests waiting on them) and chat (unread messages in their chats); a module that is not live counts nothing
      attention: {
        async of(personId: string) {
          const as = { principal: { kind: "person" as const, id: personId } };
          const n = async (name: string): Promise<number> => { try { return Math.max(0, Math.trunc(Number(await d.call(name, {}, as)) || 0)); } catch { return 0; } };
          return { needsYou: await n("tasks.attention"), unread: await n("chat.attention") };
        },
      },
    },
  };
  return (module, ctx) => {
    const base = extras[module];
    if (!base) return null;
    // the device the call came from, for whoami (the session row itself is the devices module's)
    if (module === "members") return { ...base, owned: ownedFor(ctx.principal && ctx.principal.kind !== undefined ? { principal: { kind: ctx.principal.kind as "person" | "agent" | "service", id: ctx.principal.id } } : undefined) };
    return module === "identity" && ctx.device ? { ...base, session: { deviceId: ctx.device } } : base;
  };
}
