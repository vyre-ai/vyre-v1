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
