// A redirect to another host drops every header (a key rides in one); a redirect inside the same host keeps them.
import test from "node:test";
import assert from "node:assert/strict";
import { guardedFetch } from "./http.ts";

const redirecting = (to: string) => {
  const seen: Array<{ url: string; headers?: Record<string, string> | undefined }> = [];
  let n = 0;
  const doFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, headers: init?.headers });
    n++;
    return n === 1
      ? {
          status: 302,
          headers: { get: (k: string) => (k.toLowerCase() === "location" ? to : null) },
          text: async () => "",
        }
      : { status: 200, headers: { get: () => null }, text: async () => "ok" };
  };
  return { seen, doFetch };
};

test("a redirect to another listed host does not carry the key", async () => {
  const r = redirecting("https://b.example.com/x");
  await guardedFetch(
    ["example.com"],
    "t".repeat(32),
    r.doFetch as never,
  )("https://a.example.com/x", { headers: { "X-Api-Key": "K" } });
  assert.deepEqual(
    r.seen.map((s) => s.headers?.["X-Api-Key"]),
    ["K", undefined],
  );
});

test("a redirect inside the same host keeps the headers", async () => {
  const r = redirecting("https://a.example.com/y");
  await guardedFetch(
    ["example.com"],
    "t".repeat(32),
    r.doFetch as never,
  )("https://a.example.com/x", { headers: { "X-Api-Key": "K" } });
  assert.deepEqual(
    r.seen.map((s) => s.headers?.["X-Api-Key"]),
    ["K", "K"],
  );
});
