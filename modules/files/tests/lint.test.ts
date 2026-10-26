// files lint: AGENT.md and agent.toml fixtures, the secret scan, the role-line edit, files.save and files.share (spec 2.16, 2.6, 2.4).
// @reads /modules/files/migrations/0001_files_tree.sql
// @reads /generated/modules/files/schema.sql

import test from "node:test";
import assert from "node:assert/strict";
import { aesUnwrap, aesWrap } from "../../../kernel/src/seal/box.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import type { EventEnvelope } from "../../../packages/contracts/src/envelope.ts";
import { handlers } from "../impl.ts";
import { lineDiff, lintText, parseToml, scanSecrets } from "../handlers/lint.ts";

type Row = Record<string, unknown>;

function memoryDb(): Ctx["db"] & { rows(table: string): Row[] } {
  const tables = new Map<string, Row[]>();
  const bag = (name: string): Row[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };
  const take = (args: unknown[], at: { i: number }): unknown => {
    if (at.i >= args.length) throw new Error("sql is missing a value");
    const value = args[at.i];
    at.i += 1;
    return value;
  };
  const compile = (where: string | undefined, args: unknown[], at: { i: number }): ((row: Row) => boolean) => {
    if (!where) return () => true;
    const preds: ((row: Row) => boolean)[] = [];
    for (const part of where.split(" AND ")) {
      const isNull = /^(\w+) IS NULL$/.exec(part);
      if (isNull) {
        const col = isNull[1];
        if (col === undefined) throw new Error(`bad predicate ${part}`);
        preds.push((row) => row[col] === null || row[col] === undefined);
        continue;
      }
      const eq = /^(\w+) = \?$/.exec(part);
      if (!eq) throw new Error(`bad predicate ${part}`);
      const col = eq[1];
      if (col === undefined) throw new Error(`bad predicate ${part}`);
      const val = take(args, at);
      preds.push((row) => {
        const cur = row[col];
        if (cur === null || cur === undefined) return false;
        return cur === val;
      });
    }
    return (row) => preds.every((pred) => pred(row));
  };
  const all = (sql: string, ...args: unknown[]): unknown[] => {
    const text = sql.replace(/\s+/g, " ").trim();
    const sel = /^SELECT \* FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!sel) throw new Error(`unsupported sql: ${text}`);
    const name = sel[1];
    if (name === undefined) throw new Error(`unsupported sql: ${text}`);
    const at = { i: 0 };
    const pred = compile(sel[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    return bag(name).filter(pred).map((row) => ({ ...row }));
  };
  const run = (sql: string, ...args: unknown[]): { changes: number } => {
    const text = sql.replace(/\s+/g, " ").trim();
    const at = { i: 0 };
    const insert = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(text);
    if (insert) {
      const name = insert[1];
      const colSql = insert[2];
      const valSql = insert[3];
      if (name === undefined || colSql === undefined || valSql === undefined) throw new Error(`unsupported sql: ${text}`);
      const cols = colSql.split(",").map((col) => col.trim());
      const marks = valSql.split(",").map((mark) => mark.trim());
      if (marks.some((mark) => mark !== "?") || marks.length !== cols.length) throw new Error(`unsupported sql: ${text}`);
      const row: Row = {};
      for (const col of cols) row[col] = take(args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      bag(name).push(row);
      return { changes: 1 };
    }
    const update = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(text);
    if (update) {
      const name = update[1];
      const setSql = update[2];
      const where = update[3];
      if (name === undefined || setSql === undefined || where === undefined) throw new Error(`unsupported sql: ${text}`);
      const assigns: { col: string; val: unknown }[] = [];
      for (const part of setSql.split(", ")) {
        const m = /^(\w+) = \?$/.exec(part);
        if (!m || m[1] === undefined) throw new Error(`bad assignment ${part}`);
        assigns.push({ col: m[1], val: take(args, at) });
      }
      const pred = compile(where, args, at);
      if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
      let changes = 0;
      for (const row of bag(name)) {
        if (!pred(row)) continue;
        for (const assign of assigns) row[assign.col] = assign.val;
        changes += 1;
      }
      return { changes };
    }
    const del = /^DELETE FROM (\w+)(?: WHERE (.+))?$/.exec(text);
    if (!del || del[1] === undefined) throw new Error(`unsupported sql: ${text}`);
    const name = del[1];
    const pred = compile(del[2], args, at);
    if (at.i !== args.length) throw new Error(`unused sql values: ${text}`);
    const kept: Row[] = [];
    let changes = 0;
    for (const row of bag(name)) {
      if (pred(row)) changes += 1;
      else kept.push(row);
    }
    tables.set(name, kept);
    return { changes };
  };
  return { all, run, rows: (table) => bag(table).map((row) => ({ ...row })) };
}

function spaceSeal(key: Uint8Array): Ctx["seal"] {
  return {
    seal(plain: Uint8Array, scope: string): Sealed {
      const box = aesWrap(key, plain, scope);
      return { keyId: "space-key", nonce: box.iv, bytes: JSON.stringify({ ct: box.ct, tag: box.tag, aad: scope }) };
    },
    unseal(sealed: Sealed): Uint8Array {
      if (sealed.keyId !== "space-key") throw new Error("wrong key");
      const parsed: unknown = JSON.parse(sealed.bytes);
      if (parsed === null || typeof parsed !== "object") throw new Error("bad box");
      const box = parsed as { ct?: unknown; tag?: unknown; aad?: unknown };
      if (typeof box.ct !== "string" || typeof box.tag !== "string" || typeof box.aad !== "string") throw new Error("bad box");
      return aesUnwrap(key, { iv: sealed.nonce, ct: box.ct, tag: box.tag }, box.aad);
    },
  };
}

function open(answers: Record<string, unknown> = {}): { ctx: Ctx; events: { name: string; payload: unknown }[]; db: ReturnType<typeof memoryDb>; calls: { cap: string; input: unknown }[] } {
  const db = memoryDb();
  const calls: { cap: string; input: unknown }[] = [];
  const events: { name: string; payload: unknown }[] = [];
  let clock = 1_760_000_000_000;
  const key = new Uint8Array(32);
  for (let i = 0; i < key.length; i++) key[i] = (i * 17 + 3) & 0xff;
  const ctx: Ctx = {
    space: "spc_test",
    principal: { kind: "person", id: "per_maya" },
    trace: { traceId: "a".repeat(32), spanId: "b".repeat(16) },
    origin: "user",
    depth: 0,
    now: () => {
      clock += 1;
      return clock;
    },
    db,
    emit: <T>(name: string, _subject: string, payload: T): EventEnvelope<T> => {
      events.push({ name, payload });
      return {
        seq: events.length,
        id: `evt_${events.length}`,
        type: name,
        sv: 1,
        hlc: String(clock),
        at: clock,
        traceId: "a".repeat(32),
        actor: "per_maya",
        depth: 0,
        label: 0,
        vis: "space",
        enc: 0,
        payload,
      };
    },
    call: async (cap: string, input: unknown) => {
      // files.tree reads access for the Shared with me count; those reads are not what these tests are about
      if (cap !== "access.lists" && cap !== "access.shares_of") calls.push({ cap, input });
      const answer = answers[cap];
      if (answer === undefined) throw new Error(`no answer for ${cap}`);
      return typeof answer === "function" ? (answer as (i: unknown) => unknown)(input) : answer;
    },
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_test" }),
    vault: { fill: async () => {}, use: (handle: string) => ({ handle }) },
    http: async () => ({ status: 0, text: async () => "" }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
    schedule: async () => "sch_test",
    seal: spaceSeal(key),
  };
  return { ctx, events, db, calls };
}


async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof VyreErr, e instanceof Error ? e.message : "throw");
    assert.equal(e.error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

function idOf(v: string | undefined, label: string): string {
  if (typeof v !== "string" || v.length === 0) assert.fail(label);
  return v;
}

const aws = (): string => `AKIA${"IOSFODNN7EXAMPLE"}`;
const ghp = (): string => `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}`;
const rule = (r: { problems: { rule: string }[] }, name: string): boolean => r.problems.some((p) => p.rule === name);

const AGENT_MD = ["# Intake agent", "Inherits: VYRE.md", "", "Use the intake form before anything else.", "Override: may email clients without a second look"].join("\n");
const TOML_OK = [
  'name = "Intake"',
  'description = "Use me when a new lead arrives."',
  'handoffs = ["Billing"]',
  "[limits]",
  "per_day = 5",
  "[vault]",
  'keys = ["#Team_Key"]',
  "[[routines]]",
  'cron = "0 9 * * 1-5"',
  'prompt_file = "routines/morning.md"',
].join("\n");

test("lint: line counts against the limits, amber then red", () => {
  const n = (k: number): string => Array.from({ length: k }, (_, i) => `line ${i}`).join("\n");
  assert.equal(lintText("agent_md", n(150)).state, "ok");
  const amber = lintText("agent_md", n(151));
  assert.equal(amber.state, "amber");
  assert.ok(rule(amber, "lines.amber"));
  const red = lintText("agent_md", `${n(201)}\n`);
  assert.equal(red.state, "red");
  assert.equal(red.lines, 201, "a trailing newline is not a line");
  assert.ok(red.problems.some((p) => p.rule === "lines.red" && p.severity === "error"));
  assert.equal(lintText("vyre_md", n(121)).state, "amber", "VYRE.md is held to 120");
  assert.equal(lintText("vyre_md", n(120)).state, "ok");
  assert.equal(lintText("agent_md", n(30), { amber: 20, red: 40 }).state, "amber", "the limits are settings");
  assert.equal(lintText("agent_md", "").lines, 0);
});

test("lint: Inherits and Override lines, hard rules, repeated facts", () => {
  const r = lintText("agent_md", AGENT_MD);
  assert.equal(r.inherits, true);
  assert.deepEqual(r.overrides, [{ line: 5, text: "may email clients without a second look" }]);
  const bare = lintText("agent_md", "Just do the work.");
  assert.equal(bare.inherits, false);
  assert.ok(rule(bare, "inherits.missing"));
  assert.equal(lintText("vyre_md", "x").inherits, undefined);
  assert.ok(rule(lintText("agent_md", "Inherits: VYRE.md\nOverride:"), "override.empty"));

  const nine = ["# Hard rules", ...Array.from({ length: 9 }, (_, i) => `- rule number ${i}`)].join("\n");
  assert.ok(rule(lintText("vyre_md", nine), "vyre.hard_rules"));
  const eight = ["# Hard rules", ...Array.from({ length: 8 }, (_, i) => `- rule number ${i}`), "# Notes", "- one", "- two"].join("\n");
  assert.ok(!rule(lintText("vyre_md", eight), "vyre.hard_rules"));

  const dup = ["Always check the client's conflict status before replying.", "Something else.", "- Always check the client's conflict status before replying."].join("\n");
  const d = lintText("agent_md", dup);
  assert.deepEqual(d.problems.filter((p) => p.rule === "repeated.fact").map((p) => p.line), [3]);
  const v = lintText("agent_md", dup, undefined, { vyreText: "Something else entirely here, long enough.\nAlways check the client's conflict status before replying." });
  assert.ok(rule(v, "repeated.vyre"));
});

test("secret scan: keys are found by line and kind, values never come back, vault names pass", () => {
  const text = ["Plain text.", `aws key ${aws()}`, `token ${ghp()}`, "-----BEGIN RSA PRIVATE KEY-----", "api_key = #Team_Key", "api_key: vault:stripe", 'password = "hunter2hunter2hunter2"', "see https://user:pa55word@example.com/x"].join("\n");
  const found = scanSecrets(text);
  assert.deepEqual(found.map((f) => [f.line, f.kind]), [[2, "aws_access_key"], [3, "github_token"], [4, "private_key"], [7, "generic_assignment"], [8, "url_credentials"]]);
  const r = lintText("agent_md", text);
  assert.equal(r.secrets.length, 5);
  assert.ok(r.problems.filter((p) => p.rule === "secret").every((p) => p.severity === "error"));
  assert.ok(!JSON.stringify(r).includes("IOSFODNN7EXAMPLE") && !JSON.stringify(r).includes("a1B2c3D4e5F6"), "a finding never carries the value");
  assert.equal(scanSecrets("Use the token from the Vault, never paste it.").length, 0);
});

test("agent.toml: the reader and the form checks", () => {
  const parsed = parseToml(TOML_OK);
  assert.equal(parsed.error, undefined);
  assert.deepEqual((parsed.value["routines"] as unknown[]).length, 1);
  assert.equal(parseToml('a = [1, 2,\n 3]\nb = { x = "y" }').error, undefined);
  assert.deepEqual(parseToml("a = 1\nb = nope").error, { line: 2, message: '"nope" is not a value; text needs quotes.' });
  assert.equal(parseToml("a = 1\na = 2").error?.line, 2);
  assert.equal(parseToml('a = "open').error?.message, "A string is not closed.");

  const ok = lintText("agent_toml", TOML_OK, undefined, { agentNames: ["Billing"], fileExists: (p) => p === "routines/morning.md" });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.inherits, undefined);

  const bad = lintText("agent_toml", "name = Intake");
  assert.deepEqual(bad.problems.map((p) => [p.rule, p.line, p.severity]), [["toml.syntax", 1, "error"]]);

  const form = lintText("agent_toml", [
    'name = 5', 'colour = "red"', 'handoffs = ["Ghost"]', "[limits]", "per_day = -1", "per_week = 3",
    "[[routines]]", 'cron = "daily"', 'prompt_file = "routines/gone.md"', "[[routines]]", 'cron = "0 9 * * *"', 'prompt_file = "../secrets.md"', "[[routines]]", 'cron = "0 9 * * *"',
  ].join("\n"), undefined, { agentNames: ["Billing"], fileExists: () => false });
  const got = form.problems.map((p) => p.rule).sort();
  assert.deepEqual(got, ["handoff.unknown", "routine.cron", "routine.prompt", "routine.prompt_missing", "routine.prompt_path", "toml.type", "toml.type", "toml.unknown_key", "toml.unknown_key"].sort());
  assert.equal(form.problems.find((p) => p.rule === "handoff.unknown")?.line, 3);
  assert.equal(lintText("agent_toml", "[tools]\nallow = []\ncount = 1").problems.length, 0);
});

test("role line: the description edit is linted (one line, not empty, not long)", () => {
  assert.deepEqual(lintText("agent_toml", 'description = "Use me for intake."').problems, []);
  assert.ok(rule(lintText("agent_toml", 'description = ""'), "role_line.empty"));
  assert.ok(rule(lintText("agent_toml", `description = "${"x".repeat(161)}"`), "role_line.long"));
  const multi = lintText("agent_toml", 'description = "one\\ntwo"');
  assert.ok(multi.problems.some((p) => p.rule === "role_line.multiline" && p.severity === "error" && p.line === 1));
  assert.ok(rule(lintText("agent_toml", "description = 7"), "toml.type"));
});

test("line diff counts what a save adds and removes", () => {
  assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd"), { added: 2, removed: 1 });
  assert.deepEqual(lineDiff("", "a\nb"), { added: 2, removed: 0 });
  assert.deepEqual(lineDiff("a\nb", ""), { added: 0, removed: 2 });
  assert.deepEqual(lineDiff("same", "same"), { added: 0, removed: 0 });
});

async function agentFolder(): Promise<{ k: ReturnType<typeof open>; agentId: string; routinesId: string; folderId: string }> {
  const k = open({
    "settings.get": { row: { value: { amber: 150, red: 200 } } },
    "agents.list": { agents: [{ name: "Billing" }] },
  });
  const tree = await handlers["files.tree"](k.ctx, {});
  const personal = tree.roots.find((r) => r.key === "personal")?.folderId;
  const agentId = (await handlers["files.folder.create"](k.ctx, { parentId: idOf(personal, "personal"), name: "Intake" })).folder.folderId;
  const routinesId = (await handlers["files.folder.create"](k.ctx, { parentId: agentId, name: "routines" })).folder.folderId;
  return { k, agentId, routinesId, folderId: agentId };
}

test("files.lint: reads the stored file or the draft text, and settings set the limits", async () => {
  const { k, agentId, routinesId } = await agentFolder();
  const md = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "AGENT.md", content: { text: AGENT_MD } })).file.fileId;
  const toml = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "agent.toml", content: { text: TOML_OK } })).file.fileId;
  const plain = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "notes.md", content: { text: "x" } })).file.fileId;
  const prompt = (await handlers["files.create"](k.ctx, { folderId: routinesId, name: "morning.md", content: { text: "Check the inbox." } })).file.fileId;

  const a = await handlers["files.lint"](k.ctx, { fileId: md });
  assert.deepEqual([a.file, a.inherits, a.overrides.length, a.state], ["agent_md", true, 1, "ok"]);
  const t = await handlers["files.lint"](k.ctx, { fileId: toml });
  assert.equal(t.file, "agent_toml");
  assert.deepEqual(t.problems, [], "the routine prompt exists, the handoff is a known agent");
  const draft = await handlers["files.lint"](k.ctx, { fileId: toml, text: TOML_OK.replace("routines/morning.md", "routines/none.md") });
  assert.ok(rule(draft, "routine.prompt_missing"));
  assert.equal((await handlers["files.lint"](k.ctx, { fileId: md, text: `${"x\n".repeat(160)}` })).state, "amber");
  assert.equal((await handlers["files.lint"](k.ctx, { fileId: plain })).file, "other");
  assert.equal((await handlers["files.lint"](k.ctx, { fileId: prompt })).file, "routine_prompt");
  await expectCode("validation.bad_input", () => handlers["files.lint"](k.ctx, { fileId: md, text: 5 }));
  await expectCode("validation.bad_input", () => handlers["files.lint"](k.ctx, {}));
  await expectCode("validation.not_found", () => handlers["files.lint"](k.ctx, { fileId: "fil_missing" }));

  // the limits come from the setting; without the setting the defaults hold
  const tight = open({ "settings.get": { row: { value: { amber: 2, red: 4 } } } });
  const tree = await handlers["files.tree"](tight.ctx, {});
  const folderId = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const f = (await handlers["files.create"](tight.ctx, { folderId, name: "AGENT.md", content: { text: "a\nb\nc" } })).file.fileId;
  assert.equal((await handlers["files.lint"](tight.ctx, { fileId: f })).state, "amber");
  const none = open();
  const tree2 = await handlers["files.tree"](none.ctx, {});
  const f2 = (await handlers["files.create"](none.ctx, { folderId: idOf(tree2.roots.find((r) => r.key === "personal")?.folderId, "personal"), name: "AGENT.md", content: { text: "a\nb\nc" } })).file.fileId;
  assert.equal((await handlers["files.lint"](none.ctx, { fileId: f2 })).state, "ok");
});

test("files.save: lint first, errors and warnings stop it, a clean save commits one version", async () => {
  const { k, agentId } = await agentFolder();
  const id = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "AGENT.md", content: { text: AGENT_MD } })).file.fileId;

  // a secret is an error: nothing is saved, and the answer carries the lint and the diff but not the value
  try {
    await handlers["files.save"](k.ctx, { fileId: id, text: `${AGENT_MD}\nkey ${aws()}` });
    assert.fail("expected a refusal");
  } catch (e) {
    assert.ok(e instanceof VyreErr);
    assert.equal(e.error.code, "validation.precondition_failed");
    assert.ok(!JSON.stringify(e.error).includes("IOSFODNN7EXAMPLE"));
    const lint = (e.error.details as { lint: { secrets: unknown[] }; added: number }).lint;
    assert.equal(lint.secrets.length, 1);
    assert.equal((e.error.details as { added: number }).added, 1);
  }
  assert.equal((await handlers["files.get"](k.ctx, { fileId: id })).file.version, 1);

  // a warning (amber) needs it accepted
  const long = `${AGENT_MD}\n${Array.from({ length: 150 }, (_, i) => `rule ${i}`).join("\n")}`;
  await expectCode("validation.precondition_failed", () => handlers["files.save"](k.ctx, { fileId: id, text: long }));
  const accepted = await handlers["files.save"](k.ctx, { fileId: id, text: long, acceptWarnings: true, baseVersion: 1, reason: "grow" });
  assert.equal(accepted.n, 2);
  assert.equal(accepted.lint.state, "amber");
  assert.equal(accepted.added, 150);
  assert.equal(accepted.removed, 0);
  assert.ok(k.events.some((e) => e.name === "file.version_added" && (e.payload as { n?: number }).n === 2));

  // a stale base version is the usual conflict; a clean save is one version
  await expectCode("validation.version_conflict", () => handlers["files.save"](k.ctx, { fileId: id, text: AGENT_MD, baseVersion: 1 }));
  const clean = await handlers["files.save"](k.ctx, { fileId: id, text: AGENT_MD, baseVersion: 2 });
  assert.deepEqual([clean.n, clean.added, clean.removed, clean.lint.state, clean.lint.problems.length], [3, 0, 150, "ok", 0]);
  const versions = await handlers["files.versions"](k.ctx, { fileId: id });
  assert.equal(versions.versions.length, 3);
  assert.equal((await handlers["files.read"](k.ctx, { fileId: id })).text, AGENT_MD);

  // a broken agent.toml is refused, the stored version stays
  const toml = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "agent.toml", content: { text: 'name = "A"' } })).file.fileId;
  await expectCode("validation.precondition_failed", () => handlers["files.save"](k.ctx, { fileId: toml, text: "name = A" }));
  assert.equal((await handlers["files.read"](k.ctx, { fileId: toml })).text, 'name = "A"');
  // the role line edit goes through the same save
  const role = await handlers["files.save"](k.ctx, { fileId: toml, text: 'name = "A"\ndescription = "Use me for intake."', reason: "role line" });
  assert.equal(role.n, 2);

  // other files and bad input
  const other = (await handlers["files.create"](k.ctx, { folderId: agentId, name: "notes.txt", content: { text: "x" } })).file.fileId;
  await expectCode("validation.precondition_failed", () => handlers["files.save"](k.ctx, { fileId: other, text: "y" }));
  await expectCode("validation.bad_input", () => handlers["files.save"](k.ctx, { fileId: id }));
  await expectCode("validation.bad_input", () => handlers["files.save"](k.ctx, { fileId: id, text: "x", baseVersion: 0 }));
});

test("files.share: the grant is access.share, once, with the file as the resource", async () => {
  const kit = open({ "access.share": { grant: { grantId: "grt_1" } } });
  const tree = await handlers["files.tree"](kit.ctx, {});
  const folderId = idOf(tree.roots.find((r) => r.key === "personal")?.folderId, "personal");
  const fid = (await handlers["files.create"](kit.ctx, { folderId, name: "a.txt", content: { text: "x" } })).file.fileId;
  const res = await handlers["files.share"](kit.ctx, { fileId: fid, subject: { kind: "person", id: "per_sam" }, level: "edit" });
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(kit.calls, [{ cap: "access.share", input: { idempotencyKey: `files.share:${fid}:person:per_sam:edit`, resource: { type: "file", id: fid }, subject: { kind: "person", id: "per_sam" }, level: "edit" } }]);
  await expectCode("validation.not_found", () => handlers["files.share"](kit.ctx, { fileId: "fil_none", subject: { kind: "person", id: "per_sam" }, level: "view" }));
  await expectCode("validation.bad_input", () => handlers["files.share"](kit.ctx, { fileId: fid, level: "view" }));
});
