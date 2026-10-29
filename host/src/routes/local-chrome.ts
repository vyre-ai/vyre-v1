// Local doors to Vyre for Chrome on the person's own computer, for the Vyre app and the device's agent runner (loopback and the daemon's admin token, like /local/vault/key):
//   GET  /local/chrome/optin           { data: { spaces } }  the Spaces whose agents may drive this Chrome
//   PUT  /local/chrome/optin           { spaces }            the person's choice; the extension is told at once and again whenever it connects
//   POST /local/chrome/spaces         { id, name, address, token }   the app hands over the person's own session for a Team Space they are signed in to (kept in memory only); DELETE ?id= takes it away
//   POST /local/chrome/tool            { tool, input?, agent: { id, name }, timeoutMs? }   one chrome_* tool for an agent, run in the person's own tab. Refused unless the Space is opted in and the person can see the agent.
// Nothing here reads a page's content on its own: a tool call is the same request an agent computer's Chrome would take, and the answer is what the extension returned.
import type http from "node:http";
import { httpOf, makeError } from "./errors.ts";
import { isLocal } from "./local-key.ts";
import { sameToken } from "../bridge/chrome.ts";
import type { ChromeLink } from "../daemon/chrome-link.ts";

const TRACE = "0".repeat(32);
const PATH = /^\/local\/chrome\/(optin|tool|spaces)$/;
type Code = "permission.no_grant" | "auth.unauthenticated" | "validation.bad_input" | "provider.unavailable" | "timeout.deadline";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}
const refuse = (res: http.ServerResponse, code: Code, message: string): void => send(res, httpOf(code), { error: makeError(code, TRACE, { message }) });

async function bodyOf(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) throw new Error("too large"); chunks.push(c as Buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The words for what a refusal from the link or the extension means, in the codes the platform knows. */
function codeOf(e: unknown): { code: Code; message: string } {
  const err = e as { code?: unknown; message?: unknown; error?: { code?: unknown } };
  const message = typeof err.message === "string" ? err.message : "The Chrome tool failed.";
  switch (err.code) {
    case "not_allowed": return { code: "permission.no_grant", message };
    case "timeout": return { code: "timeout.deadline", message };
    case "offline": case "paused": case "not_available": return { code: "provider.unavailable", message };
    default: return typeof err.error?.code === "string" && err.error.code.startsWith("permission.") ? { code: "permission.no_grant", message } : { code: "provider.unavailable", message };
  }
}

export function createLocalChromeRoute(deps: { token: string; link(): ChromeLink }): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  async function serve(req: http.IncomingMessage, res: http.ServerResponse, which: "optin" | "tool" | "spaces"): Promise<void> {
    if (!isLocal(req)) return refuse(res, "permission.no_grant", "This only works on your own computer.");
    const sent = req.headers["authorization"];
    if (!sameToken(typeof sent === "string" && sent.startsWith("Bearer ") ? sent.slice(7) : "", deps.token)) return refuse(res, "auth.unauthenticated", "Authentication is required.");
    const link = deps.link();
    if (which === "spaces") {
      if (req.method === "DELETE") {
        const id = new URL(req.url ?? "", "http://x").searchParams.get("id") ?? "";
        link.unlinkRemote(id);
        return send(res, 200, { data: { removed: id } });
      }
      if (req.method !== "POST") return refuse(res, "validation.bad_input", "POST or DELETE.");
      let body: unknown;
      try { body = await bodyOf(req); } catch { return refuse(res, "validation.bad_input", "Send { id, name, address, token }."); }
      const b = isObject(body) ? body : {};
      let address = "";
      try { const u = new URL(String(b["address"])); if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || !(u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) throw new Error("x"); address = u.origin; } catch { return refuse(res, "validation.bad_input", "The address is a Space's https address."); }
      if (typeof b["id"] !== "string" || !/^spc_[A-Za-z0-9_]{1,120}$/.test(b["id"]) || typeof b["name"] !== "string" || b["name"].length < 1 || b["name"].length > 120 || typeof b["token"] !== "string" || b["token"].length < 8 || b["token"].length > 4096) return refuse(res, "validation.bad_input", "Send { id, name, address, token }.");
      link.linkRemote({ id: b["id"], name: b["name"], address, token: b["token"] });
      return send(res, 200, { data: { linked: b["id"] } });
    }
    if (which === "optin") {
      if (req.method === "GET") return send(res, 200, { data: { spaces: link.optedIn() } });
      if (req.method !== "PUT") return refuse(res, "validation.bad_input", "GET or PUT.");
      let body: unknown;
      try { body = await bodyOf(req); } catch { return refuse(res, "validation.bad_input", "Send { spaces: [...] }."); }
      const spaces = isObject(body) && Array.isArray(body["spaces"]) && body["spaces"].every((s) => typeof s === "string") ? (body["spaces"] as string[]) : null;
      if (!spaces) return refuse(res, "validation.bad_input", "Send { spaces: [...] }.");
      link.setOptedIn(spaces);
      return send(res, 200, { data: { spaces: link.optedIn() } });
    }
    if (req.method !== "POST") return refuse(res, "validation.bad_input", "POST.");
    let body: unknown;
    try { body = await bodyOf(req); } catch { return refuse(res, "validation.bad_input", "Send { tool, agent }."); }
    const agent = isObject(body) && isObject(body["agent"]) ? body["agent"] : null;
    if (!isObject(body) || typeof body["tool"] !== "string" || !agent || typeof agent["id"] !== "string" || typeof agent["name"] !== "string") return refuse(res, "validation.bad_input", "Send { tool, agent: { id, name } }.");
    try {
      const input = isObject(body["input"]) ? body["input"] : {};
      const timeoutMs = typeof body["timeoutMs"] === "number" && body["timeoutMs"] > 0 && body["timeoutMs"] <= 130_000 ? body["timeoutMs"] : undefined;
      const output = await link.drive({ tool: body["tool"], input, agent: { id: agent["id"], name: agent["name"] }, ...(timeoutMs ? { timeoutMs } : {}) });
      send(res, 200, { data: output });
    } catch (e) {
      const w = codeOf(e);
      refuse(res, w.code, w.message);
    }
  }
  return {
    handle(req, res) {
      const m = PATH.exec((req.url ?? "").split("?")[0] ?? "");
      if (!m) return false;
      void serve(req, res, m[1] as "optin" | "tool" | "spaces").catch(() => { if (!res.headersSent) refuse(res, "validation.bad_input", "That request could not be read."); });
      return true;
    },
  };
}
