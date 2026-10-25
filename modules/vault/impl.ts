// vault (lane L7a). The host serves the generated stubs while host/modules.json says `status: 'stub'`; the flip to live is P-L7_LIVE's (ruling 25). This packet carries items, sharing and folders; fill, use,
// export, import, generate, health, providers, policy and site rules come with the next vault packets and are served by their stubs until then.
// The host registers its half once at boot: setFiller (the vault service's own key) and setKeyPort (the signed-in owner's person key, for Mine items), see handlers/crypto.ts.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";

export { setFiller, setKeyPort, Filler } from "./handlers/index.ts";
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
};

export const projections = { inline: {}, consumers: {} };
