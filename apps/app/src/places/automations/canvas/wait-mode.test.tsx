// rc.32 lane r32-auto, item 2: a Wait is one of two things, a time or an event, chosen at the top of its form like the prototype's "A reply, A time"; only that kind's fields show. The event's own fields are rows of choices, never text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Inspector } from "./Inspector.tsx";
import { AutomationsDataProvider } from "./data.tsx";
import { resolveSchema } from "./form-model.ts";
import { check } from "./model.ts";
import type { DefNode, Definition } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { waitModeOf, withWaitMode } from "./steps/edits.ts";

const registry = JSON.parse(
  readFileSync(new URL("../../../../../../generated/registry.json", import.meta.url), "utf8"),
) as { steps: { key: string; input: unknown }[]; $defs: Record<string, unknown> };
const schema = resolveSchema(registry.steps.find((s) => s.key === "wait")!.input, registry.$defs);
const data = createSampleAutomations(northwind).data;
const page = (node: DefNode): string => {
  const def: Definition = { triggers: [{ key: "manual" }], nodes: [node], start: [node.id] };
  return renderToStaticMarkup(
    <AutomationsDataProvider value={data}>
      <Inspector
        def={def}
        node={node}
        trigger={null}
        triggerIndex={null}
        issues={check(def, "space")}
        keys={[]}
        kind="space"
        inputSchema={schema}
        onChange={() => undefined}
        onClose={() => undefined}
        onDelete={() => undefined}
      />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");
};
const ids = (out: string): Set<string> => new Set([...out.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]!));

test("a time Wait shows its time fields and not the event; an event Wait shows the event and not the time", () => {
  const time = ids(page({ id: "n1", key: "wait", input: { forDuration: "2d" } }));
  assert.ok(time.has("wait-mode") && time.has("field-forDuration") && !time.has("field-event-event"));
  const event = ids(page({ id: "n1", key: "wait", input: { event: { event: "task.completed" } } }));
  assert.ok(event.has("wait-mode") && event.has("field-event-event") && !event.has("field-forDuration"));
});

test("choosing the other kind swaps what the step holds and keeps the rest", () => {
  assert.equal(waitModeOf({ forDuration: "2d" }), "time");
  assert.equal(waitModeOf({ event: { event: "task.completed" } }), "event");
  assert.deepEqual(withWaitMode({ forDuration: "2d", timeout: "7d" }, "event"), { event: {}, timeout: "7d" });
  assert.deepEqual(withWaitMode({ event: { event: "task.completed" }, timeout: "7d" }, "time"), { timeout: "7d" });
});
