// A helper's state: words, except Failed, which is the shared triangle mark with the word as its name.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { stateWordOrMark } from "./state-word.tsx";

test("Failed is the triangle mark named Failed, with no word drawn; the other states keep their words", () => {
  const failed = renderToStaticMarkup(<Text>{stateWordOrMark("failed")}</Text>);
  assert.match(failed, /data-state="failed"/);
  assert.match(failed, /aria-label="Failed"/);
  assert.doesNotMatch(failed.replace(/<[^>]*>/g, ""), /\S/, "no text is drawn");
  for (const [state, word] of [
    ["working", "Working"],
    ["needs_you", "Needs you"],
    ["done", "Done"],
    ["stopped", "Stopped"],
  ] as const)
    assert.match(renderToStaticMarkup(<Text>{stateWordOrMark(state)}</Text>), new RegExp(word));
});
