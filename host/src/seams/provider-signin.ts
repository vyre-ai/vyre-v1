// Direct sign-in for the AI subscriptions (Claude, ChatGPT through Codex, Grok): the server starts the provider's own sign-in, hands the person a link (and a code to type, where the provider shows one),
// finishes it when the person approves (a code pasted back for Claude, polling for Codex), and gives the credential to the Vault module, which saves it in the person's own Mine folder.
// The credential passes through this file and nowhere else: not to a client, not to an agent, not into a log. A flow belongs to the person who started it and ends after 15 minutes.
//
//   claude  OAuth authorization code with PKCE. The person opens the link, approves, and the page shows `code#state`; that is pasted back and exchanged for a one-year token (the one `claude setup-token` makes).
//   codex   OAuth device authorization, as `codex login --device-auth` does it: a user code to type at the provider's device page, then the token exchange once the person has approved.
//   grok    The Grok command line's own sign-in, run in a private home that is deleted afterwards; the address and code it prints are read, the files it writes are the credential.
// UNVERIFIED against live accounts until a real one runs them; every address is a constant below and every answer is checked, so a changed provider shows as a failed sign-in with words, never as a wrong credential.
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SeamFetch } from "./ports.ts";

export type SigninProvider = "claude-code" | "codex" | "grok";
export interface CredentialField { key: string; value: string; secret: boolean }

export interface SigninStarted { url: string; userCode?: string; needsCode: boolean; expiresInSec: number }
export type SigninStep =
  | { state: "waiting" }
  | { state: "done"; fields: CredentialField[] }
  | { state: "failed"; message: string };

export interface ProviderSigninPort {
  has(provider: string): boolean;
  /** True while this server holds the flow (a restart loses it). */
  active(id: string): boolean;
  start(p: { id: string; provider: SigninProvider; person: string }): Promise<SigninStarted>;
  /** One look at a flow. A pasted code is passed with it. Never answers a value to anyone but the module that saves it.
   * A finished flow keeps its answer until cancel (the module saved it) or the 15 minutes run out, so a save that failed can be tried again without spending the code twice. */
  step(p: { id: string; person: string; code?: string }): Promise<SigninStep>;
  cancel(id: string): void;
}

// ---- the providers' addresses
export const CLAUDE = {
  authorize: "https://claude.ai/oauth/authorize",
  token: "https://platform.claude.com/v1/oauth/token",
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  redirect: "https://platform.claude.com/oauth/code/callback",
  scope: "user:inference",
  /** One year, the length `claude setup-token` asks for. */
  lifetimeSec: 31_536_000,
} as const;
export const CODEX = {
  issuer: "https://auth.openai.com",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  verifyPage: "https://auth.openai.com/codex/device",
} as const;
/** Hosts a sign-in address may be on. Anything else a provider (or a command) names is never shown to the person. */
export const SIGNIN_HOSTS: Readonly<Record<SigninProvider, readonly string[]>> = {
  "claude-code": ["claude.ai", "claude.com", "anthropic.com"],
  codex: ["auth.openai.com", "openai.com", "chatgpt.com"],
  grok: ["x.ai", "grok.com", "accounts.x.ai", "auth.x.ai"],
};

const TTL_MS = 15 * 60_000;
const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const onHost = (provider: SigninProvider, raw: string): boolean => {
  try {
    if (/[\\\s\u0000-\u001f]/.test(raw)) return false;
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && SIGNIN_HOSTS[provider].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
};

interface Flow {
  id: string; provider: SigninProvider; person: string; at: number; done: boolean;
  /** The finished answer, held until the module has saved it. */
  result?: Extract<SigninStep, { state: "done" }>;
  // claude
  verifier?: string; state?: string;
  // codex
  deviceAuthId?: string; userCode?: string; intervalMs?: number; nextPollAt?: number;
  // grok
  proc?: GrokProc;
}

interface GrokProc { text: string; url: string | null; code: string | null; ended: boolean; exitCode: number | null; home: string; kill(): void }

export interface SigninDeps {
  fetch: SeamFetch;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  /** Run the Grok command line. Tests pass a script; the default runs `grok login --device-code` in a private home. */
  spawnGrok?: () => GrokProc;
}

async function postJson(fetch: SeamFetch, url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  let json: Record<string, unknown> | null = null;
  try { const v = JSON.parse(await r.text()) as unknown; json = v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { /* not JSON */ }
  return { status: r.status, json };
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** `grok login --device-code` in a private home. The files it leaves there are the credential, read once and deleted. */
export function runGrokLogin(): GrokProc {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-grok-"));
  // nothing of this server's environment goes in: the command gets a home and a path
  const child = nodeSpawn("grok", ["login", "--device-code"], { env: { HOME: home, PATH: process.env["PATH"] ?? "/usr/bin:/bin", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const p: GrokProc = { text: "", url: null, code: null, ended: false, exitCode: null, home, kill: () => { try { child.kill("SIGKILL"); } catch { /* gone */ } } };
  const read = (d: Buffer): void => {
    p.text = (p.text + d.toString("utf8")).slice(-8000);
    const clean = p.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const urls = [...clean.matchAll(/https:\/\/[^\s"'<>)]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")).filter((u) => onHost("grok", u));
    p.url = urls.find((u) => /device|login|auth/i.test(new URL(u).pathname)) ?? urls[urls.length - 1] ?? p.url;
    const c = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/.exec(clean);
    if (c) p.code = c[1]!;
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("exit", (code) => { p.ended = true; p.exitCode = code; });
  child.on("error", (e) => { p.text += `\n${e.message}`; p.ended = true; p.exitCode = 127; });
  return p;
}

/** Every regular file the command left under its home, as a map of relative path to text. Each file is at most 64 KB; the home is deleted. */
export function collectGrokFiles(home: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile() && fs.statSync(p).size <= 65_536 && !/(^|\/)\.?(cache|logs?|tmp)(\/|$)/i.test(r)) out[r] = fs.readFileSync(p, "utf8");
    }
  };
  try { walk(home, ""); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  return out;
}

export function createProviderSignin(deps: SigninDeps): ProviderSigninPort {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const flows = new Map<string, Flow>();
  const sweep = (): void => {
    for (const [id, f] of flows) if (now() - f.at > TTL_MS) { f.proc?.kill(); if (f.proc && !f.done) fs.rmSync(f.proc.home, { recursive: true, force: true }); flows.delete(id); }
  };

  async function startClaude(f: Flow): Promise<SigninStarted> {
    f.verifier = b64url(random(32));
    f.state = b64url(random(24));
    const challenge = Buffer.from(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.verifier))).toString("base64url");
    const u = new URL(CLAUDE.authorize);
    for (const [k, v] of Object.entries({ code: "true", client_id: CLAUDE.clientId, response_type: "code", redirect_uri: CLAUDE.redirect, scope: CLAUDE.scope, code_challenge: challenge, code_challenge_method: "S256", state: f.state })) u.searchParams.set(k, v);
    return { url: u.href, needsCode: true, expiresInSec: TTL_MS / 1000 };
  }

  async function finishClaude(f: Flow, pasted: string | undefined): Promise<SigninStep> {
    if (pasted === undefined || pasted.trim() === "") return { state: "waiting" };
    // the page shows the authorization code, a #, and the state
    const m = /^([A-Za-z0-9_.~%+=\/-]{6,512})(?:#([A-Za-z0-9_.~%+=\/-]{6,256}))?$/.exec(pasted.trim());
    if (!m) return { state: "failed", message: "That does not look like the code the page showed. Copy all of it, including the part after the #." };
    if (m[2] !== undefined && m[2] !== f.state) return { state: "failed", message: "That code is from a different sign-in. Start again and use the newest page." };
    const r = await postJson(deps.fetch, CLAUDE.token, { grant_type: "authorization_code", code: m[1], state: f.state, client_id: CLAUDE.clientId, redirect_uri: CLAUDE.redirect, code_verifier: f.verifier, expires_in: CLAUDE.lifetimeSec });
    const token = str(r.json?.["access_token"]);
    if (r.status < 200 || r.status > 299 || token === "") return { state: "failed", message: r.status === 400 || r.status === 401 || r.status === 403 ? "Claude did not accept that code. It may have expired. Start again." : `Claude did not finish the sign-in (${r.status}). Try again in a minute.` };
    if (!/^sk-ant-/.test(token)) return { state: "failed", message: "Claude answered with something that is not a sign-in token. Nothing was saved." };
    return { state: "done", fields: [{ key: "setup_token", value: token, secret: true }] };
  }

  async function startCodex(f: Flow): Promise<SigninStarted> {
    const r = await postJson(deps.fetch, `${CODEX.issuer}/api/accounts/deviceauth/usercode`, { client_id: CODEX.clientId });
    const id = str(r.json?.["device_auth_id"]);
    const code = str(r.json?.["user_code"] ?? r.json?.["usercode"]);
    if (r.status < 200 || r.status > 299 || id === "" || code === "") throw new Error(r.status === 404 ? "ChatGPT has not turned on device sign-in for this account type." : `ChatGPT did not start the sign-in (${r.status}). Try again in a minute.`);
    f.deviceAuthId = id;
    f.userCode = code;
    const every = Number(r.json?.["interval"]);
    f.intervalMs = Math.max(2, Number.isFinite(every) ? every : 5) * 1000;
    f.nextPollAt = now() + f.intervalMs;
    return { url: CODEX.verifyPage, userCode: code, needsCode: false, expiresInSec: TTL_MS / 1000 };
  }

  async function finishCodex(f: Flow): Promise<SigninStep> {
    if (now() < (f.nextPollAt ?? 0)) return { state: "waiting" };
    f.nextPollAt = now() + (f.intervalMs ?? 5000);
    const polled = await postJson(deps.fetch, `${CODEX.issuer}/api/accounts/deviceauth/token`, { device_auth_id: f.deviceAuthId, user_code: f.userCode });
    if (polled.status === 403 || polled.status === 404) return { state: "waiting" };
    const authCode = str(polled.json?.["authorization_code"]);
    if (polled.status < 200 || polled.status > 299 || authCode === "") return { state: "failed", message: `ChatGPT did not finish the sign-in (${polled.status}). Start again.` };
    const ex = await postForm(deps.fetch, `${CODEX.issuer}/oauth/token`, { grant_type: "authorization_code", code: authCode, redirect_uri: `${CODEX.issuer}/deviceauth/callback`, client_id: CODEX.clientId, code_verifier: str(polled.json?.["code_verifier"]) });
    const access = str(ex.json?.["access_token"]), refresh = str(ex.json?.["refresh_token"]), idToken = str(ex.json?.["id_token"]);
    if (ex.status < 200 || ex.status > 299 || access === "" || refresh === "") return { state: "failed", message: "ChatGPT approved the sign-in but did not hand over a token. Start again." };
    // the file `codex login` writes, in the place the CLI reads it from
    const auth = { OPENAI_API_KEY: null, tokens: { id_token: idToken, access_token: access, refresh_token: refresh, account_id: accountIdOf(idToken) }, last_refresh: new Date(now()).toISOString() };
    return { state: "done", fields: [{ key: "credentials", value: JSON.stringify({ ".codex/auth.json": JSON.stringify(auth) }), secret: true }] };
  }

  async function startGrok(f: Flow): Promise<SigninStarted> {
    const proc = (deps.spawnGrok ?? runGrokLogin)();
    f.proc = proc;
    const end = now() + 20_000;
    while (!(proc.url && proc.code) && !proc.ended && now() < end) await new Promise((r) => setTimeout(r, 100));
    if (proc.ended && !(proc.url && proc.code)) {
      const said = proc.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/https:\/\/\S+/g, "(the link)").split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 200);
      fs.rmSync(proc.home, { recursive: true, force: true });
      throw new Error(proc.exitCode === 127 ? "Grok sign-in needs the Grok command line on this computer. Install it, or use an API key." : `Grok did not start the sign-in${said ? `: ${said}` : "."}`);
    }
    if (!proc.url || !proc.code) { proc.kill(); fs.rmSync(proc.home, { recursive: true, force: true }); throw new Error("Grok did not show a sign-in link. Try again, or use an API key."); }
    return { url: proc.url, userCode: proc.code, needsCode: false, expiresInSec: TTL_MS / 1000 };
  }

  async function finishGrok(f: Flow): Promise<SigninStep> {
    const proc = f.proc!;
    if (!proc.ended) return { state: "waiting" };
    if (proc.exitCode !== 0) { fs.rmSync(proc.home, { recursive: true, force: true }); return { state: "failed", message: "Grok did not finish the sign-in. Start again." }; }
    const files = collectGrokFiles(proc.home);
    if (Object.keys(files).length === 0) return { state: "failed", message: "Grok finished but left no sign-in. Start again." };
    return { state: "done", fields: [{ key: "credentials", value: JSON.stringify(files), secret: true }] };
  }

  return {
    has: (provider) => provider === "claude-code" || provider === "codex" || provider === "grok",
    active: (id) => flows.has(id),
    async start({ id, provider, person }) {
      sweep();
      const f: Flow = { id, provider, person, at: now(), done: false };
      flows.set(id, f);
      try {
        return provider === "claude-code" ? await startClaude(f) : provider === "codex" ? await startCodex(f) : await startGrok(f);
      } catch (e) {
        flows.delete(id);
        if (e instanceof Error && !/ENOTFOUND|ECONN|fetch failed/i.test(e.message)) throw e;
        throw new Error("The provider could not be reached. Check the connection and try again.");
      }
    },
    async step({ id, person, code }) {
      sweep();
      const f = flows.get(id);
      if (!f || f.person !== person) return { state: "failed", message: "That sign-in is over. Start again." };
      if (f.result) return f.result;
      let out: SigninStep;
      try {
        out = f.provider === "claude-code" ? await finishClaude(f, code) : f.provider === "codex" ? await finishCodex(f) : await finishGrok(f);
      } catch (e) {
        out = { state: "failed", message: e instanceof Error && /ENOTFOUND|ECONN|fetch failed/i.test(e.message) ? "The provider could not be reached. Try again." : "The sign-in did not finish. Start again." };
      }
      if (out.state === "done") { f.done = true; f.result = out; }
      else if (out.state === "failed") { f.done = true; flows.delete(id); }
      return out;
    },
    cancel(id) { const f = flows.get(id); if (f) { f.proc?.kill(); if (f.proc) fs.rmSync(f.proc.home, { recursive: true, force: true }); flows.delete(id); } },
  };
}

async function postForm(fetch: SeamFetch, url: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body).toString() });
  let json: Record<string, unknown> | null = null;
  try { const v = JSON.parse(await r.text()) as unknown; json = v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { /* not JSON */ }
  return { status: r.status, json };
}

/** The account id inside the id token, which Codex keeps beside the tokens. Empty when the token has none. */
function accountIdOf(idToken: string): string {
  try {
    const body = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = body["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    return str(auth?.["chatgpt_account_id"]);
  } catch { return ""; }
}
