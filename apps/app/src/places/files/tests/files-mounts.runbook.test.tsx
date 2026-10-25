// Files > Runbooks (P-L9e_04): the runbook viewer over the sample note "Deploy website.md". The sample shell prints a line per tick, so the tests step it and read what the
// live queries (runbooks.parse, runs.list, runs.get, targets) return, then render the viewer from the same replica.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RunbookDataProvider, RunbookViewer, SERVER, activeAll, allSummary, highlight, latestByBlock, outputText, parseRunnable, progressLine, runBlock, runAll, runLabel, setTarget, splitRunbook, stopRun,
} from "../runbook/index.ts";
import { DEPLOY_TEXT, NOTE_ID, createSampleRunbook } from "../runbook/sample.ts";
import type { SampleRunbook, Variant } from "../runbook/sample.ts";

const html = (s: SampleRunbook): string =>
  renderToStaticMarkup(<RunbookDataProvider value={s.data}><RunbookViewer fileId={s.fileId} text={s.text} /></RunbookDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const make = (v: Variant): SampleRunbook => createSampleRunbook(v);
const target = { kind: "computer" as const, computerId: "cmp_intake" };

test("the note splits at its fenced blocks: four runnable sh blocks in order, other fenced code stays plain", () => {
  const seg = splitRunbook(DEPLOY_TEXT);
  const code = seg.filter((x) => x.kind === "code");
  assert.equal(code.length, 4);
  assert.deepEqual(code.map((x) => (x.kind === "code" ? x.runIndex : -1)), [0, 1, 2, 3]);
  const mixed = splitRunbook("Intro\n\n```json\n{\"a\": 1}\n```\n\n```bash\nls\n```\n");
  assert.deepEqual(mixed.filter((x) => x.kind === "code").map((x) => (x.kind === "code" ? [x.lang, x.runIndex] : [])), [["json", null], ["bash", 0]]);
});

test("block ids are stable for the same code and change when the code changes", () => {
  const a = parseRunnable(DEPLOY_TEXT);
  const b = parseRunnable(DEPLOY_TEXT);
  assert.deepEqual(a.map((x) => x.blockId), b.map((x) => x.blockId));
  assert.match(a[0]?.blockId ?? "", /^b0_[0-9a-f]{4}$/);
  const edited = parseRunnable(DEPLOY_TEXT.replace("git pull origin main", "git pull origin release"));
  assert.notEqual(edited[0]?.blockId, a[0]?.blockId);
  assert.equal(edited[1]?.blockId, a[1]?.blockId, "an edit in one block leaves the others' ids alone");
  assert.equal(a[0]?.line, 7, "line of the opening fence");
});

test("command lines colour the first command, quoted strings and comments", () => {
  assert.deepEqual(highlight("git pull origin main"), [{ text: "git", kind: "k" }, { text: " pull origin main", kind: "t" }]);
  assert.deepEqual(highlight("echo \"hi there\" # note"), [{ text: "echo", kind: "k" }, { text: " ", kind: "t" }, { text: "\"hi there\"", kind: "s" }, { text: " ", kind: "t" }, { text: "# note", kind: "c" }]);
  assert.deepEqual(highlight("# only a comment"), [{ text: "# only a comment", kind: "c" }]);
  assert.deepEqual(highlight(""), []);
});

test("Run all goes top to bottom, in document order, and every block finishes with exit 0", async () => {
  const s = make("fresh");
  const order = s.blocks().map((b) => b.blockId);
  const r = await runAll(s.data.call, { fileId: NOTE_ID, target: SERVER, at: 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(s.calls.map((c) => c.cap), ["runbooks.run"]);
  assert.equal((s.calls[0]?.input as { all?: boolean }).all, true);
  const seen: string[] = [];
  while (s.tick()) {
    const run = s.runs()[0]!;
    const running = run.blocks.find((b) => b.state === "running")?.blockId;
    if (running && seen.at(-1) !== running) seen.push(running);
  }
  assert.deepEqual(seen, order, "each block ran once, in order");
  const run = s.runs()[0]!;
  assert.equal(run.state, "succeeded");
  assert.equal(run.exit, 0);
  assert.deepEqual(run.blocks.map((b) => b.state), ["succeeded", "succeeded", "succeeded", "succeeded"]);
  assert.equal(allSummary(run, order, "Space server"), "Ran 4 blocks on Space server. All finished with exit 0.");
  assert.equal(runLabel(run, order), "Run all");
});

test("Run all on an agent's computer stops at the first error: block 2 exits 127 and blocks 3 and 4 never run", async () => {
  const s = make("fresh");
  const order = s.blocks().map((b) => b.blockId);
  assert.deepEqual(await setTarget(s.data.call, NOTE_ID, target), { ok: true });
  await runAll(s.data.call, { fileId: NOTE_ID, target, at: 2 });
  s.drain();
  const run = s.runs()[0]!;
  assert.equal(run.state, "failed");
  assert.equal(run.exit, 127);
  assert.deepEqual(run.blocks.map((b) => b.state), ["succeeded", "failed", "stopped", "stopped"]);
  assert.equal(run.blocks[1]?.exit, 127);
  assert.equal(run.blocks[2]?.exit, undefined);
  assert.equal(allSummary(run, order, "Intake's computer"), "Stopped at block 2. It exited with 127, so the blocks after it did not run.");
  assert.equal(runLabel(run, order), "Run all · stopped at block 2");
  const printed = new Set((s.replica.rows("out") as unknown as { blockId: string }[]).map((x) => x.blockId));
  assert.deepEqual([...printed], [order[0], order[1]], "nothing was printed for the blocks after the failure");
});

test("one block runs on its own; Stop ends it with exit 130 and says so in its output", async () => {
  const s = make("fresh");
  const second = s.blocks()[1]!;
  const r = await runBlock(s.data.call, { fileId: NOTE_ID, blockId: second.blockId, target: SERVER, at: 3 });
  assert.ok(r.ok && r.runId);
  s.tick(); s.tick();
  const mid = s.runs()[0]!;
  assert.equal(mid.all, false);
  assert.equal(mid.state, "running");
  assert.equal(activeAll(s.runs()), undefined, "a single block is not a Run all");
  assert.deepEqual(await stopRun(s.data.call, mid.runId), { ok: true });
  const done = s.runs()[0]!;
  assert.equal(done.state, "stopped");
  assert.equal(done.exit, 130);
  const out = (s.replica.rows("out") as unknown as { blockId: string; seq: number; stream: "stdout" | "stderr"; text: string }[]).sort((a, b) => a.seq - b.seq);
  assert.equal(outputText(out, second.blockId).split("\n").at(-1), "^C");
  assert.equal(latestByBlock(s.runs()).get(second.blockId)?.exit, 130);
});

test("only one thing runs at a time, and a failed call becomes words", async () => {
  const s = make("running");
  const b = s.blocks()[0]!;
  const busy = await runBlock(s.data.call, { fileId: NOTE_ID, blockId: b.blockId, target: SERVER, at: 4 });
  assert.deepEqual(busy, { ok: false, error: "Something is already running. Wait for it, or stop it first." });
  const s2 = make("fresh");
  s2.failNext("runbooks.run", "permission.needs_team");
  assert.deepEqual(await runAll(s2.data.call, { fileId: NOTE_ID, target: SERVER, at: 5 }), { ok: false, error: "Running commands needs a Team Space." });
  s2.failNext("runbooks.set_target", "x");
  assert.deepEqual(await setTarget(s2.data.call, NOTE_ID, target), { ok: false, error: "Could not change where this runs." });
});

test("fresh note: the Runs on bar names the Space server, Run all is ready, each of the four blocks has a Run button, and there is no Runs list", () => {
  const out = html(make("fresh"));
  assert.ok(has(out, "Runs on") && has(out, "Space server") && has(out, 'data-testid="runbook-run-all"'));
  const ids = parseRunnable(DEPLOY_TEXT).map((b) => b.blockId);
  for (const id of ids) assert.ok(has(out, `data-testid="run-${id}"`), `Run button for ${id}`);
  assert.ok(has(out, "Deploy website") && has(out, "1. Get the latest code") && has(out, "git"));
  assert.ok(!has(out, 'data-testid="runbook-runs"') && !has(out, "output-b0_"), "nothing has run yet");
  assert.ok(!has(out, 'data-testid="runbook-summary"'));
});

test("ran note: output under every block with Exit 0 and a time, and the Runs list holds both runs newest first", () => {
  const s = make("ran");
  const out = html(s);
  const ids = s.blocks().map((b) => b.blockId);
  for (const id of ids) assert.ok(has(out, `data-testid="output-${id}"`), `output of ${id}`);
  assert.ok(has(out, "Exit 0") && has(out, "14.2 s") && has(out, "Already up to date.") && has(out, "Compiled successfully"));
  assert.ok(has(out, "Ran 4 blocks on Space server. All finished with exit 0."));
  const first = out.indexOf('data-testid="row-run:run_2"');
  const second = out.indexOf('data-testid="row-run:run_1"');
  assert.ok(first > 0 && second > first, "the Docs run (newest) is above the Intake run");
  assert.ok(has(out, "Run all · stopped at block 2") && has(out, "Intake&#x27;s computer · exit 127"));
  assert.ok(has(out, 'data-testid="row-run:run_1-leading"') && has(out, 'data-testid="row-run:run_1-trailing"'), "Runs rows are ui/Row with their slots");
});

test("failed Run all: the bar shows the computer, block 2 reads Exit 127 in the danger colour, blocks 3 and 4 say Did not run, the summary says where it stopped", () => {
  const out = html(make("fail"));
  assert.ok(has(out, "Intake&#x27;s computer") && has(out, "Exit 127") && has(out, "zsh: command not found: npm"));
  assert.equal(out.split("Did not run").length - 1, 2);
  assert.ok(has(out, 'data-testid="runbook-summary"') && has(out, "Stopped at block 2. It exited with 127, so the blocks after it did not run."));
});

test("running Run all: the button reads Stop with the block it is on, the running block has a spinner and a Stop button, later blocks wait", () => {
  const s = make("running");
  const out = html(s);
  const order = s.blocks().map((b) => b.blockId);
  assert.ok(has(out, "Stop · block 2 of 4") && has(out, 'data-testid="runbook-stop-all"') && !has(out, 'data-testid="runbook-run-all"'));
  assert.equal(progressLine(s.runs()[0]!, order), "Stop · block 2 of 4");
  assert.ok(has(out, 'data-testid="spinner"') && has(out, "Running") && has(out, "Waiting"));
  assert.ok(has(out, `aria-label="Stop"`));
});

test("choosing where it runs is saved with the file and the bar follows", async () => {
  const s = make("fresh");
  assert.ok(!has(html(s), "Intake&#x27;s computer"));
  await setTarget(s.data.call, NOTE_ID, target);
  assert.deepEqual(s.calls.at(-1), { cap: "runbooks.set_target", input: { fileId: NOTE_ID, target } });
  assert.ok(has(html(s), "Intake&#x27;s computer"));
});

test("a note with no shell blocks says so and draws no bar", () => {
  const s = createSampleRunbook("fresh", { text: "# Notes\n\nNothing to run here.\n" });
  const out = html(s);
  assert.ok(has(out, "No shell blocks in this file") && !has(out, 'data-testid="runbook-bar"') && has(out, "Nothing to run here."));
});
