// Typing @ in a task line lists the people and agents; a pick writes the word quick add reads, so the task is assigned to who was picked.
import test from "node:test";
import assert from "node:assert/strict";
import { useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../ui/src/testing/dom.ts";
import { QuickField, atInsert, atMatches, atQuery } from "./QuickField.tsx";
import { parseQuick } from "./quick.ts";
import type { QuickPerson } from "./quick.ts";

const PEOPLE: QuickPerson[] = [
  { id: "usr_sara", name: "Sara Lee", kind: "person", username: "sara" },
  { id: "usr_tom", name: "Tom Reyes", kind: "person" },
  { id: "agt_test", name: "Test", kind: "agent" },
];

test("the @word is read at the end of the text; matches put people first; a pick writes the word quick add resolves", () => {
  assert.deepEqual(atQuery("Call Omar friday @Te"), { at: 17, query: "Te" });
  assert.equal(atQuery("mail a@b.com"), null);
  assert.deepEqual(atMatches(PEOPLE, "t").map((p) => p.id), ["usr_tom", "agt_test"]);
  assert.deepEqual(atMatches(PEOPLE, "lee").map((p) => p.id), ["usr_sara"]);
  const agent = atInsert("Call Omar friday @Te", PEOPLE[2]!);
  assert.equal(agent, "Call Omar friday @Test ");
  assert.equal(parseQuick(agent, PEOPLE, 0, 0).assignee?.id, "agt_test");
  assert.equal(parseQuick(atInsert("Review @sa", PEOPLE[0]!), PEOPLE, 0, 0).assignee?.id, "usr_sara");
  assert.equal(parseQuick(atInsert("Review @to", PEOPLE[1]!), PEOPLE, 0, 0).assignee?.id, "usr_tom");
});

test("the field lists who matches under it; a click picks, and Enter picks instead of making the task", async () => {
  const restore = installDom();
  try {
    const made: string[] = [];
    function Host(): ReactElement {
      const [v, setV] = useState("");
      return <QuickField testID="qf" label="Add a task" placeholder="Add" value={v} onChangeText={setV} onSubmit={() => made.push(v)} people={PEOPLE} style={{}} />;
    }
    const root = await mount(createRoot, <Host />);
    await typeInto(find(root, "qf"), "Call Omar @Te");
    assert.ok(find(root, "qf-people"), "the list opens on @");
    assert.ok(find(root, "qf-person-agt_test"));
    assert.equal(find(root, "qf-person-usr_sara"), null);
    const { act } = await import("react");
    // the browser's Enter, as react-native-web hands it to the field: onKeyPress first, then submit unless that prevented it
    const enter = async (): Promise<void> => {
      let prevented = false;
      const e = { key: "Enter", shiftKey: false, nativeEvent: { key: "Enter", isComposing: false }, target: { blur() {} }, currentTarget: { blur() {} }, preventDefault() { prevented = true; }, stopPropagation() {}, isDefaultPrevented: () => prevented, isPropagationStopped: () => false, persist() {} };
      await act(async () => { ((find(root, "qf") as Node).props.onKeyDown as (e: unknown) => void)(e); });
    };
    await enter();
    assert.equal((find(root, "qf") as Node).props.value, "Call Omar @Test ");
    assert.deepEqual(made, [], "Enter picked the person, it did not make the task");
    await enter();
    assert.deepEqual(made, ["Call Omar @Test "], "with the list closed, Enter makes the task");
    await typeInto(find(root, "qf"), "Ask @sa");
    await press(find(root, "qf-person-usr_sara"));
    assert.equal((find(root, "qf") as Node).props.value, "Ask @sara ");
  } finally { restore(); }
});
