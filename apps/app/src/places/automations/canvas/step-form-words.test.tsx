// The step form and the step rows never show an id, a schema key, a brace or "(required)" (AUTOMATIONS-BUILD-RC29 round three, item 6): every step kind the server lists is rendered as a form and scanned.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { registry } from "../../../../../../generated/registry.ts";
import { rawIdsIn } from "../../../../../../lib/id-shapes.ts";
import { find, flush, installDom, mount, press } from "../../../../../../ui/src/testing/dom.ts";
import { Inspector } from "./Inspector.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { check } from "./model.ts";
import type { DefNode, Definition } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { DataWordsContext, ChipText } from "./fields.tsx";

const data = createSampleAutomations(northwind).data;
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;|&#x27;/g, "'")
    .replace(/\s+/g, " ");

test("every step kind the server lists renders a form with no id, brace, schema key or (required)", () => {
  for (const s of registry.steps) {
    const node: DefNode = { id: "n1", key: s.key, input: {} };
    const def: Definition = { triggers: [{ key: "manual" }], nodes: [node] };
    const out = text(
      renderToStaticMarkup(
        <AutomationsDataProvider value={data}>
          <Inspector
            def={def}
            node={node}
            trigger={null}
            triggerIndex={null}
            issues={check(def, "personal")}
            keys={[]}
            kind="personal"
            inputSchema={s.input}
            samples={{}}
            version={1}
            mode="basic"
            onMode={() => undefined}
            onChange={() => undefined}
            onClose={() => undefined}
            onDelete={() => undefined}
          />
        </AutomationsDataProvider>,
      ),
    );
    assert.deepEqual(rawIdsIn(out), [], `${s.key}: no raw id`);
    assert.equal(/\{\{|\(required\)|Templating|More options/.test(out), false, `${s.key}: no syntax`);
    for (const key of Object.keys((s.input as { properties?: object } | undefined)?.properties ?? {}))
      if (/[a-z][A-Z]|_/.test(key)) assert.equal(out.includes(` ${key} `), false, `${s.key}: the key ${key} is not a label`);
  }
});

test("the chip field: Insert data opens the menu, Backspace after a chip takes it out whole, a formula stays a grey chip", async () => {
  installDom();
  const calls: string[] = [];
  const committed: string[] = [];
  const root = await mount(
    createRoot,
    <DataWordsContext.Provider
      value={{
        titleOf: (id) => id,
        insert: (_x, _y, current, put) => {
          calls.push(current);
          put(`${current}{{ trigger.email }}`);
        },
      }}
    >
      <ChipText label="To" testID="field-to" value="a {{ trigger.name }} b {{ upper(trigger.x) }}" onCommit={(v) => committed.push(v)} chipLabel={(r) => r} />
    </DataWordsContext.Provider>,
  );
  await flush();
  assert.ok(find(root, "field-to-chip-1"), "the reference is a chip");
  assert.ok(find(root, "field-to-chip-3"), "the formula is a chip too");
  await press(find(root, "field-to-insert"));
  await flush();
  assert.deepEqual(calls, ["a {{ trigger.name }} b {{ upper(trigger.x) }}"], "the menu got the field as it was stored, unchanged");
  assert.equal(committed.at(-1), "a {{ trigger.name }} b {{ upper(trigger.x) }}{{ trigger.email }}");
});
