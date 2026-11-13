// The card's fact: the box shows the vyre.run hook address only once the relay itself says it carries hooks, and keeps the answer for a while.
import test from "node:test";
import assert from "node:assert/strict";
import { createRelayHooksCheck } from "./relay-hooks.ts";
import type { FetchFn } from "../platform/probes.ts";

const answering =
  (body: string, seen: string[], ok = true): FetchFn =>
  async (url) => {
    seen.push(url);
    return { ok, status: ok ? 200 : 503, headers: { get: () => null }, text: async () => body };
  };
const settle = () => new Promise((r) => setTimeout(r, 10));

test("false until the relay answers hooks: true; then true, asked once in ten minutes", async () => {
  let t = 0;
  const seen: string[] = [];
  const check = createRelayHooksCheck(answering('{"hooks":true}', seen), () => t);
  assert.equal(check("https://harbor.vyre.run"), false, "not proven yet");
  await settle();
  assert.equal(check("https://harbor.vyre.run"), true);
  assert.deepEqual(seen, ["https://harbor.vyre.run/__vyre/info.json"]);
  t += 599_000;
  check("https://harbor.vyre.run");
  await settle();
  assert.equal(seen.length, 1, "cached");
  t += 2_000;
  check("https://harbor.vyre.run");
  await settle();
  assert.equal(seen.length, 2, "asked again after ten minutes");
});

test("a relay that does not say so, an error page, or no answer: the card keeps saying nothing can reach it", async () => {
  for (const f of [
    answering("{}", []),
    answering('{"hooks":"yes"}', []),
    answering('{"hooks":true}', [], false),
    (async () => {
      throw new Error("down");
    }) as FetchFn,
  ]) {
    const check = createRelayHooksCheck(f);
    check("https://harbor.vyre.run");
    await settle();
    assert.equal(check("https://harbor.vyre.run"), false);
  }
  assert.equal(createRelayHooksCheck(null)("https://harbor.vyre.run"), false);
});
