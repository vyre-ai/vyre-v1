// The person's own key, handed to the node that runs their turns (ruling 62, 63; owner ruling 3 Nov): after a password sign-in the client has unwrapped the person key and gives it to the daemon on
// this computer (POST /local/vault/key/unlock), or to the Space server it signed in to over https (POST /vault/key/unlock), so their own AI subscriptions and personal keys work for their own turns.
// The Space holds it in memory only, for as long as this session is signed in; sign-out takes it away (…/lock). It never goes over plain http to another machine.
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");
  } catch {
    return false;
  }
}

function base64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

type Fetch = typeof fetch;

/** Where this address takes the key: this computer's daemon, a Space server over https, or nowhere (plain http to another machine). */
export function keyDoor(baseUrl: string): string | null {
  const base = baseUrl.replace(/\/+$/, "");
  if (isLoopbackUrl(baseUrl)) return `${base}/local/vault/key`;
  try { return new URL(baseUrl).protocol === "https:" ? `${base}/vault/key` : null; } catch { return null; }
}

/** Gives the key to the daemon at `baseUrl` (this computer, or the Space server over https). Returns false, sending nothing, when the address is plain http to another machine. */
export async function holdKeyOnOwnNode(baseUrl: string, token: string, key: Uint8Array, f: Fetch = (...a) => fetch(...a)): Promise<boolean> {
  const door = keyDoor(baseUrl);
  if (door === null) return false;
  const res = await f(`${door}/unlock`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ key: base64(key) }),
  });
  return res.status === 204;
}

/** Takes the key away (sign-out). An address that never held one is skipped. */
export async function dropKeyOnOwnNode(baseUrl: string, token: string, f: Fetch = (...a) => fetch(...a)): Promise<void> {
  const door = keyDoor(baseUrl);
  if (door === null) return;
  await f(`${door}/lock`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

/** Whether the daemon on this computer holds the person's key right now. False for an address that is not this computer, and when the daemon does not answer. */
export async function keyHeldOnOwnNode(baseUrl: string, token: string, f: Fetch = (...a) => fetch(...a)): Promise<boolean> {
  const door = keyDoor(baseUrl);
  if (door === null) return false;
  try {
    const res = await f(`${door}/status`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) return false;
    return ((await res.json()) as { held?: unknown }).held === true;
  } catch { return false; }
}

/** held: this computer has the key. locked: the daemon answered and has none. unreachable: it did not answer (still starting): ask again, do not treat it as locked. */
export async function keyStatusOnOwnNode(baseUrl: string, token: string, f: Fetch = (...a) => fetch(...a)): Promise<"held" | "locked" | "unreachable"> {
  const door = keyDoor(baseUrl);
  if (door === null) return "unreachable";
  try {
    const res = await f(`${door}/status`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    if (res.status !== 200) return "unreachable";
    return ((await res.json()) as { held?: unknown }).held === true ? "held" : "locked";
  } catch { return "unreachable"; }
}
