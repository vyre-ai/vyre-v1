// An app that issues its own OAuth client and a refresh token (Clio Manage, with a redirect fixed at 127.0.0.1) is connected by pasting three values into one Vault item: client_id, client_secret and refresh_token (r40, item 8).
// This module trades them for an access token, keeps the token in memory only until a minute before it ends, and writes a rotated refresh token back to the same Vault item before the new access token is used.
// DECISION: one refresh at a time per item (a second caller shares the first's answer), so a rotating refresh token is spent once. A rotated token that could not be saved is held in memory and saved first on the next grant,
// because the app has already retired the old one.
export const REFRESH_SKEW_MS = 60_000;
const DEFAULT_LIFETIME_S = 1800;
const MAX_TOKEN = 8192;

export type GrantFailure = "refused" | "unreachable" | "unavailable" | "bad_answer" | "not_saved";
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
}

interface Held {
  access: string;
  endsAt: number;
}
const held = new Map<string, Held>();
const running = new Map<string, Promise<string>>();
/** A refresh token the app issued that the Vault does not have yet. */
const unsaved = new Map<string, string>();

/** Drop the access token kept for an item: the app rejected it, so the next call asks for a new one. */
export const forgetAccess = (key: string): void => {
  held.delete(key);
};
export const resetGrants = (): void => {
  held.clear();
  running.clear();
  unsaved.clear();
};

async function saveTwice(port: GrantPort, token: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      await port.saveRefresh(token);
      return true;
    } catch {
      /* once more */
    }
  }
  return false;
}

async function exchange(key: string, tokenUrl: string, port: GrantPort): Promise<string> {
  // a token the app issued earlier that the Vault never got is the current one, and goes in first
  const pending = unsaved.get(key);
  if (pending && (await saveTwice(port, pending))) unsaved.delete(key);
  const refresh = unsaved.get(key) ?? (await port.fill("refresh_token"));
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: await port.fill("client_id"),
    client_secret: await port.fill("client_secret"),
  });
  let res: { status: number; text(): Promise<string> };
  try {
    res = await port.http(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
  } catch {
    throw new GrantError("unreachable", "The app could not be reached to renew its sign-in.");
  }
  const text = await res.text();
  if (res.status >= 500)
    throw new GrantError("unavailable", `The app answered ${res.status} when renewing its sign-in.`, res.status);
  if (res.status >= 400)
    throw new GrantError(
      "refused",
      "The app did not accept the refresh token. Check the client id, client secret and refresh token in the Vault item.",
      res.status,
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new GrantError("bad_answer", "The app answered the renewal in an unexpected way.");
  }
  const access = body["access_token"];
  if (typeof access !== "string" || access === "" || access.length > MAX_TOKEN)
    throw new GrantError("bad_answer", "The app did not return an access token.");
  const next = body["refresh_token"];
  if (typeof next === "string" && next !== "" && next !== refresh && next.length <= MAX_TOKEN) {
    unsaved.set(key, next);
    if (!(await saveTwice(port, next)))
      throw new GrantError(
        "not_saved",
        "The app renewed the sign-in and retired the old refresh token, but the new one could not be saved to the Vault item. It is kept for a retry; check that the item can be edited.",
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
