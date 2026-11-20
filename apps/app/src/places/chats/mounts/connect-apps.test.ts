import test from "node:test";
import assert from "node:assert/strict";
import { APPS, howTo } from "./connect-apps.ts";

const link = { url: "https://northwind.vyre.run/mcp", claudeCode: "claude mcp add --transport http vyre https://northwind.vyre.run/mcp" };

test("every app has steps, something to copy, and the address in it is this Space's", () => {
  for (const a of [...APPS, { id: "other" as const }]) {
    const h = howTo(a.id, link);
    assert.ok(h.steps.length >= 2 && h.copy.length >= 1, a.id);
    assert.ok(h.copy.every((c) => c.text.length > 0 && c.testID));
  }
  assert.equal(howTo("claude", link).copy[0]?.text, link.url);
  assert.equal(howTo("code", link).copy[0]?.text, link.claudeCode);
});

test("only Cursor has a one-press link, and it carries the address and nothing else", () => {
  assert.equal(howTo("claude", link).open, undefined);
  const o = howTo("cursor", link).open!;
  assert.match(o.href, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=vyre&config=/);
  const cfg = JSON.parse(Buffer.from(decodeURIComponent(o.href.split("config=")[1]!), "base64").toString("utf8"));
  assert.deepEqual(cfg, { url: link.url });
});
