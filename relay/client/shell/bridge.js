// @ts-check
// The service worker's core, with no browser globals beyond fetch's Request and Response: every same-origin request the phone makes goes to the box through the end-to-end encrypted
// relay channel (a relay/client Connection), and the box's answer comes back as an ordinary Response. The relay never sees a path or a byte of it.

/** Request headers that belong to the phone's own hop, not the box's. */
const DROP = new Set(["host", "connection", "content-length", "accept-encoding", "transfer-encoding", "keep-alive", "upgrade", "te"]);
/** Response headers a Response built in a service worker may not carry, or that describe a hop that no longer exists. */
const DROP_BACK = new Set(["connection", "content-length", "content-encoding", "transfer-encoding", "keep-alive", "set-cookie", "set-cookie2"]);

/** @param {string} s */
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
const STYLE = "html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:26rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;opacity:.75}";

/** @param {string} title @param {string} line @param {number} status */
function page(title, line, status) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>${esc(title)}</title><style>${STYLE}</style><body><main><h1>${esc(title)}</h1><p>${esc(line)}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "20" } });
}

/** The page for a box that does not answer. @param {string} label */
export const asleepPage = label => page(`${label} is asleep`, "Wake the computer and this page opens by itself.", 503);
/** The page for a phone the box no longer lists. @param {string} label */
export const removedPage = label => page("This phone was removed", `${label} no longer lists this phone. Open the link from Phone access on the computer again.`, 403);

/**
 * The request as the box's router takes it.
 * @param {Request} request
 * @returns {Promise<{ path: string, init: { method: string, headers: Record<string, string>, body: Uint8Array | null } }>}
 */
export async function toBoxRequest(request) {
  const url = new URL(request.url);
  /** @type {Record<string, string>} */
  const headers = {};
  request.headers.forEach((v, k) => { if (!DROP.has(k.toLowerCase())) headers[k.toLowerCase()] = v; });
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
  return { path: `${url.pathname}${url.search}`, init: { method, headers, body } };
}

const SHELL_TAG = '<script src="/__vyre-ws.js"></script>';

/**
 * The box's page with the live-socket shim as its first script, so the app's WebSocket reaches the box through this worker. Only an HTML page that came back 200 is touched; a page whose scripts the
 * box's own policy keeps from loading it simply never gets the shim, and the app polls.
 * @param {Response} res
 */
export async function withShim(res) {
  if (res.status !== 200 || !/^text\/html\b/i.test(res.headers.get("content-type") || "")) return res;
  const html = await res.text();
  const head = /<head(\s[^>]*)?>/i.exec(html);
  const at = head ? head.index + head[0].length : (/^\s*<!doctype[^>]*>/i.exec(html)?.[0].length ?? 0);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html.slice(0, at) + SHELL_TAG + html.slice(at), { status: 200, headers });
}

/**
 * The box's answer as a Response whose body streams (server-sent events keep flowing).
 * @param {{ status: number, headers: Iterable<[string, string]>, body: AsyncIterable<Uint8Array> }} res
 */
export function toResponse(res) {
  const headers = new Headers();
  for (const [k, v] of res.headers) if (!DROP_BACK.has(k.toLowerCase())) { try { headers.set(k, v); } catch { /* a header the runtime refuses */ } }
  const status = res.status;
  if (status === 204 || status === 205 || status === 304) return new Response(null, { status, headers });
  const it = res.body[Symbol.asyncIterator]();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const n = await it.next();
        if (n.done) controller.close(); else controller.enqueue(n.value);
      } catch (e) { controller.error(e); }
    },
    async cancel() { try { await it.return?.(); } catch { /* already gone */ } },
  });
  return new Response(stream, { status, headers });
}

/**
 * @typedef {{ fetch(path: string, init: { method?: string, headers?: Record<string, string>, body?: Uint8Array | null, signal?: AbortSignal }): Promise<any>, state?: string, lastError?: Error | null }} Box
 * @param {{ box: () => Promise<Box | null>, label: () => string, waitMs?: number }} o
 *   `box` gives the connection (null when the phone has no pin yet); `waitMs` is how long a request waits for the box before the page says it is asleep.
 */
export function createBridge(o) {
  const waitMs = o.waitMs ?? 8000;
  return {
    /** @param {Request} request @returns {Promise<Response | null>} null: not ours, let the network have it */
    async handle(request) {
      const box = await o.box();
      if (!box) return null;
      const navigation = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), waitMs);
      const onAbort = () => ac.abort();
      request.signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        const { path, init } = await toBoxRequest(request);
        const res = await box.fetch(path, { ...init, signal: ac.signal });
        const out = toResponse(res);
        return navigation ? await withShim(out) : out;
      } catch (e) {
        if (box.state === "relay_removed" || /device removed/.test(String(/** @type {Error} */ (e).message))) return removedPage(o.label());
        if (request.signal?.aborted) return new Response(null, { status: 499 });
        return navigation ? asleepPage(o.label()) : new Response(JSON.stringify({ error: `${o.label()} is asleep` }), { status: 503, headers: { "content-type": "application/json", "retry-after": "20" } });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener?.("abort", onAbort);
      }
    },
  };
}
