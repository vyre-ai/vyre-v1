import test from "node:test";
import assert from "node:assert/strict";
import { hide } from "../handlers/step-io.ts";

test("anything that looks like a key is hidden and counted, whatever step wrote it", () => {
  const out = hide({ url: "https://a.example", headers: { authorization: "Bearer abc123", accept: "json" }, body: { token: "t-1", note: "sk-live-9999", n: 2, list: ["ya29.xyz", "fine"] }, empty: { password: "" } });
  assert.deepEqual(out.value, { url: "https://a.example", headers: { authorization: "[hidden]", accept: "json" }, body: { token: "[hidden]", note: "[hidden]", n: 2, list: ["[hidden]", "fine"] }, empty: { password: "" } });
  assert.equal(out.hidden, 4);
  assert.equal(JSON.stringify(out.value).includes("abc123"), false);
});
