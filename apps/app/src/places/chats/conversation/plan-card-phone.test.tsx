// The plan card on a phone: the line is the count alone at every width and the card is never wider than the screen.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, find, textOf } from "../../../onboarding/test-dom.ts";
import { PlanFileCard } from "./proposal.tsx";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });
const block = { id: "pl1", data: { kind: "plan", id: "file_1", name: "Rivera onboarding plan", openComments: 1 } };

test("the plan card line is the count alone on a phone and on a desktop", async () => {
  installDom();
  for (const [width, hint] of [[390, false], [1280, false]] as const) {
    widen(width);
    const root = await mount(createRoot, <PlanFileCard block={block} onOpen={() => undefined} />);
    const text = textOf(find(root, "plancard-pl1"));
    assert.ok(text.includes("Plan · 1 open comment"), `${width}: the count is there`);
    assert.equal(text.includes("beside the chat"), hint, `${width} wide`);
  }
});
