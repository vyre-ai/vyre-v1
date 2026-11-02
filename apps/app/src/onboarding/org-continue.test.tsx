// The organisation step saves on Continue: the click path through the real screen and the real card, with a recording caller.
import test from "node:test";
import assert from "node:assert/strict";
import { act, useState } from "react";
import { find, flush, installDom, press, textOf, typeInto } from "./test-dom.ts";
import type { Node } from "./test-dom.ts";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
import { KitPickCard } from "./KitPickCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

function setup(opts: { failUpdate?: boolean } = {}) {
  const calls: { cap: string; input: unknown }[] = [];
  const steps: string[] = [];
  const call = (async (cap: string, input?: unknown) => {
    calls.push({ cap, input });
    if (cap === "kits.list") return { kits: [{ kitId: "kit_a", key: "studio", title: "Studio", installed: true }, { kitId: "kit_h", key: "harbor-studio", title: "Harbor Studio", installed: false }] };
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

const typeName = (root: Node, value: string): Promise<void> => typeInto(find(root, "org-name"), value);
async function open(opts: { failUpdate?: boolean } = {}) {
  installDom();
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

test("Continue makes the picked Kit the Space's after the name, then moves on; a sample Kit is never offered", async () => {
  const { t, root } = await open();
  assert.equal(find(root, "row-kit-kit_h"), null, "Harbor Studio is a sample, not a choice");
  await press(find(root, "row-kit-kit_a"));
  await flush();
  await typeName(root, "Acme");
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(caps(t), ["spaces.update", "kits.choose"]);
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

test("the preview names the Space as it is typed, and never shows a raw Space id", async () => {
  installDom();
  const t = setup();
  const call = (async (cap: string) => (cap === "kits.list" ? { kits: [] } : {})) as unknown as CapCall;
  function Host(): ReactElement {
    const [typed, setTyped] = useState<string | null>(null);
    return <OnboardingScreen flow="team" spaceName={typed ?? "spc_2a7c98c337e1dfd2e05e1aab"} progress={{}} stepKey="org" device="mac" onStep={() => undefined} onClose={() => undefined}
      renderCard={(card, ctx) => card === "org" ? <KitPickCard call={call} spaceName="" onName={setTyped} gate={ctx.gate} onInstalled={() => undefined} /> : null} />;
  }
  void t;
  const r = createRoot();
  await act(async () => { r.render(<Host />); });
  await flush();
  const root = r.container as unknown as Node;
  assert.equal(textOf(find(root, "preview-space-name")).trim(), "Your Space");
  assert.ok(!textOf(root).includes("spc_"), "no raw id anywhere on the step");
  assert.equal(find(root, "kit-list"), null, "nothing installed on purpose: no kind of work to pick");
  assert.ok(textOf(find(root, "step-why")).includes("Name your Space first"), "Continue says what it needs");
  await typeName(root, "Acme");
  assert.equal(textOf(find(root, "preview-space-name")).trim(), "Acme");
  await typeName(root, "Acme Studio");
  assert.equal(textOf(find(root, "preview-space-name")).trim(), "Acme Studio");
});
