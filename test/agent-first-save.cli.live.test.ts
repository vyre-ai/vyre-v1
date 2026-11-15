// F93 (16 Nov 2026, the owner's own Space): an Assistant asked to "put this table in a file in my files" had its first two saves refused and the third went through. The agent here is an Assistant on a CLI engine
// (the fake claude of host/tests/fixtures/fake-cli-driver, through the real MCP session and the real tool layer), asked for a 12 KB Markdown table of 42 rows with no folder named. Every way a model writes
// the first call works: the folder left out, a folder or a path by name, the text as `content`, `content.text` or `text`, a name with a date and brackets, a name that is taken. A call that cannot work says
// in one plain sentence what to change. Cause: files_create needs a folder id no description gives a model, and nothing the model can know leads to one (agent/src/tools/place.ts).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, makeAgent, post, seededDir } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };
let k = 0;
const c = (d: Daemon, cap: string, input: Record<string, unknown>) =>
  call(d, cap, { idempotencyKey: `fs-${cap}-${++k}`, ...input });

/** A Markdown table of `rows` applicants, about 12 KB at 42 rows. */
const table = (rows: number): string =>
  [
    "| Rank | Applicant | Score | Notes |",
    "| --- | --- | --- | --- |",
    ...Array.from(
      { length: rows },
      (_, i) =>
        `| ${i + 1} | Applicant ${i + 1} | ${90 - i} | ${"Strong written answers and a clear plan for the first month. ".repeat(5).trim()} |`,
    ),
  ].join("\n");

test(
  "an Assistant's first save of a 12 KB table works however the call is written, and a call that cannot work says what to change",
  { timeout: 280_000 },
  async () => {
    const d = await boot(seededDir(), null, { engineCli: cli });
    try {
      await connect(d);
      const agent = await makeAgent(d, "Assistant");
      const thread = (await c(d, "chat.start", { kind: "chat", agentIds: [agent] })).data.thread.threadId as string;
      await c(d, "threads.set_mode", { threadId: thread, mode: "auto" });
      const body = table(42);
      assert.ok(body.length >= 12_000 && body.length < 20_000, `a 12 KB table: ${body.length}`);
      const tryIt = (tool: string, input: unknown) =>
        post(d, thread, agent, `tool ${tool} ${JSON.stringify(input)}`, `fs-${++k}`);
      const idOf = (r: string): string => /"fileId":"(fil_[a-z0-9]+)"/.exec(r)?.[1] ?? "";
      const root = (await c(d, "files.resolve", { path: "Personal" })).data.folderId as string;
      const readText = async (fileId: string) => String((await c(d, "files.read", { fileId, as: "text" })).data.text);
      const inRoot = async () =>
        ((await c(d, "files.list", { folder: root })).data.files as Array<{ name: string; fileId: string }>).map(
          (f) => f.name,
        );

      // the call a model writes first: a name with a date and brackets, the text in content.text, no folder
      const name = "FDE applicants - ranked shortlist (15 Nov 2026).md";
      const first = await tryIt("files_create", { name, content: { text: body } });
      assert.match(first, /files_create answered/, first.slice(0, 400));
      assert.equal(await readText(idOf(first)), body, "the whole table is in the file");
      assert.ok((await inRoot()).includes(name), "the file is in the person's own files");

      // the text written as `text`, as `content` and as `{ text }` of a path, a folder by name, a date with slashes
      for (const [n, input] of [
        ["b.md", { name: "b.md", text: body }],
        ["c.md", { name: "c.md", content: body }],
        ["d.md", { path: "Personal/d.md", content: { text: body } }],
        ["e.md", { folder: "Personal", name: "e.md", content: { text: body } }],
        ["list 15-11-2026.md", { name: "list 15/11/2026.md", content: { text: body } }],
        ["f.md", { folderId: "Personal", name: "f.md", content: { text: body } }],
      ] as Array<[string, Record<string, unknown>]>) {
        const r = await tryIt("files_create", input);
        assert.match(r, /files_create answered/, `${n}: ${r.slice(0, 400)}`);
        assert.equal(await readText(idOf(r)), body, n);
        assert.ok((await inRoot()).includes(n), `${n} is in the person's own files`);
      }

      // a path with folders: they are made
      const nested = await tryIt("files_create", { path: "Reports/2026/plan.md", content: { text: "# Plan" } });
      assert.match(nested, /files_create answered/, nested.slice(0, 400));
      const found = await c(d, "files.resolve", { path: "Personal/Reports/2026/plan.md" });
      assert.equal(found.data.kind, "file");

      // a name that is taken: the new file is "name (2)", the first file is untouched, the answer says the name
      const again = await tryIt("files_create", { name, content: { text: "second" } });
      assert.match(again, /files_create answered/, again.slice(0, 400));
      assert.match(again, /ranked shortlist \(15 Nov 2026\) \(2\)\.md/);
      assert.equal(await readText(idOf(first)), body, "the first file is untouched");

      // a write by path: found and replaced
      const wrote = await tryIt("files_write", { path: "b.md", content: { text: "new words" } });
      assert.match(wrote, /files_write answered/, wrote.slice(0, 400));
      assert.equal(await readText((await c(d, "files.resolve", { path: "Personal/b.md" })).data.fileId), "new words");

      // a write to a path nothing is at: one plain sentence that says what to call
      const none = await tryIt("files_write", { path: "nothing-here.md", content: { text: "x" } });
      assert.match(none, /files_write refused/);
      assert.match(none, /files_create/);
      assert.match(none, /no file at that path/);
      assert.ok(!/\b(?:fil|fld)_[a-z0-9]+/.test(none), "no id in the sentence");
      assert.ok(!(await inRoot()).includes("nothing-here.md"), "nothing was made by a write");
    } finally {
      await d.stop();
    }
  },
);
