// vault (lane L7a): items, sharing, folders, use by name, fill, env injection and .env exports. Import, generate, health, providers, policy, site rules and the rest of folders are deferred (ruling 60, docs/deferred.md): their handlers refuse.
// The host registers its half once at boot: setFiller (the vault service's own key) and setKeyPort (the signed-in owner's person key, for Mine items), see handlers/crypto.ts.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import * as u from "./handlers/use.ts";
import { Filler, setFiller } from "./handlers/crypto.ts";
import { deferredHandlers } from "../../host/src/routes/deferred.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";

export { setFiller, setKeyPort, Filler } from "./handlers/index.ts";
export { configureVault, secretPort, scrub, leaks, forms, exportPull } from "./handlers/use.ts";
export type { VaultHost, FillSink } from "./handlers/use.ts";

/** Capabilities whose packet is deferred (ruling 60, docs/deferred.md). */
export const DEFERRED = ["providers.add", "providers.catalog", "providers.list", "providers.remove", "providers.set_space_use", "providers.subscription_complete", "providers.subscription_start", "providers.test", "vault.folders.delete", "vault.folders.update", "vault.generate", "vault.health", "vault.import", "vault.import_parse", "vault.items.export_mine", "vault.items.match", "vault.policy.get", "vault.policy.set", "vault.site_rules.list", "vault.site_rules.set"] as const;
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
  ...deferredHandlers(DEFERRED),
};

export const projections = { inline: {}, consumers: {} };

/** What the host gives the module at boot (ruling 31/32): the filler's key (32 bytes, kept in the data directory) and the places a value may be filled into. */
export const hostSeams: SeamSetters = {
  setVaultFillerKey: (key: Uint8Array | null) => setFiller(key ? new Filler(key) : null),
  configureVault: u.configureVault,
};
