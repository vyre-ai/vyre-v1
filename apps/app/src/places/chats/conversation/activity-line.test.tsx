// @tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLine } from "./ActivityLine.tsx";
import type { ActivitySnapshot } from "../../../shell/session/turn-streams.ts";

const store = (s: ActivitySnapshot) => ({ get: () => s, subscribe: () => () => undefined });

test("a live reply shows one calm word: no step names, no clock, no thinking excerpt (G21)", () => {
  const out = renderToStaticMarkup(
    <ActivityLine
      store={store({
        startedAt: Date.now() - 20_000,
        thinking: "I should read the order form",
        steps: [{ id: "s1", name: "Read", state: "live", detail: "harbor-order-form.docx" }],
        version: 1,
      })}
    />,
  );
  assert.ok(out.includes("Working"), "the one word");
  for (const gone of ["harbor-order-form", "Reading", "20s", "order form", "activity-elapsed"])
    assert.ok(!out.includes(gone), `${gone} is not on the line`);
});

test("held for a person, the line says it waits for them; setting up reads Setting up", () => {
  const at = (steps: ActivitySnapshot["steps"]) => ({ startedAt: 0, thinking: "", steps, version: 1 });
  const held = renderToStaticMarkup(
    <ActivityLine heldForYou store={store(at([{ id: "a", name: "Bash", state: "live" }]))} />,
  );
  assert.ok(held.includes("Waiting for you") && !held.includes("Working"));
  const setup = renderToStaticMarkup(
    <ActivityLine store={store(at([{ id: "b", name: "engine_setup", state: "live", detail: "Codex" }]))} />,
  );
  assert.ok(setup.includes("Setting up") && !setup.includes("Codex"));
});

test("the step trail is one press away while the reply is live, failed steps marked", async () => {
  const { installDom, mount, find, press, flush, textOf } = await import("../../../../../../ui/src/testing/dom.ts");
  const { createRoot } = await import("test-renderer");
  const restore = installDom();
  try {
    const snap: ActivitySnapshot = {
      startedAt: 0,
      thinking: "",
      steps: [
        { id: "s1", name: "Read", state: "done", detail: "plan.md" },
        { id: "s2", name: "Bash", state: "failed", detail: "npm test" },
        { id: "s3", name: "Grep", state: "live" },
      ],
      version: 1,
    };
    const root = await mount(createRoot, <ActivityLine store={store(snap)} />);
    assert.equal(find(root, "activity-trail"), null, "closed at first: one word only");
    await press(find(root, "activity-line"));
    await flush();
    const trail = textOf(find(root, "activity-trail"));
    assert.ok(
      trail.includes("Reading plan.md") && trail.includes("× ") && trail.includes("Running a command: npm test"),
      trail,
    );
  } finally {
    restore();
  }
});
