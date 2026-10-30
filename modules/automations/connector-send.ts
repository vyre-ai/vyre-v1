// Send one stored connector action. The Vault fills the key through the host port. The host checks the address. The reply is scrubbed of the key before anyone reads it.
// Who may send a key to which host is decided here: a person's own act records the host, an agent or a poll needs the host to have been allowed before.
import { connectorCallHost } from "./connector-host.ts";
import type { CallerCtx } from "./connector-host.ts";
import type { ActionDef } from "./connector-def.ts";
import { buildRequest, readReply, scrubValues } from "./connector-request.ts";
import type { ConnectorRow } from "./connector-store.ts";
import { hostTrusted, trustHost } from "./connector-store.ts";
import { raise } from "./projections.ts";
import type { AutoCtx } from "./projections.ts";

export interface Sent {
  status: number;
  reply: unknown;
  retryAfter?: string;
  host: string;
}

const NEEDS_HOST = "automations.connector_trust_host";

function authorized(ctx: AutoCtx, itemId: string): boolean {
  return !ctx.authorize || ctx.authorize({ perm: null, level: "use" }, { type: "vault_item", id: itemId }).effect === "allow";
}

/**
 * Build the request, fill the key, send, and read the reply.
 * A key goes only to a host that a person has allowed for that Vault item. `person` is true when a person made the call themselves. Such a call allows the host when it names it in `allowHost`
 * (the person has seen where the key is going). Anyone else, an agent or a poll or a Run, needs the host to have been allowed before.
 */
export async function sendAction(ctx: AutoCtx, row: ConnectorRow, action: ActionDef, input: Record<string, unknown>, o: { person: boolean; allowHost?: string; extraQuery?: Record<string, string> }): Promise<Sent> {
  const host = connectorCallHost();
  if (!host) raise(ctx, "internal.unavailable", "Connector calls are not available on this server.");
  const def = row.def;
  const target = action.host ?? def.domains[0]!;
  const handle = row.vaultHandle;
  if (def.auth.type !== "none" && !handle) raise(ctx, "validation.precondition_failed", "This connector has no Vault item. Link the item that holds the key.", { reason: "no_vault_item" });
  const full = ctx as unknown as AutoCtx & CallerCtx;
  const used = new Set<string>();
  const caller: CallerCtx = {
    space: full.space, principal: full.principal, ...(full.actingFor ? { actingFor: full.actingFor } : {}), trace: full.trace as CallerCtx["trace"], depth: full.depth,
    call: (cap, i) => full.call!(cap, i),
    rememberVaultItem: (id) => { used.add(id); },
    assertAuthorized: () => {
      for (const id of used) if (!authorized(ctx, id)) raise(ctx, "permission.no_grant", "Vault access changed before this request was sent.");
      if (def.auth.type === "none" || !handle) return;
      // The allowance is kept under the item's handle, since that is the name a person sees and approves.
      if (hostTrusted(ctx.db, handle, target)) return;
      if (!(o.person && o.allowHost !== undefined && o.allowHost.toLowerCase() === target)) {
        raise(ctx, "validation.precondition_failed", `The key in ${handle} has not been allowed to go to ${target}. ${o.person ? "Say yes to sending it there with allowHost" : `Ask a person to allow it with ${NEEDS_HOST}`}.`, { reason: "host_not_trusted", host: target, handle, next: o.person ? "allowHost" : NEEDS_HOST });
      }
      trustHost(ctx.db, handle, target, ctx.actingFor ?? ctx.principal.id, ctx.now());
    },
  };
  let secret: string | undefined;
  let user: string | undefined;
  if (def.auth.type !== "none" && handle) {
    const slot = def.auth.field ?? "api_key";
    secret = await host.fill(caller, { connector: def.app, connectionId: `auto:${def.app}`, slot, handle: `${handle}.${slot}` });
    if (def.auth.type === "basic") {
      const userSlot = def.auth.userField ?? "username";
      user = await host.fill(caller, { connector: def.app, connectionId: `auto:${def.app}`, slot: userSlot, handle: `${handle}.${userSlot}` });
    }
  }
  const built = buildRequest(def, action, input, { ...(secret !== undefined ? { secret } : {}), ...(user !== undefined ? { user } : {}) }, o.extraQuery);
  if (!built.ok) raise(ctx, "validation.bad_input", built.reason, built.missing ? { missing: built.missing } : undefined);
  const req = built.request;
  let res: Awaited<ReturnType<ConnectorCallHostHttp>>;
  try {
    res = await host.http(caller, [req.host], req.url, { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}) });
  } catch (e) {
    // The host's own refusals carry their code. A key is never in them.
    const err = (e as { error?: { code?: string } } | null)?.error;
    if (err?.code) throw e;
    raise(ctx, "provider.network", "The app could not be reached.");
  }
  const text = scrubValues(await res.text(), [secret, user]);
  const reply = readReply(text, action);
  return { status: res.status, reply, ...(res.retryAfter !== undefined ? { retryAfter: res.retryAfter } : {}), host: req.host };
}
type ConnectorCallHostHttp = NonNullable<ReturnType<typeof connectorCallHost>>["http"];

/** The error a failed status stands for. A key is never in the message. */
export function failFor(ctx: AutoCtx, sent: Sent): never {
  const s = sent.status;
  if (s === 401 || s === 403) raise(ctx, "provider.auth_failed", `The app refused the key (${s}). Check the key in the Vault.`, { status: s });
  if (s === 429) raise(ctx, "provider.rate_limited", "The app is limiting requests (429).", { status: s, ...(sent.retryAfter ? { retryAfter: sent.retryAfter } : {}) });
  if (s >= 500) raise(ctx, "provider.unavailable", `The app answered ${s}.`, { status: s });
  raise(ctx, "validation.precondition_failed", `The app answered ${s}.`, { status: s });
}
