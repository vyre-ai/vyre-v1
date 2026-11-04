// The Linked tab mounted for real over the scripted Projects server (sample.ts): every control is proved by the capability it calls, and the access rule by a member who cannot open one linked item.
import test from "node:test";
import { act } from "react";
import assert from "node:assert/strict";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../../ui/src/testing/dom.ts";
import type { Node } from "../../../../../../../ui/src/testing/dom.ts";
import { ProjectPageDataProvider } from "../data.tsx";
import { LinkedTab } from "./LinkedTab.tsx";
import { ProjectLinked } from "./index.tsx";
import type { LinkedTabProps } from "./LinkedTab.tsx";
import { createSampleLinked, NOW } from "./sample.ts";
import { EMPTY_RULE, GROUPS, askResource, countFor, failedRun, filterLinks, fixAsk, groupOf, levelOf, linkOfHit, parseAddress, reachOf, ruleBody, ruleProblem, ruleText, runLine, stateWords, runLook, titleOf, toneOf } from "./model.ts";
import type { Link } from "./model.ts";
import { LINKS, RUNS } from "./sample.ts";

async function tab(o: Parameters<typeof createSampleLinked>[0] = {}, props: Partial<LinkedTabProps> = {}) {
  const restore = installDom();
  const s = createSampleLinked(o);
  const said: string[] = [];
  const asked: string[] = [];
  const urls: string[] = [];
  const targets: string[] = [];
  const { createRoot } = await import("test-renderer");
  let made: { unmount(): void } | null = null;
  const root = await mount(() => { const r = createRoot(); made = r; return r; }, (
    <ProjectPageDataProvider value={s.data}>
      <LinkedTab projectId="prj_rivera" projectTitle="Rivera account" canEdit say={(t) => void said.push(t)} openUrl={(u) => void urls.push(u)} open={(t) => void targets.push(`${t.place}:${t.hash ?? ""}`)} askAssistant={(t) => void asked.push(t)} {...props} />
    </ProjectPageDataProvider>
  ));
  await flush();
  // a mounted tab is taken down before the DOM stand-ins are put back, so a late timer never draws into a torn-down page
  return { root, s, said, asked, urls, targets, restore: () => { void act(() => { made?.unmount(); }); restore(); } };
}
const tap = async (root: Node, id: string) => { const n = find(root, id); assert.ok(n, `${id} is on the page`); await press(n); await flush(); };
const writes = (calls: { cap: string }[], cap: string) => calls.filter((c) => c.cap === cap);
const L = (id: string): Link => LINKS().find((l) => l.linkId === id)!;

test("links group, count and read as words", () => {
  assert.deepEqual([...GROUPS], ["Tasks", "Records", "Files", "Chats", "Code", "Sites"]);
  assert.equal(groupOf(L("lnk_7")), "Code");
  assert.equal(groupOf({ kind: "mail_thread" }), "Chats");
  assert.equal(groupOf({ kind: "url" }), "Sites");
  assert.equal(filterLinks(LINKS(), "Files").length, 2);
  assert.equal(countFor(LINKS(), RUNS(), "All"), 9 + 3, "the CI runs count with the links");
  assert.equal(countFor(LINKS(), RUNS(), "Code"), 2 + 3);
  assert.equal(countFor(LINKS(), RUNS(), "Tasks"), 1);
  assert.deepEqual(["Paid", "Merged", "Overdue", "Closed", "Draft", "Open", undefined].map(toneOf), ["ok", "ok", "bad", "bad", "warn", "", ""]);
});

test("the access rule: what the viewer cannot open is a peek with only its kind, never a link to a place they cannot open", () => {
  const viewer = { id: "usr_irfad" };
  const fee = L("lnk_5");
  assert.equal(levelOf(fee), "none");
  assert.equal(titleOf(fee), "A file you don't have access to", "never its name");
  const r = reachOf(fee, viewer);
  assert.equal(r.to, "peek");
  assert.equal(reachOf(L("lnk_4"), viewer).to, "open");
  assert.equal(reachOf(L("lnk_2"), viewer).to, "open");
  assert.deepEqual(askResource(fee), { type: "file", id: "fil_fee" });
  assert.deepEqual(askResource(L("lnk_2")), { type: "record", id: "rec_1042" }, "a record is asked for by its id");
  assert.equal(askResource(L("lnk_7")), null, "a pull request lives outside Vyre: nothing to ask for");
  assert.equal(titleOf({ ...L("lnk_1"), label: undefined }), "A task you don't have access to");
});

test("a pasted address becomes a pull request, a commit or a web link; text that is not an address is refused", () => {
  assert.deepEqual(parseAddress("https://github.com/northwind/website/pull/217"), { kind: "github.pr", ref: "northwind/website#217", label: "northwind/website#217", url: "https://github.com/northwind/website/pull/217" });
  assert.equal(parseAddress("https://github.com/northwind/website/commit/a41c9f2e")?.kind, "github.commit");
  assert.equal(parseAddress("https://github.com/northwind/website/commit/a41c9f2e")?.ref, "northwind/website@a41c9f2e");
  assert.deepEqual(parseAddress("https://www.example.com/page")?.kind, "url");
  assert.equal(parseAddress("not a link"), null);
  assert.equal(parseAddress("javascript:alert(1)"), null);
  assert.deepEqual(linkOfHit({ kind: "record", id: "rec_9", title: "Sam", recordType: "contact" }), { kind: "record", ref: "contact/rec_9", label: "Sam" });
  assert.equal(linkOfHit({ kind: "person", id: "usr_1", title: "Maya" }), null);
});

test("rules read as words and become the input the Space takes", () => {
  assert.equal(ruleText({ kind: "repo", repo: "northwind/website" }), "Everything from northwind/website");
  assert.equal(ruleText({ kind: "email_domain", domain: "client.com" }), "Email from @client.com");
  assert.equal(ruleText({ kind: "record_filter", recordType: "invoice", field: "client", equals: "Rivera" }), "Invoice where client is Rivera");
  assert.notEqual(ruleProblem(EMPTY_RULE), "");
  assert.equal(ruleProblem({ ...EMPTY_RULE, repo: "northwind/website" }), "");
  assert.notEqual(ruleProblem({ ...EMPTY_RULE, kind: "email_domain", domain: "nope" }), "");
  assert.deepEqual(ruleBody({ ...EMPTY_RULE, kind: "email_domain", domain: "@client.com" }), { kind: "email_domain", domain: "client.com" });
  assert.equal(ruleProblem({ ...EMPTY_RULE, kind: "record_filter", recordType: "invoice", field: "client", equals: "" }) !== "", true);
});

test("a day the Space wrote as 2025-10-24 reads in the person's own format; any other state is left as it is", () => {
  const now = Date.UTC(2025, 9, 24, 10);
  assert.equal(stateWords("Edited 2025-10-24", now, "en-GB"), "Edited 24 Oct");
  assert.equal(stateWords("Edited 2025-10-24", now, "en-US"), "Edited Oct 24");
  assert.equal(stateWords("On 2024-03-02", now, "en-GB"), "On 2 Mar 2024", "another year says its year");
  assert.equal(stateWords("Overdue", now), "Overdue");
  assert.equal(stateWords(undefined, now), undefined);
});

test("CI runs: how each reads, the line under it, and the failure the fix card talks about", () => {
  const [bad, ok, live] = RUNS();
  assert.deepEqual([bad, ok, live].map((r) => runLook(r!)), ["failed", "passed", "running"]);
  assert.equal(runLook({ state: "refused", conclusion: null }), "failed");
  assert.equal(runLook({ state: "queued", conclusion: null }), "waiting");
  assert.equal(runLine(bad!, NOW), "9 min ago · 4 m 00 s · $0.01");
  assert.equal(failedRun(RUNS())?.runId, "cir_1");
  assert.equal(failedRun([ok!, live!]), null);
  assert.match(fixAsk("Rivera account", bad!), /^@Assistant the checks failed in Rivera account \(northwind\/website, Checks · tests: 3 tests failed/);
});

test("the tab: groups, the total, the auto mark on what a rule linked, the rules and the CI rows", async () => {
  const { root, restore } = await tab();
  try {
    const text = textOf(root);
    for (const g of ["Tasks", "Records", "Files", "Chats", "Code", "Sites", "Link automatically"]) assert.ok(text.includes(g), g);
    assert.equal(textOf(find(root, "linked-total")), "12");
    assert.ok(find(root, "link-auto-lnk_2") && find(root, "link-auto-lnk_7"), "a rule's links are marked auto");
    assert.equal(find(root, "link-auto-lnk_1"), null, "a hand link is not");
    assert.ok(text.includes("Linked by you") && text.includes("Linked by Maya Chen") && text.includes("Linked by Assistant"));
    assert.ok(textOf(find(root, "link-state-lnk_2")).includes("Overdue") && textOf(find(root, "link-state-lnk_8")).includes("Merged"));
    assert.ok(text.includes("Invoice where client is Rivera") && text.includes("Everything from northwind/website"));
    assert.ok(text.includes("2 items linked"));
    assert.ok(find(root, "ci-rows") && find(root, "ci-run-cir_1") && find(root, "ci-why-cir_1"));
    assert.ok(textOf(find(root, "ci-why-cir_1")).includes("3 tests failed"), "the failure line");
    assert.ok(textOf(find(root, "ci-live")).includes("1 running"));
  } finally { restore(); }
});

test("the access test: a member who cannot open one linked item sees only its kind, gets a peek, and can ask for access", async () => {
  const { root, s, targets, restore } = await tab();
  try {
    const text = textOf(find(root, "link-lnk_5"));
    assert.ok(text.includes("A file you don't have access to") && text.includes("You can't open this"));
    assert.ok(!text.includes("Fee schedule"), "its name is never shown");
    await tap(root, "row-lk-lnk_5");
    assert.deepEqual(targets, [], "nothing opens: there is no place this person can open");
    assert.ok(find(root, "link-peek-lnk_5"), "a read-only peek shows instead");
    assert.ok(textOf(find(root, "link-peek-lnk_5")).includes("Linked by Lena Ortiz"));
    await tap(root, "link-ask-lnk_5");
    assert.deepEqual(writes(s.calls, "access.request").map((c) => c.input["resource"]), [{ type: "file", id: "fil_fee" }]);
    assert.equal(writes(s.calls, "access.request")[0]!.input["level"], "view");
    assert.ok(find(root, "link-asked-lnk_5"), "it says it asked");
    assert.equal(find(root, "link-ask-lnk_5"), null, "and does not ask twice");
    await tap(root, "row-lk-lnk_5");
    assert.equal(find(root, "link-peek-lnk_5"), null, "pressing again closes the peek");
  } finally { restore(); }
});

test("opening a link goes where reach says: a file, a record and a chat through the page, a task through the shell, a pull request at its own address", async () => {
  const { root, s, urls, targets, restore } = await tab();
  try {
    await tap(root, "row-lk-lnk_4"); await tap(root, "row-lk-lnk_2"); await tap(root, "row-lk-lnk_6");
    assert.deepEqual(s.opened, ["file:fil_1", "record:invoice/rec_1042", "thread:thr_intake"]);
    await tap(root, "row-lk-lnk_1");
    assert.deepEqual(targets, ["chats:subject=task:tsk_1"]);
    await tap(root, "row-lk-lnk_7");
    assert.deepEqual(urls, ["https://github.com/northwind/website/pull/214"]);
  } finally { restore(); }
});

test("Show filters the groups, with the count of each, and Link something is off for someone who cannot edit", async () => {
  const { root, restore } = await tab();
  try {
    await tap(root, "linked-show");
    for (const g of ["All", "Tasks", "Records", "Files", "Chats", "Code", "Sites"]) assert.ok(find(root, `menu-item-${g}`), g);
    assert.equal(textOf(find(root, "menu-count-Code")), "5");
    await tap(root, "menu-item-Files");
    assert.ok(find(root, "linked-group-Files") && !find(root, "linked-group-Code") && !find(root, "linked-group-Records"));
    assert.ok(textOf(find(root, "linked-show")).includes("Files"));
    await tap(root, "linked-show"); await tap(root, "menu-item-Code");
    assert.ok(find(root, "ci-rows"), "the CI rows are in the Code group");
  } finally { restore(); }
  const ro = await tab({}, { canEdit: false });
  try {
    for (const id of ["linked-add", "rule-new", "rule-remove-rul_1"]) assert.equal(find(ro.root, id), null, `${id} is for editors`);
    assert.ok(find(ro.root, "row-lk-lnk_4"), "reading is for everyone");
  } finally { ro.restore(); }
});

test("Unlink removes the link, says so, and Undo puts it back; an auto link says it will not come back", async () => {
  const { root, s, restore } = await tab();
  try {
    await tap(root, "link-more-lnk_4"); await tap(root, "menu-item-Unlink");
    assert.deepEqual(writes(s.calls, "projects.links.unlink").map((c) => c.input), [{ projectId: "prj_rivera", kind: "file", ref: "fil_1" }]);
    assert.equal(find(root, "link-lnk_4"), null);
    assert.ok(textOf(find(root, "linked-notice")).includes("Unlinked Service agreement"));
    await tap(root, "linked-undo");
    assert.equal(writes(s.calls, "projects.links.link").length, 1, "undo links it again");
    assert.equal(writes(s.calls, "projects.links.link")[0]!.input["ref"], "fil_1");
    assert.ok(s.state.links.some((l) => l.ref === "fil_1"));
    await tap(root, "link-more-lnk_2"); await tap(root, "menu-item-Unlink");
    assert.ok(textOf(find(root, "linked-notice")).includes("It will not come back"));
  } finally { restore(); }
});

test("a link's menu opens it, copies its link and unlinks it; a failed unlink says why", async () => {
  const { root, s, said, restore } = await tab();
  try {
    await tap(root, "link-more-lnk_6");
    assert.ok(find(root, "menu-item-report"), "Report a problem is the last item of a link's menu");
    await tap(root, "menu-item-Open");
    assert.deepEqual(s.opened, ["thread:thr_intake"]);
    await tap(root, "link-more-lnk_6"); await tap(root, "menu-item-Copy link");
    assert.ok(said.includes("Link copied"));
    s.fail("projects.links.unlink", "You may not change this project.");
    await tap(root, "link-more-lnk_6"); await tap(root, "menu-item-Unlink");
    assert.ok(said.includes("You may not change this project."));
    assert.ok(find(root, "link-lnk_6"), "it is still linked");
  } finally { restore(); }
});

test("Link something: search shows what is not linked yet, a pick links it, a pasted address links by its name, a bad one is refused", async () => {
  const { root, s, restore } = await tab();
  try {
    await tap(root, "linked-add");
    assert.ok(find(root, "link-sheet"));
    assert.ok(find(root, "link-pick-file:fil_terms") && find(root, "link-pick-record:contact/rec_sam") && find(root, "link-pick-chat:thr_billing"));
    assert.equal(find(root, "link-pick-file:fil_1"), null, "what is already linked is not offered");
    assert.ok(!textOf(find(root, "link-results")).includes("Maya Chen"), "a person cannot be linked");
    await typeInto(find(root, "link-search"), "terms"); await flush();
    assert.ok(writes(s.calls, "search.query").some((c) => c.input["q"] === "terms"));
    assert.ok(find(root, "link-pick-file:fil_terms") && !find(root, "link-pick-chat:thr_billing"));
    await tap(root, "row-link-pick-file:fil_terms");   // the pick is the ui/Row
    assert.deepEqual(writes(s.calls, "projects.links.link").map((c) => [c.input["kind"], c.input["ref"], c.input["label"]]), [["file", "fil_terms", "Service terms.pdf"]]);
    assert.equal(find(root, "link-pick-file:fil_terms"), null, "it leaves the offers once linked");
    assert.ok(textOf(find(root, "linked-notice")).includes("Linked Service terms.pdf"));
    await tap(root, "link-url-go");
    assert.ok(textOf(find(root, "link-line")).includes("Paste a link first"));
    await typeInto(find(root, "link-url"), "not a link"); await tap(root, "link-url-go");
    assert.ok(textOf(find(root, "link-line")).includes("does not look like a link"));
    await typeInto(find(root, "link-url"), "https://github.com/northwind/website/pull/217"); await tap(root, "link-url-go");
    const pr = writes(s.calls, "projects.links.link")[1]!.input;
    assert.deepEqual([pr["kind"], pr["ref"], pr["url"]], ["github.pr", "northwind/website#217", "https://github.com/northwind/website/pull/217"]);
    await typeInto(find(root, "link-url"), "https://example.com/brief"); await tap(root, "link-url-go");
    assert.equal(writes(s.calls, "projects.links.link")[2]!.input["kind"], "url");
    await tap(root, "link-done");
    assert.equal(find(root, "link-sheet"), null);
    assert.ok(find(root, "row-lk-lnk_101"), "the new link is on the page");
  } finally { restore(); }
});

test("Link something: a refused link says why and a search with no answer offers the paste field", async () => {
  const { root, s, restore } = await tab();
  try {
    await tap(root, "linked-add");
    s.fail("projects.links.link", "You can only link things you can open.");
    await tap(root, "row-link-pick-file:fil_terms");   // the pick is the ui/Row
    assert.ok(textOf(find(root, "link-line")).includes("You can only link things you can open."));
    await typeInto(find(root, "link-search"), "zzzz"); await flush();
    assert.ok(find(root, "link-nothing"));
  } finally { restore(); }
});

test("Link automatically: pick a kind, fill it in, and the rule is added next to the others; an incomplete rule says what is missing", async () => {
  const { root, s, restore } = await tab();
  try {
    await tap(root, "rule-new");
    assert.ok(find(root, "rule-sheet"));
    await tap(root, "rule-add");
    assert.ok(textOf(find(root, "rule-problem")).includes("owner/repo"));
    await tap(root, "rule-kind-email_domain");
    assert.ok(find(root, "rule-domain") && !find(root, "rule-repo"));
    await typeInto(find(root, "rule-domain"), "rivera.com"); await tap(root, "rule-add");
    const set = writes(s.calls, "projects.links.rules.set");
    assert.equal(set.length, 1);
    const sent = set[0]!.input["rules"] as Record<string, unknown>[];
    assert.deepEqual(sent.map((r) => r["kind"]), ["record_filter", "repo", "email_domain"], "the old rules stay, the new one joins");
    assert.equal(sent[0]!["ruleId"], "rul_1");
    assert.equal(sent[2]!["domain"], "rivera.com");
    assert.equal(find(root, "rule-sheet"), null);
    assert.ok(textOf(root).includes("Email from @rivera.com"));
    assert.ok(textOf(find(root, "linked-notice")).includes("Rule added"));
    await tap(root, "rule-new"); await tap(root, "rule-kind-record_filter");
    for (const id of ["rule-type", "rule-field", "rule-equals"]) assert.ok(find(root, id), id);
    await tap(root, "rule-cancel");
    assert.equal(find(root, "rule-sheet"), null);
  } finally { restore(); }
});

test("Remove a rule: the rule goes, the linked items stay, Undo brings it back", async () => {
  const { root, s, restore } = await tab();
  try {
    await tap(root, "rule-remove-rul_2");
    const sent = writes(s.calls, "projects.links.rules.set")[0]!.input["rules"] as { ruleId: string }[];
    assert.deepEqual(sent.map((r) => r.ruleId), ["rul_1"]);
    assert.equal(find(root, "rule-rul_2"), null);
    assert.ok(find(root, "link-lnk_7"), "what the rule linked stays");
    assert.ok(textOf(find(root, "linked-notice")).includes("Linked items stay"));
    await tap(root, "linked-undo");
    assert.equal((writes(s.calls, "projects.links.rules.set")[1]!.input["rules"] as unknown[]).length, 2);
    assert.ok(find(root, "rule-rul_2"));
  } finally { restore(); }
});

test("the fix card asks the Assistant about the newest failure, and is absent when nothing failed, when there is no CI, or when the page cannot start a chat", async () => {
  const { root, asked, restore } = await tab();
  try {
    assert.ok(textOf(find(root, "ci-fix")).includes("Checks failed on northwind/website"));
    await tap(root, "ci-fix-ask");
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /^@Assistant the checks failed in Rivera account/);
  } finally { restore(); }
  const none = await tab({ ci: false });
  try { assert.equal(find(none.root, "ci-rows"), null, "a project with no linked repository shows no CI"); assert.equal(find(none.root, "ci-fix"), null); } finally { none.restore(); }
  const bare = await tab({}, { askAssistant: undefined });
  try { assert.ok(find(bare.root, "ci-rows")); assert.equal(find(bare.root, "ci-fix"), null); } finally { bare.restore(); }
});

test("an empty project says what Linked is for, and a filter with nothing in it says so", async () => {
  const { root, restore } = await tab({ empty: true, ci: false });
  try {
    assert.ok(find(root, "linked-empty") && find(root, "rules-empty"));
    assert.equal(textOf(find(root, "linked-total")), "0");
  } finally { restore(); }
  const f = await tab({}, { show: "Sites" });
  try { assert.ok(find(f.root, "linked-group-Sites") && !find(f.root, "linked-none")); } finally { f.restore(); }
});

test("a read that fails says so instead of showing an empty tab", async () => {
  const restore = installDom();
  try {
    const s = createSampleLinked();
    s.fail("projects.links.list");
    const { createRoot } = await import("test-renderer");
    let made: { unmount(): void } | null = null;
    const root = await mount(() => { const r = createRoot(); made = r; return r; }, <ProjectPageDataProvider value={s.data}><LinkedTab projectId="prj_rivera" canEdit say={() => undefined} /></ProjectPageDataProvider>);
    await flush();
    try { assert.ok(find(root, "linked-failed"));
    assert.equal(find(root, "linked-empty"), null); } finally { await act(async () => { (made as { unmount(): void } | null)?.unmount(); }); }
  } finally { restore(); }
});

test("the shell's tab body mounts the tab, reading the project and the viewer's rights from the page", async () => {
  const restore = installDom();
  try {
    const s = createSampleLinked();
    const base = s.data.call;
    s.data.call = async (cap, input) => (cap === "projects.get" ? { project: { title: "Rivera account" } } : base(cap, input));
    const { createRoot } = await import("test-renderer");
    let made: { unmount(): void } | null = null;
    const root = await mount(() => { const r = createRoot(); made = r; return r; }, <ProjectPageDataProvider value={s.data}><ProjectLinked projectId="prj_rivera" space={{ id: "spc", kind: "team", name: "Northwind" }} canEdit={false} /></ProjectPageDataProvider>);
    await flush();
    try { assert.ok(find(root, "project-linked")); assert.equal(find(root, "linked-add"), null, "no control the person cannot use"); } finally { await act(async () => { (made as { unmount(): void } | null)?.unmount(); }); }
  } finally { restore(); }
});

test("with the page's own doors, a task, a pull request and the fix card go through data.nav", async () => {
  const restore = installDom();
  try {
    const s = createSampleLinked();
    const seen: string[] = [];
    Object.assign(s.data.nav, { openItem: (t: string, id: string) => void seen.push(`item:${t}:${id}`), openUrl: (u: string) => void seen.push(`url:${u}`), askAssistant: (t: string) => void seen.push(`ask:${t.slice(0, 30)}`) });
    const { createRoot } = await import("test-renderer");
    let made: { unmount(): void } | null = null;
    const root = await mount(() => { const r = createRoot(); made = r; return r; }, <ProjectPageDataProvider value={s.data}><LinkedTab projectId="prj_rivera" projectTitle="Rivera account" canEdit /></ProjectPageDataProvider>);
    await flush();
    try {
      await tap(root, "row-lk-lnk_1"); await tap(root, "row-lk-lnk_7"); await tap(root, "ci-fix-ask");
      assert.deepEqual(seen, ["item:task:tsk_1", "url:https://github.com/northwind/website/pull/214", "ask:@Assistant the checks failed i"]);
    } finally { await act(async () => { (made as { unmount(): void } | null)?.unmount(); }); }
  } finally { restore(); }
});

test("when the GitHub app needs new permissions the tab says so over the CI rows: an admin gets Accept (the organization's address when there is one), a member gets Ask an admin", async () => {
  const a = await tab({ accept: "personal", admin: true });
  try {
    assert.ok(textOf(find(a.root, "ci-accept")).includes("GitHub needs an admin to accept new permissions"));
    assert.equal(find(a.root, "ci-accept-ask"), null, "an admin has nobody to ask");
    await tap(a.root, "ci-accept-go");
    assert.deepEqual(a.urls, ["https://github.com/settings/installations/1"]);
    assert.ok(find(a.root, "ci-rows"), "the CI rows are still there");
  } finally { a.restore(); }
  const o = await tab({ accept: "org", admin: true });
  try { await tap(o.root, "ci-accept-go"); assert.deepEqual(o.urls, ["https://github.com/organizations/northwind/settings/installations/1"]); } finally { o.restore(); }
  const m = await tab({ accept: "personal" });
  try {
    assert.equal(find(m.root, "ci-accept-go"), null, "a member cannot accept on GitHub");
    await tap(m.root, "ci-accept-ask");
    const req = writes(m.s.calls, "access.request");
    assert.equal(req.length, 1);
    assert.deepEqual(req[0]!.input["resource"], { type: "space", id: "spc_nw" }, "the ask goes to the Space's admins, through the access rule");
    assert.match(String(req[0]!.input["note"]), /accept new permissions/);
    assert.ok(find(m.root, "ci-accept-told") && !find(m.root, "ci-accept-ask"), "it says it sent it, once");
    assert.deepEqual(m.urls, []);
  } finally { m.restore(); }
  const none = await tab();
  try { assert.equal(find(none.root, "ci-accept"), null); } finally { none.restore(); }
});

test("a project whose only link to its repository is a repo rule still shows its CI rows", async () => {
  const r = await tab({ ruleOnly: true });
  try {
    assert.equal(r.s.state.links.filter((l) => l.kind.startsWith("github")).length, 0, "no pull request is linked");
    assert.ok(find(r.root, "ci-rows") && find(r.root, "ci-run-cir_1") && find(r.root, "ci-fix"));
    assert.ok(textOf(r.root).includes("Everything from northwind/website"));
  } finally { r.restore(); }
});
