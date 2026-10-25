// P-L9f_07c: first run as in the prototype (the lead's screenshot audit). Path mapping: the packet lists only this test; the screens it fixes are the join pages (apps/app/src/join, lane L9f)
// and the shots mount and targets for P-L9f_07c. Layout and look are proven by the side-by-side shots; these tests hold the markup facts they rest on.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Checklist } from "../../../join/Checklist.tsx";
import { JoinFlow } from "../../../join/JoinFlow.tsx";
import type { FlowState, JoinInvite } from "../../../join/logic.ts";

const INVITE: JoinInvite = {
  space: "Northwind", host: "northwind", by: "Irfad Imtiaz", role: "Member", email: "irfad@northwind.example",
  names: { first: "Dana", last: "Whitfield" }, deviceName: "Dana's MacBook",
  starting: { agents: ["Intake"], projects: ["Rivera matter"] }, sso: ["Google"], github: true, adminKey: false,
};
const flow = (initial: Partial<FlowState>, mode: "light" | "dark" = "light"): string =>
  renderToStaticMarkup(<JoinFlow invite={INVITE} initial={initial} mode={mode} hold />).replaceAll("<!-- -->", "");
const ITEMS = [
  { key: "photo_and_title" as const, title: "Add a photo and title", done: false },
  { key: "connect_mailbox_and_calendar" as const, title: "Connect your mailbox and calendar", done: false },
  { key: "meet_assistant" as const, title: "Meet your assistant", done: false },
  { key: "open_first_project" as const, title: "Open your first project", done: false },
  { key: "import" as const, title: "Import your mailboxes, drives, CRM or spreadsheets", done: false },
];
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";

test("the checklist sits in the Home first-run layout: greeting, date line, the Get started card with the AI account first, Hide, no panel or wash", () => {
  const out = renderToStaticMarkup(<Checklist space="Northwind" items={ITEMS} visible assistantLocked heading="Good morning, Dana" dateLine="Friday, October 24" />).replaceAll("<!-- -->", "");
  assert.ok(out.includes("Good morning, Dana") && out.includes("Friday, October 24 · Welcome to Northwind"));
  assert.ok(out.includes('data-testid="s-first"') && out.includes('data-testid="first-progress"') && out.includes("0 of 6"));
  assert.ok(out.indexOf("Connect an AI account") < out.indexOf("Add a photo and title") && out.indexOf("Add a photo and title") < out.indexOf("Meet your assistant"));
  assert.ok(out.includes("Your assistant stays locked until you do") && out.includes("Connect an AI account first") && out.includes("Locked"));
  for (const id of ["go-ai", "go-photo_and_title", "go-connect_mailbox_and_calendar", "go-open_first_project", "go-import"]) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(!out.includes('data-testid="go-meet_assistant"'), "a locked step has no action");
  assert.ok(out.includes('data-testid="checklist-done"') && out.includes(">Hide<") && !out.includes("Not now"));
  assert.ok(!out.includes('data-testid="join-panel"') && !out.includes('data-testid="join-frame"') && !out.includes('role="dialog"'), "not a modal");
});

test("the checklist's rows are the shared Row with a check circle at the left and the action at the right; connecting the AI account unlocks the assistant", () => {
  const locked = renderToStaticMarkup(<Checklist space="Northwind" items={ITEMS} visible assistantLocked />);
  const open = renderToStaticMarkup(<Checklist space="Northwind" items={ITEMS} visible assistantLocked={false} />);
  assert.ok(!locked.includes('data-testid="go-meet_assistant"') && open.includes('data-testid="go-meet_assistant"'));
  assert.ok(open.includes("0 of 5") === false && open.includes("1 of 6"), "the AI account row counts once it is connected");
  assert.equal((locked.match(/data-testid="check-open"/g) ?? []).length, 6);
});

test("the Open button on the finish page sits after the dots, once, with its whole label, in both modes", () => {
  for (const mode of ["light", "dark"] as const) {
    const out = flow({ stage: "done", step: 3 }, mode);
    assert.ok(out.includes("You&#x27;re all set") && out.includes("Welcome, Dana."), mode);
    const bar = out.slice(out.indexOf('data-testid="join-bar"'));
    assert.ok(bar.indexOf('data-testid="dots"') < bar.indexOf('data-testid="open-space"'), "dots first, the button after");
    assert.equal(bar.match(/data-testid="open-space"/g)?.length, 1);
    assert.ok(bar.includes(">Open Northwind<"), "the whole label is one text node");
    assert.ok(!bar.includes('data-testid="back"'), "no Back on the finish");
  }
});

test("the landing renders for both modes with its three actions", () => {
  for (const mode of ["light", "dark"] as const) {
    const out = flow({}, mode);
    assert.ok(out.includes("Join Northwind") && tag(out, "open-app") !== "" && out.includes("Download Vyre") && out.includes("Continue in the browser"), mode);
  }
});
