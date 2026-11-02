// The ticket that opens the live socket (ARCH 5.9). A browser cannot set a header on a WebSocket, and whatever goes in its address ends up in console errors and logs, so the session token stays in a
// header here and the address carries a ticket instead: one use, gone in seconds, and worthless once the socket is open.
type Fetch = typeof fetch;

export async function liveTicket(baseUrl: string, token: string, f: Fetch = (...a) => fetch(...a)): Promise<string> {
  const res = await f(`${baseUrl.replace(/\/+$/, "")}/sync/v1/ticket`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw new Error(`the Space gave no live ticket (${res.status})`);
  const ticket = ((await res.json()) as { data?: { ticket?: unknown } }).data?.ticket;
  if (typeof ticket !== "string" || ticket === "") throw new Error("the Space gave no live ticket");
  return ticket;
}
