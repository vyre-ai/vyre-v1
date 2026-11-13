// The server's check of an artifact host never hangs, never reads a long answer, never follows a redirect, and asks only a plain DNS name.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchFn } from "../platform/probes.ts";
import { askArtifactHost, HOST_CHECK_MAX_BYTES, validArtifactHost } from "./artifact-check.ts";

const reply = (o: { status?: number; len?: string; text: () => Promise<string> }): ReturnType<FetchFn> =>
  Promise.resolve({
    ok: (o.status ?? 200) < 300,
    status: o.status ?? 200,
    headers: { get: (n: string) => (n.toLowerCase() === "content-length" ? (o.len ?? null) : null) },
    text: o.text,
  });

test("a host that sends headers and then stalls is given up on at the deadline, and the next ask is a fresh one", async () => {
  let calls = 0;
  const stalls: FetchFn = () => {
    calls++;
    return reply({ text: () => new Promise<string>(() => undefined) });
  };
  const t0 = Date.now();
  await assert.rejects(() => askArtifactHost(stalls, "a.team.example.com", "/x", 60), /did not answer in time/);
  assert.ok(Date.now() - t0 < 1500, "within the limit, not for ever");
  await assert.rejects(() => askArtifactHost(stalls, "a.team.example.com", "/x", 60), /in time/);
  assert.equal(calls, 2, "asked again, not stuck behind the first");
  const good: FetchFn = () => reply({ text: () => Promise.resolve(" vyre-artifact-host abc \n") });
  assert.deepEqual(await askArtifactHost(good, "a.team.example.com", "/x", 60), {
    ok: true,
    status: 200,
    body: "vyre-artifact-host abc",
  });
});

test("an answer that says it is long is refused unread, and a long one that does not say is refused after reading", async () => {
  let read = false;
  const big: FetchFn = () =>
    reply({
      len: String(50 * 1024 * 1024),
      text: () => {
        read = true;
        return Promise.resolve("x");
      },
    });
  await assert.rejects(() => askArtifactHost(big, "a.team.example.com", "/x"), /too long/);
  assert.equal(read, false, "a 50 MB answer is never read");
  const sneaky: FetchFn = () => reply({ text: () => Promise.resolve("x".repeat(HOST_CHECK_MAX_BYTES + 1)) });
  await assert.rejects(() => askArtifactHost(sneaky, "a.team.example.com", "/x"), /too long/);
});

test("a redirect is not followed (the request says so), and only a plain DNS name is asked", async () => {
  let seen: { redirect?: string | undefined; url?: string | undefined } = {};
  const spy: FetchFn = (url, init) => {
    seen = { redirect: init?.redirect, url };
    return reply({ text: () => Promise.resolve("") });
  };
  await askArtifactHost(spy, "a.team.example.com", "/.well-known/vyre-artifact-host");
  assert.equal(seen.redirect, "error");
  assert.equal(seen.url, "https://a.team.example.com/.well-known/vyre-artifact-host");
  const redirecting: FetchFn = () => Promise.reject(new TypeError("redirect mode is set to error"));
  await assert.rejects(() => askArtifactHost(redirecting, "a.team.example.com", "/x"), /redirect/);
  for (const bad of [
    "evil.example.com/x",
    "user@a.team.example.com",
    "a.team.example.com:8443",
    "127.0.0.1",
    "10.0.0.5",
    "a..example.com",
    "",
    "localhost",
  ])
    await assert.rejects(() => askArtifactHost(spy, bad, "/x"), /plain DNS name/, bad);
  assert.ok(validArtifactHost("a.localhost:4100") && validArtifactHost("a.mla.vyre.run"));
});
