// P-L9b_24: the agent pane beside a chat shows Computer, Threads, Files and Memory with its count (and Routines) at desktop width and folds the rest behind More only when narrow; the
// Computer tab lists each step with its frame thumbnail, tool and time; a sleeping computer shows its frame with a Wake button.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TabStrip } from "../../../../../ui/src/TabStrip/index.tsx";
import { AGENT_PANE_W, AgentPane } from "./AgentPane.tsx";
import { CHEVRON } from "./rightpane/fit.tsx";
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

test("the pane is the prototype's 340 px, its tabs are pinned (no close slot) and take less room than a main tab", () => {
  assert.equal(AGENT_PANE_W, 340);
  assert.ok(PANE_TAB_EXTRA < TAB_EXTRA, "a pane tab has no close slot");
  const out = pane({ width: AGENT_PANE_W });
  assert.ok(!out.includes('data-testid="tab-close-computer"'), "no close button on a pane tab");
  for (const t of ["Computer", "Threads"]) assert.ok(out.includes(t), t);
});

test("a roomy pane draws every tab, Memory with its count, and no More", () => {
  const out = pane({ width: 640 });
  for (const t of ["Computer", "Threads", "Files", "Memory 4", "Routines"]) assert.ok(out.includes(t), t);
  assert.ok(!out.includes(">More<"), "no More when everything fits");
});

test("a narrow pane folds the tabs that do not fit behind More", () => {
  const out = pane({ width: 300 });
  assert.ok(out.includes(">More<"));
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

test("the pane's top row is the open item as a tab: the agent's face and name with a close x, above the agent's header and the tabs", () => {
  const out = pane({ width: AGENT_PANE_W });
  assert.ok(out.includes('data-testid="tab-open-selected"') && out.includes('aria-label="Intake"'), "the open item as a tab");
  assert.ok(out.includes('data-testid="tab-close-open"'), "with its close x");
  assert.ok(out.indexOf('data-testid="tab-open-selected"') < out.indexOf('data-testid="pane-agent"'), "above the agent's header");
  assert.ok(out.indexOf('data-testid="pane-agent"') < out.indexOf('data-testid="tab-computer-selected"'), "the tabs sit under the header");
});

test("the folded tabs are a down chevron named More tabs, with no word beside it", () => {
  const tabs = [{ key: "more", title: "More tabs", label: "More tabs", iconOnly: true, icon: CHEVRON, pinned: true }];
  const out = clean(renderToStaticMarkup(<TabStrip tabs={tabs} active="x" tight />));
  assert.ok(out.includes('aria-label="More tabs"') && out.includes("<svg"));
  assert.ok(!out.includes(">More tabs<"), "the name is spoken, not drawn");
});
