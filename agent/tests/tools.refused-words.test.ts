// What a model reads when a call is refused for its input (16 Nov 2026, the owner: "its first attempts are always failing"). The ten shapes the validators refuse most, each as one plain sentence that names the exact
// input, says what to change and gives a value to copy, so that the second call is right. Each case is refused first, the sentence is checked, then the fixed call is made and accepted. No value the model wrote comes
// back in the sentence. The rules are the ones host/src/invoke.ts logs by name (a path and a rule, never a value).
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createToolSession } from "../src/tools/index.ts";
import { loadGenerated, validatingInvoke } from "../src/tools/harness.ts";
import type { ToolCtx } from "../src/tools/types.ts";

const golden = JSON.parse(readFileSync(new URL("./golden/naive-calls.json", import.meta.url), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const loaded = loadGenerated();
const SECRET = "the person's private wording";

function session() {
  const { invoke, sent } = validatingInvoke(loaded.caps);
  const s = createToolSession({
    catalog: loaded.catalog,
    defaults: loaded.defaults,
    invoke,
    levelFor: () => "manage",
    canEngineer: () => true,
    localPolicy: () => ({ action: "run" }) as never,
    traceId: () => "trace_fixed",
  });
  s.preload(
    "thr_current1",
    loaded.catalog.all.map((x) => x.name),
  );
  return { s, sent };
}
const ctx: ToolCtx = {
  space: "spc_1",
  agentId: "agt_intake",
  asker: "per_dana",
  thread: { threadId: "thr_current1", kind: "chat", planMode: false },
  turnId: "trn_words",
};
let n = 0;

interface Shape {
  shape: string;
  tool: string;
  /** What the model wrote, on top of the tool's naive call. A key set to undefined is taken out. */
  bad: Record<string, unknown>;
  /** The words the model must read. */
  says: RegExp[];
  /** What it writes the second time. */
  fix: Record<string, unknown>;
}
const ids = (k: number): string[] => Array.from({ length: k }, (_, i) => `fil_a${i}`);
const SHAPES: Shape[] = [
  {
    shape: "an input is missing",
    tool: "artifact_publish",
    bad: { title: undefined, html: `<p>${SECRET}</p>` },
    says: [/title is missing \(for example "[^"]+"\)/],
    fix: { title: "Q3 plan" },
  },
  {
    shape: "an input the tool does not have",
    tool: "files_rename",
    bad: { title: "plan" },
    says: [/files_rename has no input named title\. Its inputs are fileId, name\./],
    fix: { title: undefined },
  },
  {
    shape: "an input inside an object the tool does not have",
    tool: "files_create",
    bad: { name: "a.md", content: { words: SECRET } },
    says: [/content has no input named words\. Its inputs are base64, blobId, text\./],
    fix: { content: { text: "words" } },
  },
  {
    shape: "the wrong type",
    tool: "files_create",
    bad: { name: 5, content: { text: "x" } },
    says: [/name must be string, not integer \(for example "[^"]+"\)/],
    fix: { name: "a.md" },
  },
  {
    shape: "not one of the choices",
    tool: "files_list",
    bad: { section: "mine" },
    says: [/section must be one of "personal", "shared", "space"/],
    fix: { section: "personal" },
  },
  {
    shape: "an id of the wrong shape",
    tool: "files_get",
    bad: { fileId: SECRET },
    says: [/fileId is not an id of its kind \(like fil_[a-z0-9]+\)/],
    fix: { fileId: "fil_a1b2c3" },
  },
  {
    shape: "a web address without the scheme",
    tool: "chrome_open",
    bad: { url: "acme.test/plan" },
    says: [/url must start with http:\/\/ or https:\/\/ \(for example "https:\/\/[^"]+"\)/],
    fix: { url: "https://acme.test/plan" },
  },
  {
    shape: "a text over its limit",
    tool: "notes_create",
    bad: { body: "x".repeat(100_001) },
    says: [/body is too long: at most 100000 characters/],
    fix: { body: "short" },
  },
  {
    shape: "a text under its least",
    tool: "tasks_by_key",
    bad: { key: "ab" },
    says: [/key is too short: at least 3 characters/],
    fix: { key: "PLAN-1" },
  },
  {
    shape: "a number over its largest",
    tool: "files_list",
    bad: { limit: 9999 },
    says: [/limit must be at most 500/],
    fix: { limit: 50 },
  },
  {
    shape: "a number under its smallest",
    tool: "files_list",
    bad: { limit: 0 },
    says: [/limit must be at least 1/],
    fix: { limit: 1 },
  },
  {
    shape: "too many items in a list",
    tool: "previews_thumbnails",
    bad: { fileIds: ids(201) },
    says: [/fileIds holds too many items: at most 200; send the rest in a second call/],
    fix: { fileIds: ids(3) },
  },
];

test("the shapes a model is most often refused for each say the input, what to change and a value to copy; the second call is accepted", async (t) => {
  let ok = 0;
  for (const sh of SHAPES) {
    const { s } = session();
    const base = { ...(golden[sh.tool] ?? {}) };
    const write = (over: Record<string, unknown>): Record<string, unknown> => {
      const o = { ...base, ...over };
      for (const [k, v] of Object.entries(o)) if (v === undefined) delete o[k];
      return o;
    };
    const c = { ...ctx, turnId: `trn_${++n}` };
    const first = await s.call({ ...c, callId: "toolu_a" }, sh.tool, write(sh.bad));
    assert.equal(first.kind, "error", `${sh.shape}: refused`);
    const words = first.kind === "error" ? String(first.error.message) : "";
    for (const re of sh.says) assert.match(words, re, `${sh.shape}: ${words.slice(0, 500)}`);
    assert.ok(!words.includes(SECRET), `${sh.shape}: no value comes back`);
    assert.ok(!/\bundefined\b|\[object|validation\.|supportCode/.test(words), `${sh.shape}: nothing internal`);
    const second = await s.call({ ...c, callId: "toolu_b" }, sh.tool, write({ ...sh.bad, ...sh.fix }));
    assert.equal(
      second.kind,
      "result",
      `${sh.shape}: the second call is accepted: ${JSON.stringify(second)}`.slice(0, 600),
    );
    ok++;
  }
  t.diagnostic(`refused shapes: ${ok} of ${SHAPES.length} say what to change and the second call is right`);
});

test("the limits a model can meet are in what it reads about the input", () => {
  const t = loaded.catalog.byName("notes_create")!;
  const body = (t.inputSchema as { properties: Record<string, { description?: string }> }).properties["body"];
  assert.match(body?.description ?? "", /Max 100000 characters/);
  const th = loaded.catalog.byName("previews_thumbnails")!;
  const ids2 = (th.inputSchema as { properties: Record<string, { description?: string }> }).properties["fileIds"];
  assert.match(ids2?.description ?? "", /Max 200 items/);
});
