// The extras identity, members and spaces expect on their ctx besides what the invoke pipeline builds (ruling 31/32): the host reads them from the access projection and the module tables, or hands the work to the
// module that owns it. Each is a plain object on the ctx of that module's capabilities; a module without the extra answers the way its handler says (empty directory, no invites wired).
//   identity.directory  roles (names) and groups of a person, from the access projection
//   identity.invites    peek and accept, run by the members module through its host calls (members.invite_peek, members.invite_accept), so identity never touches members tables
//   identity.losses     what a reset would lose: Mine vault items counted from the vault table (chat and memory counts follow when those modules count their private rows)
//   members.factors     second factors per person: TOTP when identity holds a secret for them
//   members.owned       NOT built yet: nothing is reported as owned, so the removal wizard offers no transfers (listed as a gap on P-L7_LIVE)
//   spaces.directory    the role name shown in the switcher
//   spaces.attention    NOT built yet: zero (the Home counts come from tasks and inbox)
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";

export interface PeopleDeps {
  access(): AccessSnapshot;
  db: { all(sql: string, ...args: unknown[]): unknown[] };
  /** run a module\'s host call as that module */
  call(name: string, input: unknown): Promise<unknown>;
}

const count = (db: PeopleDeps["db"], sql: string, ...args: unknown[]): number => {
  try { return Number((db.all(sql, ...args)[0] as { n?: number } | undefined)?.n ?? 0); } catch { return 0; }
};

export function createPeopleExtras(d: PeopleDeps): (module: string) => Record<string, unknown> | null {
  const directory = {
    of(personId: string) {
      const info = d.access().info(personId);
      return { roles: info && info.roleNames !== "no role" ? info.roleNames.split(", ") : [], groups: d.access().groupsOf(personId) };
    },
    roleName(personId: string) { return d.access().info(personId)?.roleNames.split(", ")[0] ?? "member"; },
  };
  const extras: Record<string, Record<string, unknown>> = {
    identity: {
      directory,
      invites: {
        peek: (code: string) => d.call("members.invite_peek", { code }),
        accept: (inviteId: string, personId: string) => d.call("members.invite_accept", { inviteId, personId }).then(() => undefined),
      },
      losses: { of: (personId: string) => ({ vault_mine: count(d.db, `SELECT count(*) AS n FROM vault_meta WHERE owner = ? AND scope = 'mine' AND deleted_at IS NULL`, personId), private_chats: 0, personal_memory: 0 }) },
    },
    members: {
      factors: { of: (personId: string) => (count(d.db, `SELECT count(*) AS n FROM identity_accounts WHERE person_id = ? AND totp_secret IS NOT NULL`, personId) > 0 ? ["totp"] : []) },
      owned: { of: () => ({}), holds: () => 0, apply: () => Promise.resolve(0) },
    },
    spaces: { directory, attention: { of: () => ({ needsYou: 0, unread: 0 }) } },
  };
  return (module) => extras[module] ?? null;
}
