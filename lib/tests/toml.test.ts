import test from "node:test";
import assert from "node:assert/strict";
import { parseToml, TomlError } from "../toml.ts";

test("reads tables, arrays of tables, strings with escapes, numbers, booleans and inline tables", () => {
  const t = parseToml('key = "a\\"b\\u00e9"\nn = 1_000\nok = true\ndomains = ["x.com", \'y.com\']\n[auth]\ntype = "api_key"\n[[secrets]]\nname = "K"\ndescription = "d"\n[[secrets]]\nname = "L"\ndescription = "e"\n[rate]\nrps = 5\nburst = 10\ninline = { a = 1, b = "two" }\n');
  assert.deepEqual(t, { key: 'a"bé', n: 1000, ok: true, domains: ["x.com", "y.com"], auth: { type: "api_key" }, secrets: [{ name: "K", description: "d" }, { name: "L", description: "e" }], rate: { rps: 5, burst: 10, inline: { a: 1, b: "two" } } });
});

test("a key that would reach an object's prototype is refused, in keys, tables and quoted keys", () => {
  for (const text of ["__proto__ = 1", "[__proto__]\nx = 1", "[a.constructor]\nx = 1", '"prototype" = 1', "x = { __proto__ = 1 }"]) assert.throws(() => parseToml(text), TomlError, text);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("errors name the line; duplicates, bare words and unclosed brackets are refused; size and nesting are bounded", () => {
  assert.throws(() => parseToml('a = 1\nb = nope'), /line 2/);
  assert.throws(() => parseToml("a = 1\na = 2"), /set twice/);
  assert.throws(() => parseToml("a = [1, 2"), /not closed/);
  assert.throws(() => parseToml(`a = ${"[".repeat(100)}${"]".repeat(100)}`), /nested too deeply/);
  assert.throws(() => parseToml("a = 1\n".repeat(60_000)), /too large/);
});
