// One account across Spaces in the desktop app (rc.14): a join or owner claim link that reaches an app already signed in to its Personal Space opens on "Continue as", and
// "Use a different account" is today's form. Driven through the real gate and the shell's link bridge.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush, press, textOf } from "../../onboarding/test-dom.ts";
import { SessionGate } from "./SessionGate.tsx";

const g = globalThis as { requestAnimationFrame?: (f: (t: number) => void) => number; cancelAnimationFrame?: (id: number) => void };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => undefined;
const box = { x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
Object.defineProperty(Object.prototype, "getBoundingClientRect", { value: () => box, configurable: true, enumerable: false, writable: true });
Object.defineProperty(Object.prototype, "getContext", { value: () => null, configurable: true, enumerable: false, writable: true });

type Handler = (event: { payload: unknown }) => void;
function desktopShell(): { fire(payload: unknown): Promise<void> } {
  let handler: Handler | null = null;
  const info = { app: "Vyre", version: "1.0.0-rc.14", platform: "macos", arch: "aarch64", sidecar: { phase: "ready", url: null, version: "1.0.0-rc.14", restarts: 0, error: null } };
  Object.assign(globalThis, {
    __TAURI__: {
      core: { invoke: async (command: string) => (command === "desktop_info" ? info : null) },
      event: { listen: async (_name: string, h: Handler) => { handler = h; return () => { handler = null; }; } },
    },
  });
  return { fire: async (payload) => { assert.ok(handler, "the page is listening for links"); await act(async () => { handler!({ payload }); }); await flush(); } };
}

const PERSONAL = { baseUrl: "http://127.0.0.1:7801", token: "tok_personal", personId: "usr_irfad", marker: "m", username: "irfad", displayName: "Irfad Imtiaz", def: { spaceId: "spc_personal", name: "Personal", kind: "personal", kit: "general", skinDefault: "paper", tint: ["#000", "#fff"], counts: {}, dots: {} } };
function storage(sessions: Record<string, unknown>): void {
  const data = new Map<string, string>([["vyre.session.v1", JSON.stringify({ sessions })]]);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
const PREVIEW = { spaceId: "spc_acme", spaceName: "Acme", invitedBy: "Maya Chen", role: "member", expiresAt: 9_999_999_999_999, fingerprint: "0123456789abcdef" };
const answer = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

async function withGate(sessions: Record<string, unknown>, run: (root: never, shell: ReturnType<typeof desktopShell>) => Promise<void>): Promise<void> {
  installDom();
  storage(sessions);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => { if (String(input).endsWith("/v1/members/invites/preview")) return answer(PREVIEW); throw new Error("offline in tests"); }) as typeof fetch;
  try {
    const shell = desktopShell();
    const root = await mount(createRoot, <SessionGate baseUrl={null} />);
    await run(root as never, shell);
  } finally {
    globalThis.fetch = realFetch;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}
const JOIN = { action: "join", params: { address: "https://acme.example.com", code: "ABCD-EFGH", fp: "0123456789abcdef" } };
const CLAIM = { action: "claim", params: { address: "https://mla.example.com", token: "clm_abcdefgh", s: "spc_mla", n: "MLA" } };

test("join in the desktop app with the Personal Space signed in: Continue as, then Use a different account is today's form", async () => {
  await withGate({ [PERSONAL.baseUrl]: PERSONAL }, async (root, shell) => {
    await shell.fire(JOIN);
    await flush();
    assert.ok(find(root, "join-as-password"), "only the password is asked");
    assert.match(textOf(root), /Continue as irfad/);
    assert.match(textOf(root), /join Acme/);
    await press(find(root, "join-as-other"));
    await flush();
    assert.equal(find(root, "join-as-password"), null);
    assert.ok(find(root, "step-welcome") || find(root, "step-signin-details"), "today's join steps");
  });
});

test("join in the desktop app with no account on it: today's form", async () => {
  await withGate({}, async (root, shell) => {
    await shell.fire(JOIN);
    await flush();
    assert.equal(find(root, "join-as-password"), null);
    assert.ok(find(root, "step-welcome") || find(root, "step-signin-details"));
  });
});

test("an owner claim link handed to the desktop app opens Continue as for the Space it names", async () => {
  await withGate({ [PERSONAL.baseUrl]: PERSONAL }, async (root, shell) => {
    await shell.fire(CLAIM);
    await flush();
    assert.ok(find(root, "claim-as-password"), "the claim asks only for the password");
    assert.match(textOf(root), /Continue as irfad/);
    assert.match(textOf(root), /set up MLA/);
    await press(find(root, "claim-as-other"));
    await flush();
    assert.ok(find(root, "claim-name") && find(root, "claim-confirm"), "Use a different account: today's form");
  });
});
