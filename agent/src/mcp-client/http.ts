// The Streamable HTTP transport (MCP 2025-06-18): every message is a POST to one URL. The server answers with JSON or with a text/event-stream whose events carry the replies. A session id the
// server sends is sent back on later requests. The fetch is the caller's, so a remote URL goes through the network guard and a header may carry a Vault value filled at the last moment.
import type { McpTransport } from "./client.ts";
import { PROTOCOL_VERSION } from "./client.ts";

/** What a request needs from a fetch: the global fetch has this shape, and so has the network guard's (lib/net-guard.ts), which connects only to an address it checked. */
export interface FetchPort {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }): Promise<{
    ok: boolean; status: number; headers: { get(name: string): string | null }; body: AsyncIterable<Uint8Array> | null; text(): Promise<string>;
  }>;
}

export interface HttpOptions {
  url: string;
  fetch: FetchPort;
  /** Headers for every request (Authorization from a Vault handle). Called per request so a rotated key is picked up. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
}

/** Events of a text/event-stream body: the data of each, joined. */
async function* events(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data !== "") yield data;
    }
  }
}

export function httpTransport(o: HttpOptions): McpTransport {
  let onMessage: (m: unknown) => void = () => undefined;
  let onClose: (why: string) => void = () => undefined;
  let session: string | undefined;
  const protocol = PROTOCOL_VERSION;
  let closed = false;
  const live = new AbortController();
  const deliver = (text: string): void => {
    let j: unknown;
    try { j = JSON.parse(text); } catch { return; }
    for (const m of Array.isArray(j) ? j : [j]) onMessage(m);
  };
  return {
    async send(message) {
      if (closed) throw new Error("Closed.");
      const extra = o.headers ? await o.headers() : {};
      const res = await o.fetch(o.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": protocol, ...(session ? { "mcp-session-id": session } : {}), ...extra },
        body: JSON.stringify(message), signal: live.signal,
      });
      const sid = res.headers.get("mcp-session-id");
      if (sid) session = sid;
      if (res.status === 202 || res.status === 204) { void res.text().catch(() => undefined); return; }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`The server answered ${res.status}${text !== "" ? `: ${text}` : "."}`);
      }
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("text/event-stream") && res.body) {
        // the replies stream in; handled in the background so one slow tool does not hold the next request
        void (async () => { try { for await (const data of events(res.body!)) deliver(data); } catch (e) { if (!closed) onClose(e instanceof Error ? e.message : "The stream broke."); } })();
      } else deliver(await res.text());
    },
    onMessage: (cb) => { onMessage = cb; },
    onClose: (cb) => { onClose = cb; },
    async close() {
      if (session && !closed) { try { await o.fetch(o.url, { method: "DELETE", headers: { "mcp-session-id": session }, signal: AbortSignal.timeout(3000) }); } catch { /* the server may not support it */ } }
      closed = true;
      live.abort();
      onClose("Closed.");
    },
  };
}
