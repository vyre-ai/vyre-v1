// @ts-check
// from vyre 0.6.9 modules/hands-chrome/net-tool.js@dbd2dfbab and api-tool.js@dbd2dfbab (the capture half)
// What a tab sent, received and said while an agent was driving it, kept in small ring buffers per tab: requests with timing (chrome_net), the endpoints a page
// calls and the scripts it loads (chrome_sources), and the console (chrome_console). Nothing here is stored outside this worker's memory; everything an agent reads
// back is masked first (mask.js): credentials, cookies and tokens never leave as such.

import { MASK, maskBody, maskHeaders, maskText, maskUrl } from "./mask.js";

const MAX_REQUESTS = 300;
const MAX_CONSOLE = 200;

/**
 * @typedef {{ id: string, method: string, url: string, type: string, status?: number, mime?: string, startedAt: number, ms?: number, finished: boolean, failed?: string, postData?: string, requestHeaders: Record<string, string> }} Req
 * @typedef {{ level: "log" | "warn" | "error", text: string, at: string }} Line
 * @typedef {{ requests: Req[], byId: Map<string, Req>, lines: Line[], inflight: number, navigations: number, loads: number, lastActivity: number }} TabTraffic
 */

/** @param {{ onEvent(h: (tabId: number, method: string, params: any) => void): () => void }} cdp @param {{ now?: () => number }} [o] */
export function createTraffic(cdp, o = {}) {
  const now = o.now ?? Date.now;
  /** @type {Map<number, TabTraffic>} */
  const tabs = new Map();

  /** @param {number} tabId @returns {TabTraffic} */
  const of = (tabId) => {
    let t = tabs.get(tabId);
    if (!t) { t = { requests: [], byId: new Map(), lines: [], inflight: 0, navigations: 0, loads: 0, lastActivity: now() }; tabs.set(tabId, t); }
    return t;
  };

  /** @param {string} s @returns {"log" | "warn" | "error"} */
  const levelOf = (s) => (s === "error" || s === "assert" ? "error" : s === "warning" || s === "warn" ? "warn" : "log");

  cdp.onEvent((tabId, method, p) => {
    const t = of(tabId);
    t.lastActivity = now();
    switch (method) {
      case "Network.requestWillBeSent": {
        const req = p.request ?? {};
        const prior = t.byId.get(p.requestId);
        // A redirect re-uses the request id: the earlier hop is finished with its redirect status.
        if (prior && p.redirectResponse) { prior.status = p.redirectResponse.status; prior.finished = true; t.inflight = Math.max(0, t.inflight - 1); }
        /** @type {Req} */
        const r = { id: String(p.requestId), method: String(req.method ?? "GET"), url: String(req.url ?? ""), type: String(p.type ?? "Other"), startedAt: Number(p.timestamp ?? 0) * 1000, finished: false, requestHeaders: maskHeaders(req.headers) };
        if (typeof req.postData === "string") r.postData = req.postData;
        t.requests.push(r);
        t.byId.set(r.id, r);
        t.inflight++;
        if (t.requests.length > MAX_REQUESTS) { const gone = t.requests.shift(); if (gone && t.byId.get(gone.id) === gone) t.byId.delete(gone.id); }
        break;
      }
      case "Network.responseReceived": {
        const r = t.byId.get(String(p.requestId));
        if (r) { r.status = Number(p.response?.status ?? 0); r.mime = String(p.response?.mimeType ?? ""); }
        break;
      }
      case "Network.loadingFinished": {
        const r = t.byId.get(String(p.requestId));
        if (r && !r.finished) { r.finished = true; r.ms = Math.max(0, Math.round(Number(p.timestamp ?? 0) * 1000 - r.startedAt)); t.inflight = Math.max(0, t.inflight - 1); }
        break;
      }
      case "Network.loadingFailed": {
        const r = t.byId.get(String(p.requestId));
        if (r && !r.finished) { r.finished = true; r.failed = String(p.errorText ?? "failed"); t.inflight = Math.max(0, t.inflight - 1); }
        break;
      }
      case "Page.frameStartedLoading": t.navigations++; break;
      case "Page.loadEventFired": t.loads++; break;
      case "Runtime.consoleAPICalled": {
        const text = (Array.isArray(p.args) ? p.args : []).map((/** @type {any} */ a) => (a && "value" in a ? String(a.value) : String(a?.description ?? ""))).join(" ");
        t.lines.push({ level: levelOf(String(p.type)), text: maskText(text).slice(0, 1000), at: new Date(Number(p.timestamp ?? now())).toISOString() });
        if (t.lines.length > MAX_CONSOLE) t.lines.shift();
        break;
      }
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails ?? {};
        t.lines.push({ level: "error", text: maskText(String(d.exception?.description ?? d.text ?? "error")).slice(0, 1000), at: new Date(Number(p.timestamp ?? now())).toISOString() });
        if (t.lines.length > MAX_CONSOLE) t.lines.shift();
        break;
      }
      default:
    }
  });

  return {
    /** Newest first. @param {number} tabId @param {{ filter?: string | undefined, limit?: number | undefined }} [q] */
    requests(tabId, q = {}) {
      const all = [...of(tabId).requests].reverse();
      const f = q.filter ? q.filter.toLowerCase() : "";
      return all.filter((r) => !f || r.url.toLowerCase().includes(f) || r.method.toLowerCase() === f).slice(0, Math.max(1, Math.min(500, q.limit ?? 100)));
    },
    /** @param {Req} r the request as an agent may read it: masked URL, status, timing */
    present(r) {
      /** @type {{ method: string, url: string, status?: number, ms?: number }} */
      const out = { method: r.method, url: maskUrl(r.url) };
      if (r.status !== undefined) out.status = r.status;
      if (r.ms !== undefined) out.ms = r.ms;
      return out;
    },
    /** The request body as sent, masked. @param {Req} r */
    sentBody: (r) => (r.postData === undefined ? undefined : maskBody(r.postData, r.requestHeaders["content-type"] ?? "")),
    /** @param {number} tabId @param {number} [limit] */
    console(tabId, level, limit = 100) {
      return of(tabId).lines.filter((l) => !level || l.level === level).slice(-Math.max(1, Math.min(500, limit)));
    },
    /** Endpoints a page calls (XHR and fetch), each once, newest first, and the scripts it loads. @param {number} tabId */
    sources(tabId) {
      const seen = new Set();
      /** @type {{ method: string, url: string }[]} */
      const endpoints = [];
      /** @type {string[]} */
      const scripts = [];
      for (const r of [...of(tabId).requests].reverse()) {
        const u = maskUrl(r.url).split("?")[0] ?? "";
        if (r.type === "XHR" || r.type === "Fetch") {
          const key = `${r.method} ${u}`;
          if (!seen.has(key)) { seen.add(key); endpoints.push({ method: r.method, url: u }); }
        } else if (r.type === "Script" && !scripts.includes(u)) scripts.push(u);
      }
      return { endpoints: endpoints.slice(0, 200), scripts: scripts.slice(0, 200) };
    },
    /** @param {number} tabId */
    inflight: (tabId) => of(tabId).inflight,
    /** @param {number} tabId */
    navigations: (tabId) => of(tabId).navigations,
    /** How many times the page has finished loading. @param {number} tabId */
    loads: (tabId) => of(tabId).loads,
    /** @param {number} tabId */
    lastActivity: (tabId) => of(tabId).lastActivity,
    /** @param {number} tabId */
    forget(tabId) { tabs.delete(tabId); },
    MASK,
  };
}
