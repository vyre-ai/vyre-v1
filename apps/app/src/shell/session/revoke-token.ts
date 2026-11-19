// Signing out revokes the sign-in on the Space. The shell's own call needs the opened session; a person who presses Sign Out in the first moments of a page (the shell is drawn before the session has
// opened: the shell's code is warmed ahead) has none yet, and the old call was then skipped, leaving the token alive on the server. This sends the same call straight with the stored token, and keeps going if the page
// is left (keepalive) so a reload right after Sign Out does not cut it off.
export async function revokeToken(
  s: { baseUrl: string; token: string },
  send: typeof fetch | undefined = (globalThis as { fetch?: typeof fetch }).fetch?.bind(globalThis),
): Promise<void> {
  if (!send) return;
  try {
    await send(`${s.baseUrl.replace(/\/+$/, "")}/v1/identity/sign_out`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
      body: "{}",
      keepalive: true,
    });
  } catch {
    /* the Space cannot be reached: the sign-in is gone from this device either way */
  }
}
