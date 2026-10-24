// ui/LockedState: Ask for access sends access.request; Waiting, Granted and Declined show on the same state (spec 4.8, 4.12, ARCH 4.13).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { menuEntries } from "../Menu/index.tsx";
import { isItem, isReportItem } from "../Menu/props.ts";
import { ACCESS_REQUEST_STATUS_LABEL, ASK_CAPABILITY, ASK_FOR_ACCESS_LABEL, LOCKED_LEVELS, LockedState, askForAccess, frozenLockedStateProps, reasonLine, requestInput, statusView } from "./index.tsx";
import type { AccessRequestInput } from "./index.tsx";

test("Ask for access sends access.request with the resource, the level and the note", async () => {
  const calls: { cap: string; input: AccessRequestInput }[] = [];
  const status = await askForAccess((cap, input) => { calls.push({ cap, input }); }, frozenLockedStateProps, "edit", "  I am covering for Maya  ");
  assert.equal(ASK_CAPABILITY, "access.request");
  assert.deepEqual(calls, [{ cap: "access.request", input: { resource: { type: "folder", id: "fld_clients" }, level: "edit", note: "I am covering for Maya" } }]);
  assert.equal(status, "waiting");
});

test("an empty note is left out of the request", () => {
  assert.deepEqual(requestInput(frozenLockedStateProps, "view", "   "), { resource: { type: "folder", id: "fld_clients" }, level: "view" });
});

test("a second ask is the same request: a duplicate answers Waiting; other errors reach the caller", async () => {
  const dup = await askForAccess(() => { throw Object.assign(new Error("exists"), { code: "validation.duplicate" }); }, frozenLockedStateProps, "view", "");
  assert.equal(dup, "waiting");
  await assert.rejects(askForAccess(() => { throw Object.assign(new Error("nope"), { code: "permission.guest_cannot_request" }); }, frozenLockedStateProps, "view", ""), /nope/);
});

test("the levels are the same four as access.share, with the same words", () => {
  assert.deepEqual(LOCKED_LEVELS.map((l) => l.id), ["view", "use", "edit", "manage"]);
  assert.deepEqual(ACCESS_REQUEST_STATUS_LABEL, { none: "Ask for access", waiting: "Waiting", granted: "Granted", declined: "Declined" });
});

test("each status shows the right button and line", () => {
  assert.deepEqual(statusView("none", true, ""), { button: "Ask for access", enabled: true, line: "" });
  assert.deepEqual(statusView("waiting", true, ""), { button: "Waiting", enabled: false, line: "Asked. You will see the answer here." });
  assert.deepEqual(statusView("granted", true, ""), { button: "Granted", enabled: false, line: "You have access now." });
  assert.deepEqual(statusView("declined", true, "Not this quarter"), { button: "Ask for access", enabled: true, line: "Declined: Not this quarter" });
  assert.equal(statusView("none", false, "").enabled, false, "a guest cannot ask");
  assert.match(statusView("none", false, "").line, /Guests cannot ask/);
});

test("the reason is in plain words", () => {
  assert.equal(reasonLine("no_grant", "Clients"), "You do not have access to Clients yet.");
  assert.match(reasonLine("role_lacks_permission", "Server shell"), /Your role does not include what Server shell needs/);
});

test("the rendered state: the button, the level to ask for, the note field", () => {
  const html = renderToStaticMarkup(<LockedState {...frozenLockedStateProps} />);
  assert.match(html, /aria-label="Clients is locked"/);
  assert.match(html, /You do not have access to Clients yet\./);
  assert.match(html, /aria-label="Ask for access"/);
  assert.match(html, /Ask for View/);
  assert.match(html, /data-testid="locked-note"/);
  assert.doesNotMatch(html, /aria-disabled="true"/, "the button is live");
});

test("waiting disables the button and says Waiting; the level and note go away", () => {
  const html = renderToStaticMarkup(<LockedState {...frozenLockedStateProps} status="waiting" />);
  assert.match(html, /aria-label="Waiting"/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /locked-level|locked-note/);
  assert.match(html, /You will see the answer here/);
});

test("granted offers Open; declined shows the approver's note and lets you ask again", () => {
  const granted = renderToStaticMarkup(<LockedState {...frozenLockedStateProps} status="granted" />);
  assert.match(granted, />Open</);
  const declined = renderToStaticMarkup(<LockedState {...frozenLockedStateProps} status="declined" note="Not this quarter" />);
  assert.match(declined, /Declined: Not this quarter/);
  assert.match(declined, /aria-label="Ask for access"/);
  assert.doesNotMatch(declined, /aria-disabled="true"/);
});

test("a guest sees the state without the level or the note, and the button is off", () => {
  const html = renderToStaticMarkup(<LockedState {...frozenLockedStateProps} canRequest={false} />);
  assert.match(html, /Guests cannot ask for access/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /locked-level|locked-note/);
});

test("the level menu is a ui/Menu: it ends with Report a problem", () => {
  const entries = menuEntries({ items: LOCKED_LEVELS.map((l) => ({ label: l.label, checked: l.id === "view" })) });
  const last = entries[entries.length - 1];
  assert.ok(last && isReportItem(last));
  assert.equal(entries.filter(isItem).length, 5);
  assert.equal(ASK_FOR_ACCESS_LABEL, "Ask for access");
});
