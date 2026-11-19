// What modules/connectors/refresh-grant.ts needs from the connector runtime for one connection: the three fields of its Vault item, the token address (checked against the connector's hosts), and the one write
// that puts a rotated refresh token back into the same item.
import { checkEgress, nowOf } from "../projections.ts";
import type { ConnectionDb, ConnectorDef, ConnectorsCtx, ConnectorsDeps } from "../projections.ts";
import { forgetItem, grantKey } from "../refresh-grant.ts";
import type { GrantPort } from "../refresh-grant.ts";

const FIELD_SLOT = {
  client_id: "clientIdSecret",
  client_secret: "clientSecret",
  refresh_token: "refreshSecret",
} as const;

/** The handle without its field: `#Clio_App.refresh_token` is the item `#Clio_App`. */
const itemHandle = (handle: string): string => handle.replace(/\.[A-Za-z0-9_]+$/, "");

export function grantPortFor(
  deps: ConnectorsDeps,
  ctx: ConnectorsCtx,
  def: ConnectorDef,
  conn: ConnectionDb,
): GrantPort {
  const secrets = JSON.parse(conn.secrets) as Record<string, string>;
  const slotOf = (field: keyof typeof FIELD_SLOT): string => def.auth[FIELD_SLOT[field]] ?? "";
  return {
    now: () => nowOf(deps),
    async fill(field) {
      const slot = slotOf(field);
      const handle = secrets[slot];
      if (!slot || !handle || !deps.resolveSecret)
        throw Object.assign(new Error(`The connection has no Vault item for ${field}.`), {
          error: { code: "validation.precondition_failed", message: `The connection has no Vault item for ${field}.` },
        });
      const value = await deps.resolveSecret(handle, { connector: def.key, connectionId: conn.connection_id, slot });
      if (value === undefined) throw new Error(`The Vault item for ${field} has no value.`);
      return value;
    },
    async http(url, init) {
      const eg = checkEgress(url, def.domains);
      if (!eg.ok) throw new Error(`Egress refused: ${eg.reason}.`);
      return ctx.http(eg.url.toString(), init);
    },
    async saveRefresh(token) {
      const handle = secrets[slotOf("refresh_token")];
      if (!handle) throw new Error("no Vault item to save to");
      const base = itemHandle(handle);
      const listed = (await ctx.call("vault.items.list", { q: base.replace(/^#/, "") })) as {
        items: { id: string; handle: string }[];
      };
      const item = listed.items.find((i) => i.handle === base);
      if (!item) throw new Error("the Vault item was not found");
      // the connection's own housekeeping: it asks for the use the connection holds, not for edit, so a member who may only use the item can still run a pass without losing the connection
      await ctx.call("vault.item.rotate_field", { itemId: item.id, key: "refresh_token", value: token });
    },
  };
}

/** The key a connection's grant is kept under: its Vault item, in this Space. */
export function grantKeyOf(deps: ConnectorsDeps, def: ConnectorDef, conn: ConnectionDb): string {
  const secrets = JSON.parse(conn.secrets) as Record<string, string>;
  return grantKey(deps.tx as object, secrets[def.auth.refreshSecret ?? ""] ?? conn.connection_id);
}

/** A connection of an app that issues its own OAuth client was deleted, or its Vault item was changed: what is kept for that item (the access token, a refresh token waiting to be saved) goes with it. */
export function forgetGrantOf(
  deps: ConnectorsDeps,
  conn: ConnectionDb,
  secretsOverride?: Record<string, string>,
): void {
  const row = deps.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = ?", conn.connector);
  if (!row) return;
  const def = JSON.parse(row.def) as ConnectorDef;
  if (def.auth.type !== "oauth_refresh") return;
  const secrets = secretsOverride ?? (JSON.parse(conn.secrets) as Record<string, string>);
  const handle = secrets[def.auth.refreshSecret ?? ""];
  if (handle) forgetItem(grantKey(deps.tx as object, handle));
}
