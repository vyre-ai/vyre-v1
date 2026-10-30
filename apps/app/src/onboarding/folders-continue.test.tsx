// The Local folders step on the desktop: Add folder opens the system dialog, the pick shows as a row, and Continue mounts it through mounts.add.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press } from "./test-dom.ts";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { FoldersCard } from "./FoldersCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

async function open(opts: { failMount?: boolean; picks?: string[] } = {}) {
  installDom();
  const calls: { cap: string; input: unknown }[] = [];
  const steps: string[] = [];
  const dialogs: unknown[] = [];
  const call = (async (cap: string, input?: unknown) => {
    calls.push({ cap, input });
    if (cap === "devices.mine") return { devices: [{ id: "dev_1", name: "This Mac", class: "desktop", current: true }] };
    if (cap === "files.list") return { folders: [{ folderId: "fld_top", name: "Files" }] };
    if (cap === "mounts.add" && opts.failMount) throw new Error("no");
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

test("Add folder opens the folder dialog and the pick shows as a row", async () => {
  const t = await open();
  await press(find(t.root, "folders-add"));
  await flush();
  assert.deepEqual(t.dialogs, [{ cmd: "pick_paths", args: { options: { title: "Choose a folder", multiple: false, directory: true, filters: [] } } }]);
  assert.ok(find(t.root, "folder-row-0"), "the picked folder is a row");
  assert.equal(adds(t.calls).length, 0, "nothing is mounted until Continue");
});

test("Continue mounts the picked folder on this computer and moves the step on", async () => {
  const t = await open();
  await press(find(t.root, "folders-add"));
  await flush();
  await press(find(t.root, "step-next"));
  await flush();
  assert.deepEqual(adds(t.calls).map((c) => c.input), [{ into: "fld_top", source: { kind: "local", deviceId: "dev_1", localPath: "/Users/maya/code/site" }, name: "site", mode: "live_only", idempotencyKey: "mount:local:/Users/maya/code/site:fld_top" }]);
  assert.deepEqual(t.steps, ["folders:done"]);
});

test("a failed mount shows the error, keeps the row and stays on the step", async () => {
  const t = await open({ failMount: true });
  await press(find(t.root, "folders-add"));
  await flush();
  await press(find(t.root, "step-next"));
  await flush();
  assert.ok(find(t.root, "folders-error"), "the error shows");
  assert.ok(find(t.root, "folder-row-0"), "the folder stays to try again");
  assert.deepEqual(t.steps, []);
});

test("a picked folder can be removed, and Continue is held with none picked", async () => {
  const t = await open();
  await press(find(t.root, "step-next"));
  await flush();
  assert.equal(adds(t.calls).length, 0, "Continue does nothing with no folder");
  assert.deepEqual(t.steps, []);
  await press(find(t.root, "folders-add"));
  await flush();
  await press(find(t.root, "folder-remove-0"));
  await flush();
  assert.equal(find(t.root, "folder-row-0"), null, "the row is gone");
  await press(find(t.root, "step-next"));
  await flush();
  assert.equal(adds(t.calls).length, 0);
});
