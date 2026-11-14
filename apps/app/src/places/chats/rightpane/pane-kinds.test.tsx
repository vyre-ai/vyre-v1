// The chat's own pane by what the chat is (G5, G6; DESIGN-chat-system, Side pane row): the same pane from the same button, with the tabs of its kind and no agent page above them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatRightPane } from "./ChatRightPane.tsx";
import { kindTabs } from "./model.ts";
import type { PaneHas, PaneKind, TabKey } from "./model.ts";
import { createSample } from "./sample.ts";

const ALL = { start: 0, end: 500 };
const clean = (s: string): string =>
  s.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const has = (o: Partial<PaneHas> = {}): PaneHas => ({
  crew: true,
  computer: true,
  kept: true,
  people: true,
  terminal: true,
  skills: false,
  hooks: false,
  ...o,
});
const titles = (k: PaneKind, o: Partial<PaneHas> = {}): string[] => kindTabs(k, has(o)).map((t) => t.title);

test("each kind of chat has the tabs the design gives it, in the prototype's order", () => {
  assert.deepEqual(titles("agent"), ["Crew", "Computer", "Threads", "Files", "Kept", "Knows", "Routines", "Terminal"]);
  assert.deepEqual(titles("group"), ["Crew", "Computer", "Threads", "Files", "Kept", "Knows", "Terminal"]);
  assert.deepEqual(titles("channel"), ["Threads", "Files", "Kept", "People"]);
  assert.deepEqual(titles("dm"), ["Files", "Kept"]);
});

test("a tab for something the chat does not have is not drawn: no Crew without teammates, no Computer without one, no Kept until there is a list", () => {
  assert.deepEqual(titles("agent", { crew: false, computer: false, kept: false, terminal: false }), [
    "Threads",
    "Files",
    "Knows",
    "Routines",
  ]);
  assert.deepEqual(titles("dm", { kept: false }), ["Files"]);
  assert.deepEqual(titles("channel", { people: false, kept: false }), ["Threads", "Files"]);
  assert.deepEqual(titles("agent", { skills: true, hooks: true }).slice(-2), ["Skills", "Hooks"]);
});

const html = (kind: PaneKind | undefined, tab?: TabKey, more: Record<string, unknown> = {}): string =>
  clean(
    renderToStaticMarkup(
      <ChatRightPane
        data={createSample("northwind", { crew: true }).data}
        open
        onToggle={() => undefined}
        window={ALL}
        paneWidth={900}
        {...(kind ? { kind } : {})}
        {...(tab ? { tab } : {})}
        {...(more as object)}
      />,
    ),
  );

test("the chat's own pane has no agent page above its tabs, and opens on its first tab, not on About", () => {
  const own = html("agent");
  assert.ok(!own.includes("Responsible for") && !own.includes('data-testid="pane-body-about"'), "no About");
  assert.ok(own.includes('data-testid="pane-body-crew"'), "opens on Crew where teammates work");
  for (const t of ["Crew", "Threads", "Files"]) assert.ok(own.includes(`>${t}<`), t);
  assert.ok(!own.includes(">About<"), "About is the agent's page, reached from its face");
  const legacy = html(undefined);
  assert.ok(
    legacy.includes('data-testid="pane-body-about"') && legacy.includes(">About<"),
    "an agent's profile keeps its About",
  );
});

test("a channel's pane has People and Kept only where the shell draws them, and a person's chat has Files", () => {
  const channel = html("channel", "people", { people: <div data-testid="people-body">Who is here</div> });
  assert.ok(
    channel.includes('data-testid="people-body"') && channel.includes(">People<") && channel.includes(">Threads<"),
  );
  assert.ok(!html("channel").includes(">People<"), "no People without its body");
  assert.ok(
    html("channel", "kept", { kept: <div data-testid="kept-body">Kept</div> }).includes('data-testid="kept-body"'),
  );
  const dm = html("dm");
  assert.ok(dm.includes('data-testid="pane-body-files"') && !dm.includes(">Crew<") && !dm.includes(">Computer<"));
});

test("the Crew tab of the chat's own pane carries the session block, and Kept is a tab only where the chat has a session to read", () => {
  const own = html("agent", "crew");
  assert.ok(own.includes('data-testid="pane-body-crew"'));
  assert.ok(!html("agent").includes(">Kept<"), "no session context in this mount: no Kept tab");
  assert.ok(
    html("agent", "kept", { kept: <div data-testid="kept-body">Kept</div> }).includes('data-testid="kept-body"'),
  );
});
