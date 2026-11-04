// The connect callback: the code and state go back to the app in the fragment, only to this Space's own address or a loopback one, and a state that is not the shape github.me.connect makes is refused.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGithubConnectRoute, returnOf } from "./github-connect.ts";

const ret = (u: string): string => Buffer.from(u).toString("base64url");
const state = (u: string): string => `abcdefghijklmnopqrstuv.${ret(u)}`;
function call(path: string, o: { method?: string; host?: string } = {}): { status: number; headers: Record<string, string>; handled: boolean; body: string } {
  const route = createGithubConnectRoute();
  const req = { url: path, method: o.method ?? "GET", headers: { host: o.host ?? "space.vyre.test", "x-forwarded-proto": "https" }, socket: {} } as unknown as http.IncomingMessage;
  const out = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = { writeHead(s: number, h: Record<string, string>) { out.status = s; out.headers = h; }, end(b?: string) { out.body = b ?? ""; } } as unknown as http.ServerResponse;
  const handled = route.handle(req, res);
  return { ...out, handled };
}

test("a good callback goes back to the app with the code and state in the fragment, and nothing else", () => {
  const s = state("https://space.vyre.test/settings");
  const r = call(`/hooks/github/connect?code=abc123&state=${s}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, `https://space.vyre.test/settings#github_connect_code=abc123&github_connect_state=${encodeURIComponent(s)}`);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(returnOf(s), "https://space.vyre.test/settings");
});

test("a loopback return is allowed; another site, a bad state, a wrong method and other paths are not", () => {
  assert.equal(call(`/hooks/github/connect?code=a&state=${state("http://localhost:5173/x")}`).status, 302);
  assert.equal(call(`/hooks/github/connect?code=a&state=${state("https://evil.example/steal")}`).status, 400);
  assert.equal(call(`/hooks/github/connect?code=a&state=nonsense`).status, 400);
  assert.equal(call(`/hooks/github/connect?code=a&state=${state("https://space.vyre.test/x")}`, { method: "POST" }).status, 405);
  assert.equal(call("/hooks/github/other").handled, false);
});

test("a denied or empty code goes back as denied", () => {
  const s = state("https://space.vyre.test/");
  assert.match(call(`/hooks/github/connect?error=access_denied&state=${s}`).headers.location!, /#github_connect=denied$/);
  assert.match(call(`/hooks/github/connect?state=${s}`).headers.location!, /#github_connect=denied$/);
});
