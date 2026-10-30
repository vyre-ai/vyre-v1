// The organisation step saves on Continue: the click path through the real screen and the real card, with a recording caller.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { KitPickCard } from "./KitPickCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// react-native-web wants a browser: it reads window and listens on its host nodes. The test renderer has neither, so give it the two stand-ins it asks for.
(globalThis as { window?: unknown }).window ??= globalThis;
(globalThis as { Image?: unknown }).Image ??= class { onload: unknown; onerror: unknown; set src(_v: string) { /* never loads */ } };
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ style: {}, setAttribute: () => undefined, appendChild: () => undefined }), head: { appendChild: () => undefined }, getElementById: () => null, documentElement: { getAttribute: () => null, setAttribute: () => undefined, style: {} }, addEventListener: () => undefined };
Object.defineProperty(Object.prototype, "addEventListener", { value: () => undefined, configurable: true, enumerable: false, writable: true });
Object.defineProperty(Object.prototype, "removeEventListener", { value: () => undefined, configurable: true, enumerable: false, writable: true });

interface Node { props: Record<string, unknown>; children?: Node[] }
const find = (n: Node, id: string): Node | null => {
  if (n.props?.["data-testid"] === id || n.props?.testID === id) return n;
  for (const c of n.children ?? []) { if (typeof c === "object") { const f = find(c as Node, id); if (f) return f; } }
  return null;
};

function setup(opts: { failUpdate?: boolean } = {}) {
  const calls: { cap: string; input: unknown }[] = [];
  const steps: string[] = [];
  const call = (async (cap: string, input?: unknown) => {
    calls.push({ cap, input });
    if (cap === "kits.list") return { kits: [{ kitId: "kit_a", title: "Studio", installed: false }] };
    if (cap === "kits.install_sheet") return { sheet: { tools: [], recordTypes: [], networkDomains: [], vaultNames: [], scripts: 0, problems: [] } };
    if (cap === "spaces.update" && opts.failUpdate) throw new Error("no");
    return {};
  }) as unknown as CapCall;
  const screen = (progress: Record<string, "done" | "later">): ReactElement => (
    <OnboardingScreen flow="team" spaceName="Northwind" progress={progress} stepKey="org" device="mac"
      onStep={(k, st) => { steps.push(`${k}:${st}`); }} onClose={() => undefined}
      renderCard={(card, ctx) => card === "org" ? <KitPickCard call={call} spaceName="Northwind" gate={ctx.gate} onInstalled={() => undefined} /> : null} />
  );
  return { calls, steps, screen };
}
const press = async (n: Node | null): Promise<void> => { assert.ok(n, "node present"); await act(async () => { (n!.props.onClick as (e: unknown) => void)({ stopPropagation() {}, preventDefault() {}, altKey: false, target: { getAttribute: () => null }, currentTarget: { getAttribute: () => null }, nativeEvent: {} }); }); };
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };

const typeName = async (root: Node, value: string): Promise<void> => {
  await act(async () => { (find(root, "org-name")!.props.onChange as (e: unknown) => void)({ target: { value }, nativeEvent: { text: value }, currentTarget: { value } }); });
};
async function open(opts: { failUpdate?: boolean } = {}) {
  const t = setup(opts);
  const r = createRoot();
  await act(async () => { r.render(t.screen({})); });
  await flush();
  return { t, root: r.container as unknown as Node };
}
const caps = (t: ReturnType<typeof setup>): string[] => t.calls.map((c) => c.cap).filter((c) => c === "spaces.update" || c.startsWith("kits.install") && c !== "kits.install_sheet" || c === "kits.choose");

test("Continue saves the changed name, installs nothing on Start blank, and moves the step on", async () => {
  const { t, root } = await open();
  await typeName(root, "Acme");
  await press(find(root, "step-next"));
  await flush();
  const update = t.calls.find((c) => c.cap === "spaces.update");
  assert.deepEqual(update?.input, { name: "Acme", logoFileId: null });
  assert.deepEqual(caps(t), ["spaces.update"], "Start blank installs nothing");
  assert.deepEqual(t.steps, ["org:done"], "the step is marked done");
});

test("Continue installs the picked Kit after the name, then moves on", async () => {
  const { t, root } = await open();
  await press(find(root, "kit-kit_a"));
  await flush();
  await typeName(root, "Acme");
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(caps(t), ["spaces.update", "kits.install", "kits.choose"]);
  assert.deepEqual(t.steps, ["org:done"]);
});

test("a failed save shows the error and stays on the step", async () => {
  const { t, root } = await open({ failUpdate: true });
  await typeName(root, "Acme");
  await press(find(root, "step-next"));
  await flush();
  assert.ok(find(root, "kit-error"), "the error shows");
  assert.deepEqual(t.steps, [], "the step is not marked done");
});

test("Continue does nothing while the name is empty", async () => {
  const { t, root } = await open();
  await typeName(root, "   ");
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(caps(t), [], "nothing was saved");
  assert.deepEqual(t.steps, []);
});
