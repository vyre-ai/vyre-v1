// The Local folders step on the desktop: Add folder opens the system dialog and the pick is mounted at once through mounts.add (Adding, then Added, or Retry); removing an Added row unmounts it; Continue only moves on.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press } from "./test-dom.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { FoldersCard } from "./FoldersCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

async function open(opts: { failMount?: boolean | "once"; picks?: string[] } = {}) {
  installDom();
  const calls: { cap: string; input: unknown }[] = [];
  const steps: string[] = [];
  const dialogs: unknown[] = [];
  const call = (async (cap: string, input?: unknown) => {
    calls.push({ cap, input });
    if (cap === "devices.mine") return { devices: [{ id: "dev_1", name: "This Mac", class: "desktop", current: true }] };
    if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_top", count: 0 }] };
    if (cap === "files.list") return { folders: [] };
    if (cap === "mounts.add" && opts.failMount === true) throw new Error("no");
    if (cap === "mounts.add" && opts.failMount === "once" && calls.filter((c) => c.cap === "mounts.add").length === 1) throw new Error("no");
    if (cap === "mounts.add") return { mountId: "mnt_1", folderId: "fld_m", runId: "run_1" };
    return {};
  }) as unknown as CapCall;
  const invoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => { dialogs.push({ cmd, args }); return opts.picks ?? ["/Users/maya/code/site"]; };
  const r = createRoot();
  await act(async () => {
    r.render(
      <OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done", interview: "done", sessions: "done" }} stepKey="folders" device="mac" onStep={(k, st) => { steps.push(`${k}:${st}`); }} onClose={() => undefined}
        renderCard={(card, ctx) => card === "local_folders" ? <FoldersCard call={call} gate={ctx.gate} invoke={invoke} /> : null} />,
    );
  });
  await flush();
  return { calls, steps, dialogs, root: r.container as never };
}
const adds = (calls: { cap: string; input: unknown }[]) => calls.filter((c) => c.cap === "mounts.add");

test("Add folder opens the folder dialog and mounts the pick at once, live only, into Personal", async () => {
  const t = await open();
  await press(find(t.root, "folders-add"));
  await flush();
  assert.deepEqual(t.dialogs, [{ cmd: "pick_paths", args: { options: { title: "Choose a folder", multiple: false, directory: true, filters: [] } } }]);
  assert.ok(find(t.root, "folder-row-0"), "the picked folder is a row");
  assert.deepEqual(adds(t.calls).map((c) => c.input), [{ into: "fld_top", source: { kind: "local", deviceId: "dev_1", localPath: "/Users/maya/code/site" }, name: "site", mode: "live_only", idempotencyKey: "mount:local:/Users/maya/code/site:fld_top" }]);
  assert.ok(find(t.root, "folder-status-0"), "the row says it is added");
  assert.equal(find(t.root, "folder-retry-0"), null);
  assert.deepEqual(t.steps, [], "picking does not move the step on");
});

test("Continue only moves the step on once a folder is added", async () => {
  const t = await open();
  await press(find(t.root, "step-next"));
  await flush();
  assert.deepEqual(t.steps, [], "held with none added");
  await press(find(t.root, "folders-add"));
  await flush();
  const before = adds(t.calls).length;
  await press(find(t.root, "step-next"));
  await flush();
  assert.equal(adds(t.calls).length, before, "Continue mounts nothing");
  assert.deepEqual(t.steps, ["folders:done"]);
});

test("a failed mount shows the error, keeps the row with Retry, and Retry mounts it", async () => {
  const t = await open({ failMount: "once" });
  await press(find(t.root, "folders-add"));
  await flush();
  assert.ok(find(t.root, "folders-error"), "the error shows");
  assert.ok(find(t.root, "folder-row-0"), "the folder stays to try again");
  assert.equal(find(t.root, "folder-status-0"), null, "not shown as added");
  await press(find(t.root, "step-next"));
  await flush();
  assert.deepEqual(t.steps, [], "a failed folder does not let Continue through");
  await press(find(t.root, "folder-retry-0"));
  await flush();
  assert.equal(adds(t.calls).length, 2);
  assert.ok(find(t.root, "folder-status-0"), "added after the retry");
  assert.equal(find(t.root, "folders-error"), null);
});

test("a folder that always fails stays failed", async () => {
  const t = await open({ failMount: true });
  await press(find(t.root, "folders-add"));
  await flush();
  await press(find(t.root, "folder-retry-0"));
  await flush();
  assert.ok(find(t.root, "folders-error"));
  assert.ok(find(t.root, "folder-retry-0"));
});

test("removing an Added row unmounts it; removing a failed row only drops it", async () => {
  const t = await open();
  await press(find(t.root, "folders-add"));
  await flush();
  await press(find(t.root, "folder-remove-0"));
  await flush();
  assert.deepEqual(t.calls.filter((c) => c.cap === "mounts.remove").map((c) => c.input), [{ mountId: "mnt_1", keepCopy: false }]);
  assert.equal(find(t.root, "folder-row-0"), null, "the row is gone");
  const f = await open({ failMount: true });
  await press(find(f.root, "folders-add"));
  await flush();
  await press(find(f.root, "folder-remove-0"));
  await flush();
  assert.equal(f.calls.filter((c) => c.cap === "mounts.remove").length, 0, "nothing was mounted, nothing to unmount");
  assert.equal(find(f.root, "folder-row-0"), null);
});
