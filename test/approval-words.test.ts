// One approval vocabulary across the app (owner rule, lead 5 Nov 2026): a person answering something that waits on them (a held send, a Gate or hook stop, a helper's ask, an access or
// join or key request, a plan, a proposed change or fact, a task's approval) presses Allow, Always allow (only where the person may give it) or Deny. Edit, Details and Ask an admin may sit
// beside them. This scans every button and menu label in apps/ and ui/, and the action labels the server sends (modules/, manifests/, agent/), and fails on the old words: Approve, Reject, Decline, Accept, Don't send, Send anyway, Allow this once, Always let and their forms.
// Words that mean something else are named below with the reason, by file; there is no comment that turns the check off.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The old approval words, as a whole label or the start of one ("Approve all 3", "Approve with edits"). */
export const OLD = /^(?:Approv(?:e|ed|ing)|Reject(?:ed|ing)?|Declin(?:e|ed|ing)|Accept(?:ed|ing)?|Don['’]t (?:send|post|pay|delete)\b|Don['’]t$|Send anyway|Allow (?:this )?once|Always let|Send back|Refuse)\b/;

/** Places where one of these words is not an approval. Each needs a reason; the list may only shrink. */
export const NOT_APPROVALS: Readonly<Record<string, string>> = {
  "ui/src/Softphone/index.tsx": "a ringing phone call is answered or declined, the phone's own words",
  "apps/app/src/console/pages/GithubApp.tsx": "the button opens GitHub, where the owner accepts GitHub's new permission request in GitHub's words",
  "apps/app/src/console/pages/CiRunners.tsx": "Accept on GitHub opens GitHub's own page for the app's new permissions",
  "apps/app/src/places/records/projectpage/linked/LinkedTab.tsx": "the CI row's Accept opens GitHub's own page for the app's new permissions",
  "apps/app/src/join/AcceptInvite.tsx": "a person accepts an invitation to join a Space; nothing waits on them for an agent",
  "manifests/esign.ts": "Declined is what a signer did with an e-signature envelope, not an answer anyone gives an agent",
  "apps/app/src/console/pages/comms/Numbers.tsx": "Reject calls is a phone number's routing choice, not an answer to anything",
};

/** The expression after `key=` or `key:` on a line, up to the first comma, brace or parenthesis that closes it (quotes and ${} kept whole). */
function valueAt(rest: string): string {
  let depth = 0, q = "";
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (q) { if (c === "\\") i++; else if (q === "`" && c === "$" && rest[i + 1] === "{") { const end = rest.indexOf("}", i); i = end < 0 ? rest.length : end; } else if (c === q) q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") { if (depth === 0) return rest.slice(0, i); depth--; }
    else if (c === "," && depth === 0) return rest.slice(0, i);
  }
  return rest;
}

/** A reviewer's verbs, not an approval: a review is feedback on the work ("Looks good", "Send back" with fixes), and the tasks model keeps Reviewer and Approver as separate slots
 * (lead, 5 Nov). Only these lines may say Send back; each must still exist and still say it. */
export const REVIEWER_LINES: ReadonlyArray<readonly [file: string, has: string]> = [
  ["modules/tasks/handlers/state.ts", 'review: [{ key: "approve", label: "Looks good"'],
  ["manifests/tasks.ts", "{ key: 'send_back', label: 'Send back'"],
  ["apps/app/src/places/chats/tasks/moves.ts", 'key: "send_back", label: "Send back"'],
  ["apps/app/src/places/chats/tasks/TaskDetail.tsx", '<Btn label="Looks good" primary testID="task-approve"'],
  ["apps/app/src/places/chats/needsyou/sample.ts", 'const review = [{ key: "review", label: "Looks good" }'],
  ["apps/app/src/shell/places-fixture/sample-a.ts", 'const review = [{ key: "review", label: "Looks good" }'],
  ["apps/app/src/places/chats/conversation/crew-card.tsx", "testID={`crew-back-${c.jobId}`}"],
];

/** Label-bearing spots on one line: label=, accessibilityLabel=, a menu entry's label:, a held card's do/dont, a short title (a Button's title, not a task's name), and JSX text. Returns each old word found. */
export function oldWords(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\b(label|title|accessibilityLabel|dropLabel|alwaysLabel|do|dont)\s*[=:]\s*\{?/g)) {
    const value = valueAt(line.slice(m.index! + m[0].length));
    for (const lit of value.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      const v = lit[2]!.trim();
      if (m[1] === "title" && v.split(/\s+/).length > 3) continue;   // a task or page named "Approve the hiring budget" is a name, not a button
      if (OLD.test(v)) out.push(v);
    }
  }
  // phrases that only ever name an approval answer are old wherever they stand (a label table, a menu, a toast)
  for (const lit of line.matchAll(/(["'`])(Don['’]t send|Send anyway|Allow (?:this )?once|Approve once)\1/g)) if (!out.includes(lit[2]!)) out.push(lit[2]!);
  for (const m of line.matchAll(/>\s*([A-Z][^<>{}]{0,40}?)\s*</g)) { const t = m[1]!.trim(); if (t.split(/\s+/).length <= 3 && OLD.test(t)) out.push(t); }   // button text, not a sentence
  return out;
}

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) files(f, out);
    else if (/\.(?:ts|tsx|mts)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) out.push(f);
  }
  return out;
}

test("the scan finds the old words in labels, menus, ternaries and JSX text, and leaves other text alone", () => {
  assert.deepEqual(oldWords(`<TextButton label="Decline" onPress={x} />`), ["Decline"]);
  assert.deepEqual(oldWords(`<Btn label={busy ? "Approving" : "Approve"} primary />`), ["Approving", "Approve"]);
  assert.deepEqual(oldWords(`menu={[{ label: "Accept", onSelect: a }, { label: "Reject", onSelect: r }]}`), ["Accept", "Reject"]);
  assert.deepEqual(oldWords("<Btn label={left === 1 ? \"Approve\" : `Approve all ${left}`} />"), ["Approve", "Approve all ${left}"]);
  assert.deepEqual(oldWords(`case "send": return { do: "Send", dont: "Don't send", what: "send this" };`), ["Don't send"]);
  assert.deepEqual(oldWords(`<Text>Approve</Text>`), ["Approve"]);
  assert.deepEqual(oldWords(`<TextButton label="Allow" /> <TextButton label="Deny" /> <Text>Accepted terms are listed below</Text>`), []);
  assert.deepEqual(oldWords(`const state = "declined"; if (x.kind === "approve") go();`), []);
  assert.deepEqual(oldWords(`needs: f.needs.map((n) => ({ title: n.title, kind: n.kind === "Approve" ? "a" : "b" }))`), []);
  assert.deepEqual(oldWords(`{ taskId: "t1", title: "Approve the hiring budget", kind: "approve" }`), []);
  assert.deepEqual(oldWords(`<Button title="Reject" onPress={r} />`), ["Reject"]);
  assert.deepEqual(oldWords(`const LABEL = { details: "Details", once: "Allow this once" };`), ["Allow this once"]);
});

test("every approval in apps/, ui/ and the labels the server sends (modules/, manifests/, agent/) says Allow, Always allow or Deny", () => {
  const hits: string[] = [];
  for (const abs of ["apps", "ui", "modules", "manifests", "agent"].flatMap((d) => files(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (NOT_APPROVALS[rel]) continue;
    fs.readFileSync(abs, "utf8").split("\n").forEach((l, i) => {
      if (/^\s*(?:\/\/|\*)/.test(l)) return;
      const reviewer = REVIEWER_LINES.some(([f, has]) => f === rel && l.includes(has));
      for (const w of oldWords(l)) if (!(reviewer && w === "Send back")) hits.push(`${rel}:${i + 1} "${w}"`);
    });
  }
  assert.deepEqual(hits, [], "say Allow (or Always allow where the person may give it) and Deny; Edit, Details and Ask an admin may sit beside them");
});

test("every reviewer line named above still exists and still says Send back", () => {
  for (const [rel, has] of REVIEWER_LINES) {
    const line = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n").find((l) => l.includes(has));
    assert.ok(line && /Send back/.test(line), `${rel}: no line with ${has} says Send back any more; take it off the list`);
  }
});

test("every place named as not an approval still exists and still uses the word", () => {
  for (const [rel, why] of Object.entries(NOT_APPROVALS)) {
    assert.ok(why.length > 20, `${rel} needs a reason`);
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(text.split("\n").some((l) => oldWords(l).length > 0), `${rel} no longer uses an old word: take it off the list`);
  }
});
