import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ownOriginOf } from "./own-origin.ts";
import { createGithubConnectRoute } from "./github-connect.ts";
import { createGithubSignInRoute } from "./github-signin.ts";
import { createSsoSignInRoute, createSsoTickets } from "./sso-signin.ts";

const PUBLIC = "https://space.example.test";
const req = (headers: Record<string, string>, remote = "203.0.113.9", url = "/"): http.IncomingMessage =>
  ({ url, method: "GET", headers, socket: { remoteAddress: remote } }) as unknown as http.IncomingMessage;
const res = (): { out: { status: number; headers: Record<string, string>; body: string }; r: http.ServerResponse } => {
  const out = { status: 0, headers: {} as Record<string, string>, body: "" };
  const r = {
    writeHead(s: number, h: Record<string, string>) {
      out.status = s;
      out.headers = h;
    },
    end(b?: string) {
      out.body = b ?? "";
    },
  } as unknown as http.ServerResponse;
  return { out, r };
};
const FORGED = { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" };

test("the helper ignores Host and X-Forwarded-Host from another machine and returns the configured address", () => {
  assert.equal(
    ownOriginOf(req(FORGED), () => PUBLIC),
    PUBLIC,
  );
  assert.equal(
    ownOriginOf(req(FORGED), () => `${PUBLIC}/`),
    PUBLIC,
  );
  assert.equal(
    ownOriginOf(req(FORGED), () => null),
    null,
  );
});

test("on the person's own computer a loopback request keeps its loopback address; a forged one does not", () => {
  assert.equal(
    ownOriginOf(req({ host: "localhost:7421" }, "127.0.0.1"), () => null),
    "http://localhost:7421",
  );
  // a loopback socket behind a proxy (Caddy on the same computer) carries proxy headers: not local
  assert.equal(
    ownOriginOf(req({ host: "localhost:7421", "x-forwarded-for": "198.51.100.1" }, "127.0.0.1"), () => PUBLIC),
    PUBLIC,
  );
  // a loopback socket that names another host is not local
  assert.equal(
    ownOriginOf(req(FORGED, "127.0.0.1"), () => PUBLIC),
    PUBLIC,
  );
  // a remote machine that names localhost is not local
  assert.equal(
    ownOriginOf(req({ host: "localhost:7421" }), () => null),
    null,
  );
});

test("GitHub connect sends the code to the configured address, never the forged Host", () => {
  const route = createGithubConnectRoute({ origin: (r) => ownOriginOf(r, () => PUBLIC) });
  const ret = Buffer.from("https://evil.example/steal").toString("base64url");
  const a = res();
  route.handle(req(FORGED, "203.0.113.9", `/hooks/github/connect?code=c&state=abcdefghijklmnopqrstuv.${ret}`), a.r);
  assert.equal(a.out.status, 400, "a return to the forged host is refused");
  const own = Buffer.from(`${PUBLIC}/settings`).toString("base64url");
  const b = res();
  route.handle(req(FORGED, "203.0.113.9", `/hooks/github/connect?code=c&state=abcdefghijklmnopqrstuv.${own}`), b.r);
  assert.equal(b.out.status, 302);
  assert.ok(b.out.headers["location"]!.startsWith(`${PUBLIC}/settings#`));
  const none = createGithubConnectRoute({ origin: () => null });
  const c = res();
  none.handle(req(FORGED, "203.0.113.9", `/hooks/github/connect?code=c&state=abcdefghijklmnopqrstuv.${own}`), c.r);
  assert.equal(c.out.status, 503);
});

test("GitHub sign-in builds the provider redirect from the configured address", () => {
  const route = createGithubSignInRoute({
    oauth: () => ({ clientId: "id", clientSecret: "s" }) as never,
    origin: (r) => ownOriginOf(r, () => PUBLIC),
  });
  const a = res();
  route.handle(
    req(FORGED, "203.0.113.9", `/auth/github/start?return=${encodeURIComponent("https://evil.example/x")}`),
    a.r,
  );
  assert.equal(a.out.status, 400, "the forged host is not the Space's own, so that return is refused");
  const b = res();
  route.handle(req(FORGED, "203.0.113.9", `/auth/github/start?return=${encodeURIComponent(`${PUBLIC}/`)}`), b.r);
  assert.equal(b.out.status, 302);
  const loc = new URL(b.out.headers["location"]!);
  assert.equal(loc.host, "github.com");
  assert.equal(loc.searchParams.get("redirect_uri"), `${PUBLIC}/auth/github/callback`);
  const none = createGithubSignInRoute({
    oauth: () => ({ clientId: "id", clientSecret: "s" }) as never,
    origin: () => null,
  });
  const c = res();
  none.handle(req(FORGED, "203.0.113.9", `/auth/github/start?return=${encodeURIComponent(`${PUBLIC}/`)}`), c.r);
  assert.equal(c.out.status, 503);
});

test("company sign-in builds the provider redirect from the configured address", async () => {
  const doc = JSON.stringify({
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  });
  const make = (origin: (r: http.IncomingMessage) => string | null) =>
    createSsoSignInRoute({
      providers: async () => [
        {
          key: "google",
          title: "Google",
          issuer: "https://accounts.google.com",
          clientId: "cid",
          clientSecretHandle: "h",
          enabled: true,
        },
      ],
      secret: async () => "s",
      fetch: (async () => ({ status: 200, text: async () => doc })) as never,
      tickets: createSsoTickets(),
      origin,
    });
  const start = `/auth/sso/google/start?return=${encodeURIComponent(`${PUBLIC}/`)}`;
  const a = res();
  make((r) => ownOriginOf(r, () => PUBLIC)).handle(req(FORGED, "203.0.113.9", start), a.r);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(a.out.status, 302);
  assert.equal(
    new URL(a.out.headers["location"]!).searchParams.get("redirect_uri"),
    `${PUBLIC}/auth/sso/google/callback`,
  );
  const b = res();
  make((r) => ownOriginOf(r, () => PUBLIC)).handle(
    req(FORGED, "203.0.113.9", "/auth/sso/google/start?return=https%3A%2F%2Fevil.example%2F"),
    b.r,
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(b.out.status, 400);
  const c = res();
  make(() => null).handle(req(FORGED, "203.0.113.9", start), c.r);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.out.status, 503);
});
