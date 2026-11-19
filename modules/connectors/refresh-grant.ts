// An app that issues its own OAuth client and a refresh token (Clio Manage, with a redirect fixed at 127.0.0.1) is connected by pasting three values into one Vault item: client_id, client_secret and refresh_token (r40, item 8).
// This module trades them for an access token, keeps the token in memory only until a minute before it ends, and writes a rotated refresh token back to the same Vault item before the new access token is used.
// DECISION: one refresh at a time per item (a second caller shares the first's answer), so a rotating refresh token is spent once. A rotated token that could not be saved is held in memory and saved first on the next grant,
// because the app has already retired the old one.
export const REFRESH_SKEW_MS = 60_000;
const DEFAULT_LIFETIME_S = 1800;
const MAX_TOKEN = 8192;

export type GrantFailure = "refused" | "unreachable" | "unavailable" | "busy" | "bad_answer" | "not_saved";
export class GrantError extends Error {
  kind: GrantFailure;
  status: number | undefined;
  constructor(kind: GrantFailure, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface GrantPort {
  now(): number;
  /** One field of the Vault item, read at the last moment. */
  fill(field: "client_id" | "client_secret" | "refresh_token"): Promise<string>;
  http(
    url: string,
    init: { method: "POST"; headers: Record<string, string>; body: string },
  ): Promise<{ status: number; text(): Promise<string> }>;
  /** Write the new refresh token into the same Vault item, in one update. */
  saveRefresh(token: string): Promise<void>;
  /** Wait between tries; tests pass a no-op. */
  sleep?(ms: number): Promise<void>;
}

interface Held {
  access: string;
  endsAt: number;
}
// All three are keyed by the Vault item (its handle without the field, in the Space), not by connection: two connections on one item, a probe and a sync, share one refresh.
const held = new Map<string, Held>();
const running = new Map<string, Promise<string>>();
/** A refresh token the app issued that the Vault does not have yet, and the one it replaces: it is saved first on the next grant, and only while the Vault still holds the one it replaces. */
const unsaved = new Map<string, { from: string; to: string }>();

/** The key of an item for the three tables: the Space (any object that is one per Space's store) and the handle without its field. */
const spaces = new WeakMap<object, number>();
export function grantKey(space: object, handle: string): string {
  let n = spaces.get(space);
  if (n === undefined) {
    n = spaces.size + 1;
    spaces.set(space, n);
  }
  return `${n}:${handle.replace(/\.[A-Za-z0-9_]+$/, "")}`;
}

/** Drop the access token kept for an item: the app rejected it, so the next call asks for a new one. */
export const forgetAccess = (key: string): void => {
  held.delete(key);
};
/** A connection was deleted or its credentials were pasted again, or the Vault revoked something: no access token kept for the item is used after it. A refresh token that was waiting to be saved is never dropped here (see settle). */
export const forgetItem = (key: string): void => {
  held.delete(key);
};
/** Every access token kept, for a Vault revoke or a change of who may use what that does not say which item. */
export const forgetAllHeld = (): void => held.clear();
/**
 * Before anything kept for an item is let go: a refresh token the app issued that the Vault does not have yet is saved, if the Vault still holds the one it replaced. If someone pasted another token meanwhile the waiting
 * one is stale and goes. If it cannot be saved now it stays, and is saved first on the next grant.
 */
export async function settle(key: string, port: GrantPort): Promise<void> {
  const waiting = unsaved.get(key);
  if (!waiting) return;
  let current: string;
  try {
    current = await port.fill("refresh_token");
  } catch {
    return;
  }
  if (current !== waiting.from) {
    unsaved.delete(key);
    return;
  }
  if (await saveTries(port, waiting.to)) unsaved.delete(key);
}
export const resetGrants = (): void => {
  held.clear();
  running.clear();
  unsaved.clear();
};

const nap = (port: GrantPort, ms: number): Promise<void> =>
  port.sleep ? port.sleep(ms) : new Promise((r) => setTimeout(r, ms));

async function saveTries(port: GrantPort, token: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      await port.saveRefresh(token);
      return true;
    } catch {
      await nap(port, 200 * 2 ** i);
    }
  }
  return false;
}

const TRANSIENT = (status: number): boolean => status === 408 || status === 429 || status >= 500;

/** One trade at the token address. A transient answer (408, 429, 5xx, the network) is tried again with a pause, three times; only 400 and 401 say the refresh token is refused. */
async function trade(
  tokenUrl: string,
  port: GrantPort,
  form: string,
): Promise<{ status: number; text: string } | GrantError> {
  let last: GrantError | undefined;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await nap(port, 250 * 4 ** (i - 1));
    try {
      const res = await port.http(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: form,
      });
      if (TRANSIENT(res.status)) {
        last = new GrantError(
          res.status >= 500 || res.status === 408 ? "unavailable" : "busy",
          `The app answered ${res.status} when renewing its sign-in.`,
          res.status,
        );
        continue;
      }
      return { status: res.status, text: await res.text() };
    } catch {
      last = new GrantError("unreachable", "The app could not be reached to renew its sign-in.");
    }
  }
  return last ?? new GrantError("unreachable", "The app could not be reached to renew its sign-in.");
}

async function exchange(key: string, tokenUrl: string, port: GrantPort): Promise<string> {
  const current = await port.fill("refresh_token");
  let refresh = current;
  const waiting = unsaved.get(key);
  if (waiting && waiting.from === current) {
    // the app already retired the token the Vault still holds: the one it issued instead goes in first, and is the one to trade
    if (!(await saveTries(port, waiting.to)))
      throw new GrantError(
        "not_saved",
        "The app renewed the sign-in and retired the old refresh token, but the new one could not be saved to the Vault item yet. It is kept and saved first on the next try.",
      );
    unsaved.delete(key);
    refresh = waiting.to;
  } else if (waiting) {
    // the Vault holds something else now (someone pasted a new token): what was waiting is stale
    unsaved.delete(key);
  }
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: await port.fill("client_id"),
    client_secret: await port.fill("client_secret"),
  }).toString();
  const got = await trade(tokenUrl, port, form);
  if (got instanceof GrantError) throw got;
  if (got.status === 400 || got.status === 401)
    throw new GrantError(
      "refused",
      "The app did not accept the refresh token. Check the client id, client secret and refresh token in the Vault item.",
      got.status,
    );
  if (got.status >= 400)
    throw new GrantError("bad_answer", `The app answered ${got.status} when renewing its sign-in.`, got.status);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(got.text) as Record<string, unknown>;
  } catch {
    throw new GrantError("bad_answer", "The app answered the renewal in an unexpected way.");
  }
  const access = body["access_token"];
  if (typeof access !== "string" || access === "" || access.length > MAX_TOKEN)
    throw new GrantError("bad_answer", "The app did not return an access token.");
  const next = body["refresh_token"];
  // the new refresh token is accepted and saved in this one step, before the access token that came with it is used or kept: if it cannot be saved, the access token is not used
  if (typeof next === "string" && next !== "" && next !== refresh && next.length <= MAX_TOKEN) {
    unsaved.set(key, { from: refresh, to: next });
    if (!(await saveTries(port, next)))
      throw new GrantError(
        "not_saved",
        "The app renewed the sign-in and retired the old refresh token, but the new one could not be saved to the Vault item. It is kept and saved first on the next try; check that the item can still be used.",
      );
    unsaved.delete(key);
  }
  const lifetime =
    typeof body["expires_in"] === "number" && body["expires_in"] > 0 ? body["expires_in"] : DEFAULT_LIFETIME_S;
  held.set(key, { access, endsAt: port.now() + lifetime * 1000 });
  return access;
}

/** The access token for an item: the one kept while it has more than a minute left, else a fresh one. `force` skips the kept one (the app rejected it). */
export async function accessToken(key: string, tokenUrl: string, port: GrantPort, force = false): Promise<string> {
  const have = held.get(key);
  if (!force && have && have.endsAt - port.now() > REFRESH_SKEW_MS) return have.access;
  const going = running.get(key);
  if (going) return going;
  const job = exchange(key, tokenUrl, port).finally(() => {
    running.delete(key);
  });
  running.set(key, job);
  return job;
}
