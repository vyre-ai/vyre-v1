// The Artifacts page menu: right-click a card (or its ... button) gives Open, Share, Copy link, Rename and Delete for the owner and Open and Copy link for anyone else; Rename and Delete reach sites.update and
// sites.delete, and Delete asks first.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, typeInto } from "../../../onboarding/test-dom.ts";
import type { Node } from "../../../onboarding/test-dom.ts";
import { act } from "react";
import { ArtifactsPage } from "../mounts/ArtifactsPage.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";

const rightClick = async (root: Node, rowId: string): Promise<void> => {
  const row = find(root, rowId);
  assert.ok(row, rowId);
  await act(async () => { (row.props["onContextMenu"] as (e: unknown) => void)({ preventDefault() {}, clientX: 10, clientY: 10, nativeEvent: {} }); });
  await flush();
};
const labels = (root: Node): string[] => { const out: string[] = []; const walk = (n: Node | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string" && t.startsWith("menu-item-")) out.push(t.slice("menu-item-".length)); for (const c of n.children ?? []) walk(c); }; walk(root); return out.filter((x) => x !== "report"); };

function scripted(): { rt: ShellRuntime; calls: { cap: string; input: Record<string, unknown> }[] } {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let sites = [
    { siteId: "sit_a", name: "Intake funnel", kind: "artifact", owner: "usr_me", state: "ready", updatedAt: 1 },
    { siteId: "sit_b", name: "Rivera timeline", kind: "artifact", owner: "usr_dana", state: "ready", updatedAt: 1 },
  ];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    if (cap === "sites.list") return { sites };
    if (cap === "sites.update") { sites = sites.map((s) => (s.siteId === i["siteId"] ? { ...s, name: String(i["name"]) } : s)); return {}; }
    if (cap === "sites.delete") { sites = sites.filter((s) => s.siteId !== i["siteId"]); return { deleted: true }; }
    return {};
  };
  const rt = { call, me: { id: "usr_me", name: "Irfad" }, space: { id: "s", kind: "team", name: "MLA" }, open: () => undefined, clock: () => ({ now: 1_762_000_000_000 }), principals: { getSnapshot: () => ({ status: "ready", data: [{ id: "usr_dana", name: "Dana", kind: "person" }] }), subscribe: () => () => undefined } } as unknown as ShellRuntime;
  return { rt, calls };
}

test("the owner's artifact has Open, Share, Copy link, Rename and Delete; someone else's has Open and Copy link", async () => {
  installDom();
  const { rt } = scripted();
  const root = await mount(createRoot, <ArtifactsPage rt={rt} />);
  await flush();
  await rightClick(root, "artifact-card-sit_a");
  await flush();
  assert.deepEqual(labels(root), ["Open", "Share…", "Copy link", "Rename…", "Delete…"]);
  await press(find(root, "menu-item-Copy link"));
  await flush();
  await press(find(root, "artifacts-filter"));
  await flush();
  const all = ((): Node | null => { let hit: Node | null = null; const walk = (n: Node | string): void => { if (typeof n === "string" || hit) return; const t = n.props["data-testid"]; if (typeof t === "string" && /^menu-item-\s*All$/.test(t) && typeof n.props["onClick"] === "function") hit = n; for (const c of n.children ?? []) walk(c); }; walk(root); return hit; })();
  await press(all);
  await flush();
  await rightClick(root, "artifact-card-sit_b");
  await flush();
  assert.deepEqual(labels(root), ["Open", "Copy link"]);
});

test("Delete asks first, then calls sites.delete; Rename calls sites.update with the new name", async () => {
  installDom();
  const { rt, calls } = scripted();
  const root = await mount(createRoot, <ArtifactsPage rt={rt} />);
  await flush();
  await rightClick(root, "artifact-card-sit_a");
  await flush();
  await press(find(root, "menu-item-Rename…"));
  await flush();
  const field = find(root, "text-ask-field");
  assert.ok(field);
  await typeInto(field, "Intake funnel v2");
  await press(find(root, "text-ask-go"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "sites.update").map((c) => c.input), [{ siteId: "sit_a", name: "Intake funnel v2" }]);

  await rightClick(root, "artifact-card-sit_a");
  await flush();
  await press(find(root, "menu-item-Delete…"));
  await flush();
  assert.equal(calls.filter((c) => c.cap === "sites.delete").length, 0, "nothing is deleted until it is confirmed");
  assert.ok(find(root, "artifact-card-sit_a-sure"), "the card asks first");
  await press(find(root, "artifact-card-sit_a-delete"));
  await flush();
  assert.deepEqual(calls.filter((c) => c.cap === "sites.delete").map((c) => c.input), [{ siteId: "sit_a" }]);
});

test("the card's own ... button opens the same menu as a right-click", async () => {
  installDom();
  const { rt } = scripted();
  const root = await mount(createRoot, <ArtifactsPage rt={rt} />);
  await flush();
  await press(find(root, "artifact-card-sit_a-more"));
  await flush();
  assert.deepEqual(labels(root), ["Open", "Share…", "Copy link", "Rename…", "Delete…"]);
});
