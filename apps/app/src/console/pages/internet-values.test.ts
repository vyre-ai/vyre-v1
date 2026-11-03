import test from "node:test";
import assert from "node:assert/strict";
import { INTERNET_CHOICES, internetPolicy, internetSummary, parseHosts } from "./internet-values.ts";

test("Internet access: three choices, public first and the default; typed hosts are cut to names and what is not a name is named back", () => {
  assert.deepEqual(INTERNET_CHOICES.map((c) => c.title), ["Anything public (default)", "Only the AI providers", "A list I choose"]);
  assert.deepEqual(internetPolicy(undefined), { mode: "public", hosts: [] });
  assert.deepEqual(internetPolicy({ mode: "list", hosts: ["github.com", 3] }), { mode: "list", hosts: ["github.com"] });
  assert.deepEqual(parseHosts("https://GitHub.com/vyre-ai/x\n*.npmjs.org, pypi.org:443  pypi.org\n\nlocalhost 10.0.0.1"), { hosts: ["github.com", "*.npmjs.org", "pypi.org"], bad: ["localhost", "10.0.0.1"] });
  assert.match(internetSummary({ mode: "providers", hosts: [] }), /only the AI providers/);
  assert.match(internetSummary({ mode: "list", hosts: ["github.com"] }), /AI providers and 1 host: github.com\./);
  assert.match(internetSummary({ mode: "public", hosts: [] }), /any public website/);
});

test("the Internet page says how the choice holds on Windows: sealed for team chats, a guide in a Personal Space", async () => {
  const { WINDOWS_NOTE } = await import("./internet-values.ts");
  assert.match(WINDOWS_NOTE, /team chats run in a sealed Linux sandbox/);
  assert.match(WINDOWS_NOTE, /Personal Space on Windows/);
  assert.match(WINDOWS_NOTE, /can still reach the internet directly/);
});
