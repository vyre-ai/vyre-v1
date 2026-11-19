// A button trigger needs a Button field on its record type (r40 audit, gap 6): the builder says when the type has none and adds one in a press, set to run this Flow.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { addButtonOps, buttonFieldsOf, fieldKeysOf } from "./button-field.ts";
import { AutomationsDataProvider } from "./data.tsx";
import { Inspector } from "./Inspector.tsx";
import type { Definition } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";

installDom();
const noop = (): void => undefined;
const described = (...fields: { key: string; type: string; options?: unknown }[]) => ({
  types: [{ key: "matter", title: "Matter", fields }],
});

test("the Button fields of a type, and the change that adds one that runs this Flow", () => {
  const d = described({ key: "name", type: "text" }, { key: "go", type: "button", options: { automation: "aut_1" } });
  assert.deepEqual(buttonFieldsOf(d), [{ key: "go", automation: "aut_1" }]);
  assert.deepEqual(fieldKeysOf(d), ["name", "go"]);
  assert.deepEqual(buttonFieldsOf({}), []);
  const { ops, key } = addButtonOps("matter", "Send intake", ["name"], "aut_1");
  assert.equal(key, "send_intake");
  assert.deepEqual(ops, [
    {
      op: "field.add",
      type: "matter",
      field: "send_intake",
      def: {
        title: "Send intake",
        type: "button",
        required: false,
        options: { label: "Send intake", automation: "aut_1" },
      },
    },
  ]);
  assert.equal(addButtonOps("matter", "Send intake", ["send_intake"]).key, "send_intake_2");
});

test("picking a button trigger for a type with no Button field offers to add it, and adding it clears the offer", async () => {
  const sample = createSampleAutomations(northwind);
  const base = sample.data.call.bind(sample.data);
  const asked: { cap: string; input: unknown }[] = [];
  let has = false;
  const data = {
    ...sample.data,
    call: async (cap: string, input: unknown) => {
      if (cap === "schema.describe")
        return described({ key: "name", type: "text" }, ...(has ? [{ key: "go", type: "button" }] : []));
      if (cap === "schema.diff") {
        asked.push({ cap, input });
        return { problems: [], previewToken: "tok", items: [] };
      }
      if (cap === "schema.apply") {
        asked.push({ cap, input });
        has = true;
        return { applied: 1 };
      }
      return base(cap as never, input as never);
    },
  } as typeof sample.data;
  const trigger = { key: "button", config: { type: "matter", label: "Send intake" } };
  const def: Definition = { triggers: [trigger], nodes: [] };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={data}>
      <Inspector
        automationId="aut_lead"
        def={def}
        node={null}
        trigger={trigger}
        triggerIndex={0}
        issues={[]}
        keys={[]}
        onChange={noop}
        onClose={noop}
        onDelete={noop}
      />
    </AutomationsDataProvider>,
  );
  await new Promise((r) => setTimeout(r, 30));
  const offer = find(root, "trigger-button-offer");
  assert.ok(offer, "the offer shows");
  assert.match(textOf(offer), /matter has no Button field yet/);
  await press(find(root, "trigger-button-add"));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(
    asked.map((a) => a.cap),
    ["schema.diff", "schema.apply"],
  );
  const ops = (asked[1]!.input as { ops: { def: { options: unknown } }[] }).ops;
  assert.deepEqual(ops[0]!.def.options, { label: "Send intake", automation: "aut_lead" });
  assert.equal(find(root, "trigger-button-offer"), null, "the offer is gone once the field is there");
});
