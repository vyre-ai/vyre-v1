// The last places stay made (kept-places.tsx), and the shell can tell a return to one of them from a place made new: a return is revealed in the frame of the press, with no still copy and no waiting frame.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { View } from "react-native";
import { find, flush, installDom } from "../../../../../ui/src/testing/dom.ts";
import { PlaceStack, isKeptPlace, keptRevealed, resetKeptRegistryForTests } from "./kept-places.tsx";

const K = (p: string): string => `1:spc:${p}`;
const draw = (current: string | null, scope = "1:spc"): React.ReactElement => (
  <PlaceStack
    scope={scope}
    current={current === null ? null : K(current)}
    node={<View testID={`place-${current}`} />}
  />
);

test("a place that was kept is revealed on return; one made new is not", async () => {
  const undo = installDom();
  try {
    resetKeptRegistryForTests();
    const r = createRoot();
    await act(async () => {
      r.render(draw("files"));
    });
    await flush();
    assert.equal(keptRevealed(), false, "the first place was made");
    assert.equal(isKeptPlace(K("files")), false, "the place on screen is not one to reveal");
    await act(async () => {
      r.render(draw("records"));
    });
    await flush();
    assert.equal(keptRevealed(), false, "a place not made before is made, not revealed");
    assert.equal(isKeptPlace(K("files")), true, "Files is held and can be revealed");
    assert.equal(isKeptPlace(K("records")), false);
    assert.equal(isKeptPlace(K("vault")), false, "a place never opened is not held");
    await act(async () => {
      r.render(draw("files"));
    });
    assert.equal(keptRevealed(), true, "back to Files: revealed in the same pass");
    assert.equal(isKeptPlace(K("records")), true);
    await act(async () => {
      r.render(draw("vault"));
    });
    await flush();
    assert.equal(keptRevealed(), false, "going on to a new place clears it");
  } finally {
    undo();
  }
});

test("a Space switch forgets every kept place", async () => {
  const undo = installDom();
  try {
    resetKeptRegistryForTests();
    const r = createRoot();
    await act(async () => {
      r.render(draw("files"));
    });
    await act(async () => {
      r.render(draw("records"));
    });
    await flush();
    assert.equal(isKeptPlace(K("files")), true);
    await act(async () => {
      r.render(draw("records", "2:spc"));
    });
    await flush();
    assert.equal(isKeptPlace(K("files")), false, "the new scope holds none of the old places");
  } finally {
    undo();
  }
});
