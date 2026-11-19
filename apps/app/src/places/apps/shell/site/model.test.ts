// The words of the site page (site/model.ts): a deploy's name and line, times, which log lines belong to which step, and what needs a person.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attention,
  clock,
  depNote,
  depState,
  depTitle,
  findLines,
  missingName,
  siteWord,
  sourceLine,
  stepLines,
  took,
} from "./model.ts";
import type { Dep } from "./model.ts";

const NOW = 1_760_000_000_000;
const dep = (o: Partial<Dep>): Dep => ({
  deploymentId: "dpl_1",
  siteId: "sit_1",
  env: "production",
  state: "ready",
  at: NOW - 60_000,
  ...o,
});

test("times read the way a person says them", () => {
  assert.equal(took(400), "under 1 s");
  assert.equal(took(47_200), "47 s");
  assert.equal(took(60_000), "1 min");
  assert.equal(took(72_000), "1 min 12 s");
  assert.equal(clock(23_900), "0:23");
  assert.equal(clock(125_000), "2:05");
  assert.equal(clock(-5), "0:00");
});

test("a deploy is named by its commit's first line, then its commit, then what was deployed", () => {
  assert.equal(depTitle({ message: "Annual pricing", commit: "a3f9c12ffff", branch: "main" }), "Annual pricing");
  assert.equal(depTitle({ commit: "a3f9c12ffff", branch: "main" }), "Commit a3f9c12");
  assert.equal(depTitle({ branch: "main" }), "Deploy of main");
  assert.equal(depTitle({}), "Deploy");
});

test("a deploy's state: live wins, a canceled one is quiet and not a failure", () => {
  assert.deepEqual(depState({ state: "ready", current: true }), { word: "Live", tone: "ok" });
  assert.deepEqual(depState({ state: "ready" }), { word: "Earlier", tone: "quiet" });
  assert.deepEqual(depState({ state: "failed" }), { word: "Failed", tone: "bad" });
  assert.deepEqual(depState({ state: "stopped" }), { word: "Canceled", tone: "quiet" });
  assert.deepEqual(depState({ state: "building" }), { word: "Deploying", tone: "mine" });
});

test("the line under a deploy: who and when and how long; the step and its clock while it runs; why when it failed", () => {
  assert.equal(
    depNote(
      dep({ branch: "main", commit: "a3f9c12ffff", message: "x", finishedAt: NOW - 13_000 }),
      "Imran",
      "1 min ago",
      NOW,
    ),
    "main · a3f9c12 · Imran · 1 min ago · 47 s",
  );
  assert.equal(
    depNote(
      dep({
        state: "building",
        branch: "main",
        steps: [
          { key: "fetch", state: "ok", ms: 2000 },
          { key: "build", state: "running", startedAt: NOW - 23_000 },
          { key: "start", state: "waiting" },
          { key: "check", state: "waiting" },
        ],
      }),
      "you",
      "just now",
      NOW,
    ),
    "main · you · Build 0:23",
  );
  assert.equal(depNote(dep({ state: "queued" }), null, "just now", NOW), "Waiting to start");
  assert.equal(
    depNote(dep({ state: "failed", problem: "It stopped because STRIPE_KEY is not set." }), "you", "2 min ago", NOW),
    "you · 2 min ago · It stopped because STRIPE_KEY is not set.",
  );
});

test("each step gets its own lines of the log; a step that never ran has none; a log without steps is one block", () => {
  const lines = [
    "==> Getting acme/app",
    "==> Commit 1",
    "==> Building",
    "Step 1/3",
    "Step 2/3",
    "==> Starting",
    "Live",
  ];
  const split = stepLines(lines, [
    { key: "fetch", state: "ok", from: 0 },
    { key: "build", state: "ok", from: 2 },
    { key: "start", state: "ok", from: 5 },
    { key: "check", state: "ok", from: 6 },
  ]);
  assert.deepEqual(
    split?.map((s) => s.lines.length),
    [2, 3, 1, 1],
  );
  const failed = stepLines(lines.slice(0, 5), [
    { key: "fetch", state: "ok", from: 0 },
    { key: "build", state: "failed", from: 2 },
    { key: "start", state: "skipped" },
    { key: "check", state: "skipped" },
  ]);
  assert.deepEqual(
    failed?.map((s) => s.lines.length),
    [2, 3, 0, 0],
  );
  assert.equal(failed?.[1]?.lines[2], "Step 2/3");
  assert.equal(stepLines(lines, undefined), null);
  // a from past the end (a short tail) is held inside the lines
  assert.deepEqual(
    stepLines(["a"], [{ key: "fetch", state: "ok", from: 9 }])?.map((s) => s.lines.length),
    [0],
  );
});

test("search keeps the lines that hold what was typed, any case", () => {
  const lines = ["GET /queue 200", "Error: card_declined", "GET /api 200"];
  assert.deepEqual(findLines(lines, " error "), ["Error: card_declined"]);
  assert.equal(findLines(lines, "").length, 3);
});

test("the site in a word: a failed deploy does not take a serving site down", () => {
  const failed = dep({ state: "failed", problem: "x" });
  assert.equal(siteWord({ state: "ready", live: true, lastDeploy: failed }).word, "Live");
  assert.equal(siteWord({ state: "stopped", live: false, lastDeploy: failed }).word, "Not live yet");
  assert.equal(siteWord({ state: "building", live: true }).word, "Deploying");
  assert.equal(siteWord({ state: "ready", live: true, blocked: true }).word, "Taken down");
  assert.equal(siteWord({ state: "stopped", live: false, lastDeploy: dep({ current: true }) }).word, "Not published");
});

test("what needs a person: a running deploy, or the last failure with its sentence; a canceled deploy asks for nothing", () => {
  assert.equal(attention({ live: true, lastDeploy: dep({ current: true }) }, NOW), null);
  assert.equal(attention({ live: true, lastDeploy: dep({ state: "stopped", problem: "Canceled." }) }, NOW), null);
  const f = attention(
    { live: true, lastDeploy: dep({ state: "failed", problem: "It needs a Postgres database and has none." }) },
    NOW,
  );
  assert.equal(f?.kind, "failed");
  assert.equal(f?.label, "The last deploy failed. The one before it is still live");
  assert.equal(f?.note, "It needs a Postgres database and has none.");
  assert.equal(attention({ live: false, lastDeploy: dep({ state: "failed" }) }, NOW)?.label, "The deploy failed");
  const r = attention(
    {
      live: true,
      lastDeploy: dep({
        state: "building",
        steps: [
          { key: "fetch", state: "ok", ms: 1000 },
          { key: "build", state: "running", startedAt: NOW - 61_000 },
        ],
      }),
    },
    NOW,
  );
  assert.equal(r?.note, "Build · 1:01");
});

test("the source in a line, and the variable a failure names", () => {
  assert.equal(
    sourceLine({ repo: "https://github.com/northwind/cx-dashboard.git", branch: "main", root: "apps/web" }),
    "northwind/cx-dashboard (main), apps/web",
  );
  assert.equal(sourceLine({ fileId: "fil_1" }), "An upload in Files");
  assert.equal(missingName("It stopped because STRIPE_KEY is not set. Add it from the Vault."), "STRIPE_KEY");
  assert.equal(missingName("The build failed."), null);
});

import { entryOf, isSecretVar, mergeEnv, parseEnv } from "./model.ts";
import type { EnvRow } from "./model.ts";

// the same table is in modules/sites/tests/secrets.test.ts: the page and the server must agree
export const SECRET_CASES: readonly (readonly [string, string, boolean])[] = [
  ["API_KEY", "x", true],
  ["APIKEY", "x", true],
  ["STRIPE_SK", "x", true],
  ["SESSION_SECRET", "x", true],
  ["GITHUB_TOKEN", "x", true],
  ["DB_PASSWORD", "x", true],
  ["SENDGRID", "anything", true],
  ["JWT", "x", true],
  ["SLACK_URL", "https://hooks.slack.com/services/T000/B000/XXXX", true],
  ["DATABASE_URL", "postgres://app:pw@db:5432/app", true],
  ["DATABASE_URL", "postgres://db:5432/app?password=hunter22", true],
  ["ANY", "sk_live_51Habcdefghijkl", true],
  ["ANY", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", true],
  ["ANY", "AKIAIOSFODNN7EXAMPLE", true],
  ["ANY", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123", true],
  ["CERT", "-----BEGIN PRIVATE KEY-----", true],
  ["BLOB", "q8Zr2LmN7xYp4VtC9sHd3GjK6wFa5BeU", true],
  ["NEXT_PUBLIC_API_URL", "https://api.example.com", false],
  ["NEXT_PUBLIC_KEY", "pk_live_abc", false],
  ["NEXT_PUBLIC_X", "sk_live_51Habcdefghijkl", true],
  ["APP_MODE", "calm", false],
  ["NODE_ENV", "production", false],
  ["PUBLIC_URL", "https://a.example", false],
  ["FEATURE_AUTH", "true", false],
  ["PASS_RATE", "0.95", false],
  ["REGION", "us-east-1", false],
  ["LOG_LEVEL", "info", false],
  ["GREETING", "hello there friend", false],
];

test("a secret is what its name or its value says; a public name or a plain shape is not", () => {
  for (const [name, value, want] of SECRET_CASES) assert.equal(isSecretVar(name, value), want, `${name}=${value}`);
});

test("a pasted .env is read like dotenv: quotes of either kind, multiline values, escapes, export, comments", () => {
  const read = (text: string) => parseEnv(text).vars.map((v) => [v.name, v.value] as const);
  assert.deepEqual(read("A=1\nB = 2\nexport C=3"), [
    ["A", "1"],
    ["B", "2"],
    ["C", "3"],
  ]);
  assert.deepEqual(read("# c\n\nA=1 # note\nB=a#b"), [
    ["A", "1"],
    ["B", "a#b"],
  ]);
  assert.deepEqual(read('A="x" # note "y"'), [["A", "x"]]);
  assert.deepEqual(read("A='x # y'\nB=`b c`"), [
    ["A", "x # y"],
    ["B", "b c"],
  ]);
  assert.deepEqual(read('A="a\\nb"'), [["A", "a\nb"]], "double quotes read \\n");
  assert.deepEqual(read("A='a\\nb'"), [["A", "a\\nb"]], "single quotes do not");
  assert.deepEqual(read('A="a\\\\nb"'), [["A", "a\\nb"]], "an escaped backslash then n stays");
  assert.deepEqual(read('A="say \\"hi\\""'), [["A", 'say "hi"']]);
  assert.deepEqual(read("A=1\nA=2"), [["A", "2"]], "the last wins");
  assert.deepEqual(
    read("﻿A=1\r\nB=2\r\n"),
    [
      ["A", "1"],
      ["B", "2"],
    ],
    "a byte-order mark and CRLF",
  );
  assert.deepEqual(
    read("A=\nB=''"),
    [
      ["A", ""],
      ["B", ""],
    ],
    "empty values",
  );
});

test("a quoted value runs over lines, and key material never becomes a name", () => {
  const pem =
    'KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj\nabcDEFgh12==\n-----END PRIVATE KEY-----"\nNEXT=1';
  const out = parseEnv(pem);
  assert.deepEqual(
    out.vars.map((v) => v.name),
    ["KEY", "NEXT"],
  );
  assert.match(out.vars[0]!.value, /^-----BEGIN PRIVATE KEY-----\nMIIE[\s\S]*-----END PRIVATE KEY-----$/);
  assert.equal(out.vars[0]!.secret, true);
  // an unquoted block of base64 is not variables
  const bare = parseEnv("-----BEGIN KEY-----\nabcDEFgh12==\nxyz+/9==\n-----END KEY-----");
  assert.deepEqual(bare.vars, [], JSON.stringify(bare.vars));
  assert.equal(bare.skipped.length, 4);
  assert.ok(
    bare.skipped.every((s) => /^line \d+$/.test(s)),
    "skipped names a line, never its text",
  );
});

test("a quote that never closes, a bad name and a line that is not an assignment are skipped by line", () => {
  const out = parseEnv('A=1\nB="never closes\nC=3');
  assert.deepEqual(
    out.vars.map((v) => v.name),
    ["A", "C"],
    "the line with the open quote is skipped, the rest is read",
  );
  assert.deepEqual(out.skipped, ["line 2"]);
  const bad = parseEnv("1BAD=x\nnot a line\nA-B=1\nOK=1");
  assert.deepEqual(
    bad.vars.map((v) => v.name),
    ["OK"],
  );
  assert.deepEqual(bad.skipped, ["line 1", "line 2", "line 3"]);
});

test("a paste adds names or replaces the ones that exist, and leaves out what Vyre sets itself", () => {
  const have = [
    { name: "A", value: "1", scope: "all" as const },
    { name: "B", vaultHandle: "#K" },
  ];
  const m = mergeEnv(have, [
    { name: "A", value: "2" },
    { name: "PORT", value: "80" },
    { name: "C", value: "3" },
  ]);
  assert.deepEqual(
    m.entries.map((e) => `${e.name}=${e.value ?? e.vaultHandle}`),
    ["B=#K", "A=2", "C=3"],
  );
  assert.deepEqual(m.left, ["PORT"]);
});

test("a row of the list goes back as the entry it was", () => {
  const plain: EnvRow = { name: "A", vaultName: "", injected: false, kind: "plain", value: "x", scope: "previews" };
  const secret: EnvRow = { name: "B", vaultName: "#K.b", injected: true, kind: "secret", scope: "all" };
  assert.deepEqual(entryOf(plain), { name: "A", scope: "previews", value: "x", confirmPlain: true });
  assert.deepEqual(entryOf(secret), { name: "B", scope: "all", vaultHandle: "#K.b" });
});

import { foundLines, repoOf } from "./model.ts";

test("a repo is read from what was typed, and only when it is one", () => {
  assert.equal(repoOf("github.com/acme/cx-dashboard"), "acme/cx-dashboard");
  assert.equal(repoOf("https://github.com/acme/cx.git"), "acme/cx");
  assert.equal(repoOf(" acme/cx/ "), "acme/cx");
  for (const bad of ["", "acme", "acme/", "github.com/acme", "a b/c", "https://example.com/a/b/c"])
    assert.equal(repoOf(bad), null, bad);
});

test("what was found is one line for what it is, and one for what it needs", () => {
  assert.deepEqual(foundLines({ note: "Node: npm ci, npm run build, then npm start.", needs: [], env: [] }), [
    "Node: npm ci, npm run build, then npm start.",
  ]);
  const two = foundLines({ note: "Next.js.", needs: ["postgres", "redis"], env: ["A", "B", "C", "D", "E"] });
  assert.equal(two.length, 2);
  assert.match(two[1]!, /^It looks for a Postgres database and Redis and 5 variables \(A, B, C, D, \.\.\.\)\./);
});

import { parseFollow } from "./model.ts";

test("the preview branches typed are split on commas and spaces, each once", () => {
  assert.deepEqual(parseFollow("feat/*, next  next,\n*"), ["feat/*", "next", "*"]);
  assert.deepEqual(parseFollow("  "), []);
});
