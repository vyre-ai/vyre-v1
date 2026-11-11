// The AI-account menu opened while the Space's accounts are still loading: it says Loading, and the real rows arrive in the same open menu, once.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom } from "../../../../../../ui/src/testing/dom.ts";
import { useAiRefill } from "./aiMenu.ts";
import { aiMenu } from "./aiMenu.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { PickRow } from "./pick.ts";

const credits: PickRow = { id: "prv_a", name: "Team credits", handle: "#Team_Credits", scope: "shared", state: "ok", uses: { automations: true } };
const labels = (e: readonly MenuEntry[]): string[] => e.flatMap((x) => ("label" in x ? [x.label] : []));

test("a menu opened while the accounts load is refilled in place when they arrive, and only that menu, only once", async () => {
  const restore = installDom();
  const sent: string[][] = [];
  let open: (() => MenuEntry[]) | null = null;
  function Probe({ rows }: { rows: readonly PickRow[] | null }) {
    const refill = useAiRefill((items) => { sent.push(labels(items)); }, rows);
    open = () => refill((r) => aiMenu(r, "automations", undefined, () => undefined));
    return null;
  }
  const root = createRoot();
  try {
    await act(async () => { root.render(<Probe rows={null} />); });
    assert.deepEqual(labels(open!()), ["Automatic", "Loading…"], "opened while loading");
    assert.equal(sent.length, 0, "nothing is sent until the rows arrive");
    await act(async () => { root.render(<Probe rows={[credits]} />); });
    assert.deepEqual(sent, [["Automatic", "Team credits"]], "the real rows arrive in the open menu");
    await act(async () => { root.render(<Probe rows={[credits, { ...credits, id: "prv_b", name: "Other", handle: "#Other" }]} />); });
    assert.equal(sent.length, 1, "a later change does not touch a menu opened some other time");
    // opened after the rows were there: nothing to refill
    assert.deepEqual(labels(open!()), ["Automatic", "Team credits", "Other"]);
  } finally { restore(); }
});
