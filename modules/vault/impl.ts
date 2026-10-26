// vault (lane L7a): items, sharing, folders, use by name, fill, env injection and .env exports. AI providers (list, add, remove, test, sign-in) are real. Import, generate, health, policy, site rules and the rest of folders are deferred (ruling 60, docs/deferred.md): their handlers refuse.
// The host registers its half once at boot: setFiller (the vault service's own key) and setKeyPort (the signed-in owner's person key, for Mine items), see handlers/crypto.ts.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import * as u from "./handlers/use.ts";
import * as pr from "./handlers/providers.ts";
import { Filler, setFiller, setKeyPort } from "./handlers/crypto.ts";
import type { KeyPort } from "./handlers/crypto.ts";
import { deferredHandlers } from "../../host/src/routes/deferred.ts";
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { setFiller, setKeyPort, Filler } from "./handlers/index.ts";
export { CATALOG } from "./handlers/providers.ts";
export type { ProviderProbe } from "./handlers/providers.ts";
export { configureVault, secretPort, scrub, leaks, forms, exportPull } from "./handlers/use.ts";
export type { VaultHost, FillSink } from "./handlers/use.ts";

/** Capabilities whose packet is deferred (ruling 60, docs/deferred.md). */
export const DEFERRED = ["vault.folders.delete", "vault.folders.update", "vault.generate", "vault.health", "vault.import", "vault.import_parse", "vault.items.export_mine", "vault.items.match", "vault.policy.get", "vault.policy.set", "vault.site_rules.list", "vault.site_rules.set"] as const;
export type { KeyPort } from "./handlers/index.ts";

export const handlers: Record<string, Handler> = {
  "vault.items.list": (ctx, i) => h.itemsList(ctx, i),
  "vault.item.get": (ctx, i) => h.itemGet(ctx, i),
  "vault.item.reveal": (ctx, i) => h.itemReveal(ctx, i),
  "vault.item.history": (ctx, i) => h.itemHistory(ctx, i),
  "vault.item.put": (ctx, i) => h.itemPut(ctx, i),
  "vault.item.update": (ctx, i) => h.itemUpdate(ctx, i),
  "vault.item.move": (ctx, i) => h.itemMove(ctx, i),
  "vault.item.mark_rotated": (ctx, i) => h.itemMarkRotated(ctx, i),
  "vault.item.delete": (ctx, i) => h.itemDelete(ctx, i),
  "vault.item.restore": (ctx, i) => h.itemRestore(ctx, i),
  "vault.share": (ctx, i) => h.share(ctx, i),
  "vault.unshare": (ctx, i) => h.unshare(ctx, i),
  "vault.folders.list": (ctx, i) => h.foldersList(ctx, i),
  "vault.folders.create": (ctx, i) => h.foldersCreate(ctx, i),
  "vault.service_health": (ctx) => h.serviceHealth(ctx),
  "vault.use": (ctx, i) => u.use(ctx, i),
  "vault.fill": (ctx, i) => u.fill(ctx, i),
  "vault.inject_env": (ctx, i) => u.injectEnv(ctx, i),
  "vault.export_env": (ctx, i) => u.exportEnv(ctx, i),
  "vault.exports.list": (ctx, i) => u.exportsList(ctx, i),
  "vault.exports.revoke": (ctx, i) => u.exportsRevoke(ctx, i),
  "vault.report_scrub_miss": (ctx, i) => u.reportScrubMiss(ctx, i),
  "providers.catalog": (ctx, i) => pr.catalog(ctx, i),
  "providers.list": (ctx, i) => pr.list(ctx, i),
  "providers.add": (ctx, i) => pr.add(ctx, i),
  "providers.remove": (ctx, i) => pr.remove(ctx, i),
  "providers.set_space_use": (ctx, i) => pr.setSpaceUse(ctx, i),
  "providers.subscription_start": (ctx, i) => pr.subscriptionStart(ctx, i),
  "providers.subscription_complete": (ctx, i) => pr.subscriptionComplete(ctx, i),
  "providers.test": (ctx, i) => pr.test(ctx, i),
  ...deferredHandlers(DEFERRED),
};

export const projections = { inline: {}, consumers: {} };

/** What the host gives the module at boot (ruling 31/32): the filler's key (32 bytes, kept in the data directory) and the places a value may be filled into. */
export const hostSeams: SeamSetters = {
  setVaultKeyPort: (port: KeyPort | null) => setKeyPort(port),
  setVaultFillerKey: (key: Uint8Array | null) => setFiller(key ? new Filler(key) : null),
  configureVault: u.configureVault,
};

/**
 * Host calls for the removal wizard (members.owned, host/src/seams/people.ts): what a person owns here and what happens to it. The host runs them with this module's ctx, so no other module reads these tables.
 * `owned_by` answers { <kind>: { count, sample } }; `reassign_owned` applies one wizard action to one kind and answers how many things it touched.
 */
type Row = Record<string, unknown>;
const rows = (ctx: Ctx, sql: string, ...a: unknown[]): Row[] => { try { return ctx.db.all(sql, ...a) as Row[]; } catch { return []; } };
const kept = (r: Row[], type: string, title: string) => ({ count: r.length, sample: r.slice(0, 5).map((x) => ({ type, id: String(x["id"]), title: String(x[title] ?? x["id"]) })), ids: r.slice(0, 500).map((x) => String(x["id"])) });
export const hostCalls = {
  "vault.owned_by": (ctx: Ctx, i: { person: string }) => ({
    vault_mine: kept(rows(ctx, `SELECT "id", "name" FROM vault_meta WHERE "owner" = ? AND "scope" = 'mine' AND "deleted_at" IS NULL`, i.person), "vault_item", "name"),
  }),
  /** Mine items are exportable by their owner for 30 days after removal and stay sealed under the owner's own key meanwhile (export keeps them); delete puts them in the trash. */
  "vault.reassign_owned": (ctx: Ctx, i: { person: string; kind: string; action: string }): number => {
    if (i.kind !== "vault_mine" || i.action !== "delete") return 0;
    try { return ctx.db.run(`UPDATE vault_meta SET "deleted_at" = ?, "updated_at" = ? WHERE "owner" = ? AND "scope" = 'mine' AND "deleted_at" IS NULL`, ctx.now(), ctx.now(), i.person).changes; } catch { return 0; }
  },
};
