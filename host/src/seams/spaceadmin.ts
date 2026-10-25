// The spaces module's host drivers (rulings 31 and 32): what space administration needs and a module cannot know (modules/spaces/handlers/extra/core.ts, SpaceAdminDrivers).
//   owner, fingerprint, isMember   read from the access projection and the identity tables
//   transferOwner                  the new Owner and the old one an Admin, through the access module as the host
//   applyAddress                   NOT applied to Caddy or the relay here: the address is recorded on the profile (the invite link reads it) and the network module reconciles routes from it
//   deleteSpace                    refused: a Space is removed on its server with the command line, never over HTTP
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { fail } from "../routes/errors.ts";

export interface SpaceAdminDeps {
  access(): AccessSnapshot;
  owner(): string;
  space: string;
  db: { all(sql: string, ...args: unknown[]): unknown[] };
  /** run a capability as the host */
  system(cap: string, input: unknown): Promise<unknown>;
  headSeq(): number;
}

export function createSpaceAdmin(d: SpaceAdminDeps) {
  const none = "0".repeat(32);
  return {
    owner: async () => d.owner(),
    async fingerprint() {
      try {
        const r = d.db.all("SELECT fingerprint FROM identity_space WHERE id = ?", d.space)[0] as { fingerprint?: string } | undefined;
        if (r?.fingerprint) return r.fingerprint;
      } catch { /* identity has no Space row yet */ }
      return "0000 0000 0000 0000";
    },
    isMember: async (personId: string) => d.access().principal(personId)?.status === "active",
    async transferOwner(from: string, to: string) {
      await d.system("access.roles.assign", { subject: { kind: "person", id: to }, roleId: "owner" });
      await d.system("access.roles.assign", { subject: { kind: "person", id: from }, roleId: "admin" });
      await d.system("access.roles.unassign", { subject: { kind: "person", id: from }, roleId: "owner" });
      return { epoch: d.headSeq() };
    },
    async applyAddress(_mode: "relay" | "own_domain", _host: string | null) { /* recorded on the profile by the module; routes follow from it */ },
    async deleteSpace(): Promise<void> {
      throw fail("internal.unavailable", none, { message: "A Space is deleted on its server with the command line, not from the app." });
    },
  };
}
