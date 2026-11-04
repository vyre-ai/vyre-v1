// An approval nobody answered for 7 days is withdrawn by the gate with the note "Not sent, it waited 7 days". Needs you shows that note on the request and leaves it with nothing to approve.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsYou } from "../needsyou/NeedsYou.tsx";
import type { Item } from "../needsyou/model.ts";
import { createSample } from "../needsyou/sample.ts";

const ALL = { start: 0, end: 500 };
const NOTE = "Not sent, it waited 7 days";

test("an expired approval reads 'Not sent, it waited 7 days' under Withdrawn, with no Approve, Send or Send back", () => {
  const s = createSample("northwind");
  const n8 = (s.replica.rows("needs") as unknown as Item[]).find((i) => i.task.id === "n8")!;
  s.replica.put("needs", [{ ...n8, task: { ...n8.task, workingNotes: { ...n8.task.workingNotes, withdrawn: NOTE } } }] as never);
  const out = renderToStaticMarkup(<NeedsYou data={s.data} window={ALL} initialSelected="n8" />).replaceAll("<!-- -->", "").replaceAll("&amp;", "&");
  assert.ok(out.includes(NOTE), "the note is on the request");
  assert.ok(!out.includes("nothing to do."), "the plain fallback line is replaced");
  assert.ok(out.indexOf('data-testid="needs-withdrawn-label"') < out.indexOf("Send the Pruitt fee letter"), "it sits under Withdrawn");
  const detail = out.slice(out.indexOf('data-testid="needs-detail"'));
  assert.ok(detail.includes(NOTE) && detail.includes(">Dismiss<"), "the open request is the expired one, and Dismiss is all that is left");
  assert.ok(out.includes("A dismiss") && !out.includes("A approve"), "the footer names the key for what is left, not Approve");
  for (const gone of [">Approve<", ">Send<", ">Send back<", 'data-testid="needs-sendback"', 'data-testid="needs-take"']) assert.ok(!detail.includes(gone), `no ${gone}`);
});
