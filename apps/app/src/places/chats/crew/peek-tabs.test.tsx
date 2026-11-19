// The helper's pane as a session with tabs (lane r42-subagents, 19 Nov 2026, prototype sub42): Transcript, Files when it touched any, Details; only the open tab shows, the others stay mounted so nothing is read
// twice and a half-typed model change survives a look at another tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { CrewPeek } from "./pane.tsx";
import type { CrewMember } from "./model.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "helper",
    id: "thr_a",
    parentThreadId: "thr_0",
    title: "Server fixes",
    name: "Tess",
    agentId: "agt_tess",
    state: "done",
    found: "74 tests pass",
    startedAt: 1_000,
    endedAt: 9_000,
    elapsedMs: 8_000,
    tokensIn: 4_000,
    tokensOut: 900,
    costMicros: 30_000,
    ...o,
  }) as CrewMember;
const call = async (cap: string): Promise<unknown> => (cap === "chat.helper.notes" ? { notes: [] } : {});
const view = (member: CrewMember) =>
  mount(
    createRoot,
    <CrewPeek
      member={member}
      call={call}
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
const shown = (root: Awaited<ReturnType<typeof view>>, tab: string): boolean => {
  const p = find(root, `crew-peek-panel-${tab}`);
  assert.ok(p, `panel ${tab} exists`);
  // the web layer gives a hidden (display: none) panel one more class than a shown one
  return !/r-display/.test(String(p.props.className ?? ""));
};

test("a helper with no files has two tabs, Transcript and Details; it opens on Transcript", async () => {
  const root = await view(M());
  assert.ok(find(root, "crew-peek-tab-transcript") && find(root, "crew-peek-tab-details"));
  assert.equal(find(root, "crew-peek-tab-files"), null);
  assert.deepEqual(
    ["transcript", "details"].map((t) => shown(root, t)),
    [true, false],
  );
  assert.match(textOf(find(root, "crew-peek-panel-transcript")), /74 tests pass/);
  assert.match(textOf(find(root, "crew-peek-panel-details")), /Cost and time/);
});

test("a helper that changed files gets a Files tab with the count, and pressing a tab shows that panel only", async () => {
  const root = await view(
    M({
      branch: "crew/tess",
      added: 86,
      deleted: 16,
      files: [
        { path: "a.yml", added: 5, deleted: 0 },
        { path: "b.sh", added: 81, deleted: 16 },
      ],
    }),
  );
  assert.match(textOf(find(root, "crew-peek-tab-files")), /Files\s*2/);
  await press(find(root, "crew-peek-tab-files"));
  assert.deepEqual(
    ["transcript", "files", "details"].map((t) => shown(root, t)),
    [false, true, false],
  );
  await press(find(root, "crew-peek-tab-details"));
  assert.deepEqual(
    ["transcript", "files", "details"].map((t) => shown(root, t)),
    [false, false, true],
  );
  await press(find(root, "crew-peek-tab-transcript"));
  assert.deepEqual(
    ["transcript", "files", "details"].map((t) => shown(root, t)),
    [true, false, false],
  );
});

test("a subagent of the engine has no model to change but keeps both tabs; the actions and the ask box stay under every tab", async () => {
  const root = await view(
    M({ kind: "subagent", state: "working", found: undefined as never, step: "Reading page.html" }),
  );
  assert.ok(find(root, "crew-peek-tab-details"));
  await flush();
  await press(find(root, "crew-peek-tab-details"));
  assert.equal(find(root, "crew-peek-model"), null);
});

test("a finished result becomes a task for the person looking: Make a task, a title to confirm, one tasks.create, and a second press cannot make another", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const rec = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    return cap === "chat.helper.notes" ? { notes: [] } : cap === "tasks.create" ? { taskId: "tsk_1" } : {};
  };
  const root = await mount(
    createRoot,
    <CrewPeek
      member={M({ found: "Harbor Supply fits best. It costs more up front." })}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await press(find(root, "crew-result-task"));
  assert.equal(find(root, "crew-result-task-title")?.props.value, "Follow up: Harbor Supply fits best");
  await press(find(root, "crew-result-task-cancel"));
  assert.equal(find(root, "crew-result-task-title"), null, "Cancel makes nothing");
  assert.equal(calls.filter((c) => c.cap === "tasks.create").length, 0);
  await press(find(root, "crew-result-task"));
  await press(find(root, "crew-result-task-go"));
  await flush();
  const made = calls.filter((c) => c.cap === "tasks.create");
  assert.equal(made.length, 1);
  assert.deepEqual(made[0]!.input.assigned, { kind: "person", id: "usr_me" });
  assert.deepEqual(made[0]!.input.source, { kind: "chat", id: "thr_0" });
  assert.equal(made[0]!.input.idempotencyKey, "helper-task-thr_a");
  assert.match(textOf(find(root, "crew-result-made")), /Task made:\s+Follow up: Harbor Supply fits best/);
  assert.equal(find(root, "crew-result-task"), null, "once made, the button is gone");
});

test("no Make a task without a person to give it to, and none while it still works or failed; a failing create says so and keeps the sheet", async () => {
  const none = await view(M());
  assert.equal(find(none, "crew-result-actions"), null);
  const rec = async (cap: string): Promise<unknown> => {
    if (cap === "tasks.create") throw new Error("down");
    return cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const working = await mount(
    createRoot,
    <CrewPeek
      member={M({ state: "working", found: undefined as never, step: "x" })}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  assert.equal(find(working, "crew-result-actions"), null);
  const root = await mount(
    createRoot,
    <CrewPeek
      member={M()}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await press(find(root, "crew-result-task"));
  await press(find(root, "crew-result-task-go"));
  await flush();
  assert.match(textOf(find(root, "crew-peek-error")), /could not be made/);
  assert.ok(find(root, "crew-result-task-title"), "the sheet stays so it can be tried again");
  assert.equal(find(root, "crew-result-made"), null);
});

test("Save to Files opens the folder picker, saves the result as a markdown file in the chosen folder once, and never into the top of Files", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const rec = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "files.list") return { folders: [{ folderId: "fld_bids", name: "Bids" }] };
    if (cap === "files.create") return { file: { fileId: "fil_1", folderId: "fld_bids", name: "Tess result.md" } };
    return cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const root = await mount(
    createRoot,
    <CrewPeek
      member={M()}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await press(find(root, "crew-result-file"));
  await flush();
  assert.ok(find(root, "folder-move"), "the shared folder picker opens");
  await press(find(root, "folder-move-go"));
  await flush();
  assert.equal(calls.filter((c) => c.cap === "files.create").length, 0, "the top of Files holds no file");
  assert.match(textOf(find(root, "crew-peek-error")), /Pick a folder/);
  await press(find(root, "folder-move-fld_bids"));
  await flush();
  await press(find(root, "folder-move-go"));
  await flush();
  const made = calls.filter((c) => c.cap === "files.create");
  assert.equal(made.length, 1);
  assert.deepEqual(
    [made[0]!.input.folderId, made[0]!.input.name, made[0]!.input.kind, made[0]!.input.idempotencyKey],
    ["fld_bids", "Tess result.md", "markdown", "helper-file-thr_a"],
  );
  assert.equal((made[0]!.input.content as { text: string }).text, "74 tests pass");
  assert.match(textOf(find(root, "crew-result-saved")), /Saved:\s+Tess result\.md/);
  assert.equal(find(root, "folder-move"), null, "the picker closes");
});

test("Add to a record searches records the way Cmd-K does, and the chosen one gets the result as a note with a link back to the chat, once", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const rec = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "search.recent.list")
      return {
        hits: [
          {
            kind: "record",
            id: "rec_harbor",
            title: "Harbor Supply",
            recordType: "supplier",
            link: "vyre://record/supplier/rec_harbor",
          },
        ],
      };
    if (cap === "records.comments.add") return { comment: { commentId: "c1" } };
    if (cap === "projects.files_folder") return { folderId: "fld_rec" };
    if (cap === "files.create") return { file: { fileId: "fil_r", folderId: "fld_rec", name: "Tess result.md" } };
    return cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const root = await mount(
    createRoot,
    <CrewPeek
      member={M()}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await press(find(root, "crew-result-record"));
  await flush();
  assert.ok(find(root, "record-picker"));
  assert.deepEqual(calls.find((c) => c.cap === "search.recent.list")?.input, { types: ["record"], limit: 12 });
  assert.equal(calls.filter((c) => c.cap === "records.comments.add").length, 0, "opening the picker writes nothing");
  await press(find(root, "record-pick-rec_harbor"));
  await flush();
  const added = calls.filter((c) => c.cap === "records.comments.add");
  assert.equal(added.length, 1);
  assert.deepEqual(
    [added[0]!.input.type, added[0]!.input.recordId, added[0]!.input.idempotencyKey],
    ["supplier", "rec_harbor", "helper-record-thr_a-rec_harbor"],
  );
  assert.match(String(added[0]!.input.text), /^74 tests pass\n\nFrom Tess in vyre:\/\/chat\/thr_0$/);
  assert.match(textOf(find(root, "crew-result-added")), /Added to\s+Harbor Supply/);
  // the result is also a file in the record's own Files folder, the one its Files tab shows, once
  assert.deepEqual(calls.find((c) => c.cap === "projects.files_folder")?.input, { type: "supplier", recordId: "rec_harbor" });
  const filed = calls.filter((c) => c.cap === "files.create");
  assert.equal(filed.length, 1);
  assert.deepEqual([filed[0]!.input.folderId, filed[0]!.input.name, filed[0]!.input.kind, filed[0]!.input.idempotencyKey], ["fld_rec", "Tess result.md", "markdown", "helper-recfile-thr_a-rec_harbor"]);
  assert.equal((filed[0]!.input.content as { text: string }).text, "74 tests pass");
  assert.equal(find(root, "record-picker"), null);
  assert.equal(find(root, "crew-result-record"), null, "once added, the button is gone");
});

test("a record that cannot take the note says so and the button stays; searching asks search.query for records only", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const rec = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "search.recent.list" || cap === "search.query")
      return {
        hits: [
          { kind: "record", id: "rec_a", title: "Pine Works", recordType: "supplier", link: "x" },
          { kind: "record", id: "x", title: "no type", link: "y" },
        ],
      };
    if (cap === "records.comments.add") throw new Error("no");
    return cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const root = await mount(
    createRoot,
    <CrewPeek
      member={M()}
      call={rec}
      meId="usr_me"
      onBack={() => undefined}
      onOpenChat={() => undefined}
      onRefresh={() => undefined}
    />,
  );
  await press(find(root, "crew-result-record"));
  await flush();
  assert.equal(find(root, "record-pick-x"), null, "a hit that is not a record is never offered");
  await typeInto(find(root, "record-picker-search"), "pine");
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "search.query")?.input, { q: "pine", types: ["record"], limit: 20 });
  await press(find(root, "record-pick-rec_a"));
  await flush();
  assert.match(textOf(find(root, "crew-peek-error")), /could not be added/);
  assert.ok(find(root, "crew-result-record"));
  assert.equal(find(root, "crew-result-added"), null);
});

test("when the record's folder cannot be made the note stays and the person is told the file was not saved", async () => {
  const rec = async (cap: string): Promise<unknown> => {
    if (cap === "search.recent.list") return { hits: [{ kind: "record", id: "rec_a", title: "Pine Works", recordType: "supplier", link: "x" }] };
    if (cap === "records.comments.add") return { comment: { commentId: "c" } };
    if (cap === "projects.files_folder") return { folderId: null };
    return cap === "chat.helper.notes" ? { notes: [] } : {};
  };
  const root = await mount(
    createRoot,
    <CrewPeek member={M()} call={rec} meId="usr_me" onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />,
  );
  await press(find(root, "crew-result-record"));
  await flush();
  await press(find(root, "record-pick-rec_a"));
  await flush();
  assert.match(textOf(find(root, "crew-result-added")), /Added to\s+Pine Works/);
  assert.match(textOf(find(root, "crew-peek-error")), /note was added, but the file could not be saved/);
});
