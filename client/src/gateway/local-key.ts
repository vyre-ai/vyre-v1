// The person's own key, handed to their own node (ruling 62, 63): after a password sign-in the client has unwrapped the person key and gives it to the daemon on this computer
// (POST /local/vault/key/unlock) so their own AI subscriptions and personal keys work for their turns; sign-out takes it away (POST /local/vault/key/lock). The key goes to a loopback
// address and nowhere else: a Space on another machine never receives it, and the daemon itself refuses a non-loopback socket, Host or proxy header.
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

/** Gives the key to the daemon at `baseUrl`. Returns false, sending nothing, when that address is not this computer. */
export async function holdKeyOnOwnNode(baseUrl: string, token: string, key: Uint8Array, f: Fetch = (...a) => fetch(...a)): Promise<boolean> {
  if (!isLoopbackUrl(baseUrl)) return false;
  const res = await f(`${baseUrl.replace(/\/+$/, "")}/local/vault/key/unlock`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ key: base64(key) }),
  });
  return res.status === 204;
}

/** Takes the key away (sign-out). A non-loopback address is skipped: it never held one. */
export async function dropKeyOnOwnNode(baseUrl: string, token: string, f: Fetch = (...a) => fetch(...a)): Promise<void> {
  if (!isLoopbackUrl(baseUrl)) return;
  await f(`${baseUrl.replace(/\/+$/, "")}/local/vault/key/lock`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}
