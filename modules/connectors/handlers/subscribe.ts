// Telling an app where to call. The subscribe call needs the connection to exist for the caller, which is not so inside the invocation that creates it, so a call that fails there is kept
// (cn_sync_hooks.pending) and made at the start of the next sync pass.
import type { ConnectionDb, ConnectorsCtx, ConnectorsDeps } from "../projections.ts";

export interface Pending { url: string; actions: string[] }

/** Make the subscribe calls a connector still owes its app. Never throws: what fails stays pending. */
export async function retrySubscriptions(deps: ConnectorsDeps, ctx: ConnectorsCtx): Promise<void> {
  // telling the app is a write to it: a pass run by an agent or the host would only leave an approval task each time, so the first pass a person runs (Sync now, a Resync) makes the call
  if (!/^usr_/.test(String(ctx.actor ?? ""))) return;
  const tx = deps.tx;
  let hooks: { token: string; connector: string; pending: string | null }[];
  try { hooks = tx.all<{ token: string; connector: string; pending: string | null }>("SELECT token, connector, pending FROM cn_sync_hooks WHERE pending IS NOT NULL"); } catch { return; }
  for (const h of hooks) {
    const pending = JSON.parse(h.pending!) as Pending;
    const conn = tx.get<ConnectionDb>("SELECT * FROM cn_connections WHERE connector = ? ORDER BY created_at LIMIT 1", h.connector);
    if (!conn) continue;
    const left: string[] = [];
    for (const action of pending.actions) {
      try { await ctx.call("connectors.run", { key: h.connector, action, connectionId: conn.connection_id, input: { url: pending.url }, idempotencyKey: `subscribe:${h.token}:${action}` }); } catch { left.push(action); }
    }
    tx.run("UPDATE cn_sync_hooks SET pending = ? WHERE token = ?", left.length ? JSON.stringify({ url: pending.url, actions: left }) : null, h.token);
  }
}
