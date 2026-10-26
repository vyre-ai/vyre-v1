// P-L9b_24: the agent pane beside a chat shows Computer, Threads, Files and Memory with its count (and Routines) at desktop width and folds the rest behind More only when narrow; the
// Computer tab lists each step with its frame thumbnail, tool and time; a sleeping computer shows its frame with a Wake button.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_PANE_W, AgentPane } from "./AgentPane.tsx";
import { createGo, wirePane } from "./mounts/data.ts";
import { PEOPLE, createMountSample } from "./mounts/sample.ts";
import { offsetLabel } from "./rightpane/ComputerTab.tsx";
import { PANE_TAB_EXTRA } from "./rightpane/ChatRightPane.tsx";
import { TAB_EXTRA } from "./rightpane/model.ts";

const clean = (s: string): string => s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const pane = (o: { asleep?: boolean; width: number }): string => {
  const s = createMountSample(o.asleep ? { asleep: true } : {});
  const go = createGo(s.rt, () => undefined, (id) => PEOPLE.find((p) => p.id === id)?.name ?? id, () => undefined);
  const data = wirePane(s.rt, go, "c1", { agentId: "agt_intake", name: "Intake", computerId: "cmp_intake" });
  return clean(renderToStaticMarkup(<AgentPane data={data} open onToggle={() => undefined} paneWidth={o.width} window={{ start: 0, end: 500 }} />));
};

test("at the desktop width every tab is drawn, Memory with its count, and More is not", () => {
  assert.ok(AGENT_PANE_W >= 440);
  const out = pane({ width: AGENT_PANE_W });
  for (const t of ["Computer", "Threads", "Files", "Memory 4", "Routines"]) assert.ok(out.includes(t), t);
  assert.ok(!out.includes(">More<"), "no More on a wide pane");
});

test("a narrow pane folds the tabs that do not fit behind More", () => {
  const out = pane({ width: 340 });
  assert.ok(out.includes(">More<"));
  assert.ok(PANE_TAB_EXTRA < TAB_EXTRA, "a pane tab has no close slot");
});

test("a sleeping computer shows its frame with a Wake button, and the last session's steps each carry a thumbnail, the tool and the time into the session", () => {
  const out = pane({ asleep: true, width: AGENT_PANE_W });
  assert.ok(out.includes('data-testid="computer-wake"') && out.includes("Last session"));
  assert.ok(out.includes('data-testid="step-thumb"'), "a frame thumbnail on a step");
  assert.ok(/Chrome · \d+:\d\d/.test(out), "the tool and the time into the session, as m:ss");
  assert.equal(offsetLabel(2_000), "0:02");
  assert.equal(offsetLabel(83_000), "1:23");
  assert.equal(offsetLabel(-5), "0:00");
});
