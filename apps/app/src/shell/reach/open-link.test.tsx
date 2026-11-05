// /open/<kind>/<id> (owner, 4 Nov): signs in if needed, then reach decides: the deepest place the person can open, else the safe peek with Ask for access, never a dead end.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { decideOpen, holdOpen, onOpenHeld, parseOpenPath, peekOpen, takeOpen, targetOfOpen } from "./open-link.ts";
import { OpenLink } from "./OpenLink.tsx";
import { routeDesktopLink } from "../session/desktop.ts";
import type { Judge } from "./target.ts";

const judgeOf = (denied: string[] = []): Judge => ({
  viewer: () => ({ id: "usr_maya" }), consolePages: async () => new Set(), memo: new Map(),
  call: async (cap) => { if (denied.includes(cap)) throw Object.assign(new Error("no"), { code: "permission.no_grant" }); return {}; },
});

test("the path is read strictly: /open/<kind>/<id> only", () => {
  assert.deepEqual(parseOpenPath("/open/file/fil_1"), { kind: "file", id: "fil_1" });
  assert.deepEqual(parseOpenPath("/open/vault/vit_1/"), { kind: "vault", id: "vit_1" });
  for (const bad of ["/open", "/open/file", "/open/file/a/b", "/open/File/x", "/open/file/%zz", "/open/file/a b", "/chat", "/open/../x/y"]) assert.equal(parseOpenPath(bad), null, bad);
});

test("one message's link, /open/message/<threadId>/<messageId>, opens its chat on that message, and reach reads the chat", async () => {
  const item = parseOpenPath("/open/message/thr_a/msg_9");
  assert.deepEqual(item, { kind: "message", id: "thr_a", at: "msg_9" });
  assert.deepEqual(targetOfOpen(item!), { subject: { type: "thread", id: "thr_a" }, args: { m: "msg_9" } });
  for (const bad of ["/open/message/thr_a/msg 9", "/open/message/thr_a/%zz", "/open/message/thr_a/m/x"]) assert.equal(parseOpenPath(bad), null, bad);
  assert.deepEqual(targetOfOpen(parseOpenPath("/open/message/thr_a")!), { subject: { type: "thread", id: "thr_a" } }, "without a message it is the chat");
  const asked: string[] = [];
  const no = await decideOpen(item!, { viewer: () => ({ id: "usr_b", spaceId: "spc_1" }), call: async (cap) => { asked.push(cap); throw Object.assign(new Error("no"), { code: "permission.no_grant" }); }, consolePages: async () => new Set<string>(), memo: new Map() });
  assert.deepEqual(asked, ["threads.get"], "the chat is read before the message is shown");
  assert.equal(no.to, "peek");
  assert.deepEqual(no.to === "peek" ? no.ask : null, { type: "thread", id: "thr_a" }, "Ask for access asks for the chat");
});

const KINDS: Array<[string, string, string, Record<string, unknown>]> = [
  ["file", "files.get", "file", { subject: { type: "file", id: "x1" } }],
  ["folder", "files.folder.get", "folder", { subject: { type: "folder", id: "x1" } }],
  ["record", "", "", { subject: { type: "record", id: "x1" } }],
  ["task", "tasks.get", "task", { subject: { type: "task", id: "x1" } }],
  ["chat", "threads.get", "chat", { subject: { type: "thread", id: "x1" } }],
  ["agent", "agents.get", "agent", { subject: { type: "agent", id: "x1" } }],
  ["automation", "automations.get", "automation", { subject: { type: "automation", id: "x1" } }],
  ["run", "runs.get", "run", { subject: { type: "run", id: "x1" } }],
  ["project", "projects.get", "project", { subject: { type: "project", id: "x1" } }],
  ["note", "", "", { screen: "chats.notes", args: { noteId: "x1" } }],
  ["record_type", "", "", { screen: "records.types", args: { type: "x1" } }],
  ["vault", "", "", { screen: "vault.layout", args: { share: "x1" } }],
];

test("each kind names the page it opens", () => {
  for (const [kind, , , want] of KINDS) assert.deepEqual(targetOfOpen({ kind, id: "x1" }), want, kind);
  assert.equal(targetOfOpen({ kind: "spaceship", id: "x" }), null);
});

test("a person with access goes to the page; one without gets the safe peek, never the name, and a way to ask", async () => {
  for (const [kind, cap, type] of KINDS) {
    const open = await decideOpen({ kind, id: "x1" }, judgeOf());
    assert.equal(open.to, "open", `${kind} with access`);
    if (cap === "") continue; // kinds the Space's own page checks (no read ahead): they open and the page answers
    const peek = await decideOpen({ kind, id: "x1" }, judgeOf([cap]));
    assert.equal(peek.to, "peek", `${kind} without access`);
    if (peek.to === "peek") {
      assert.match(peek.text, /you don't have access to$/);
      assert.ok(peek.text.toLowerCase().includes(type === "chat" ? "chat" : type), peek.text);
      assert.ok(peek.ask !== null && peek.ask.id === "x1", "a way to ask");
    }
  }
});

test("records, record types, notes and Vault items are checked before the page opens: none lands on the page's own refusal", async () => {
  const j = (level: string, denyNote = false): Judge => ({ viewer: () => ({ id: "u" }), consolePages: async () => new Set(), memo: new Map(), call: async (cap, input) => {
    if (cap === "access.reach") return { items: (input as { items: Array<{ type: string; id: string }> }).items.map((x) => ({ ...x, level })) };
    if (cap === "memory.read_note" && denyNote) throw Object.assign(new Error("no"), { code: "permission.no_grant" });
    return {};
  } });
  for (const kind of ["record", "record_type", "vault"]) {
    assert.equal((await decideOpen({ kind, id: "x1" }, j("view"))).to, "open", `${kind} with access`);
    const d = await decideOpen({ kind, id: "x1" }, j("none"));
    assert.equal(d.to, "peek", `${kind} without access`);
    assert.ok(d.to === "peek" && d.ask !== null);
  }
  assert.equal((await decideOpen({ kind: "note", id: "n1" }, j("view"))).to, "open");
  assert.equal((await decideOpen({ kind: "note", id: "n1" }, j("view", true))).to, "peek");
});

test("a link to something no page shows still ends somewhere: a peek that says so", async () => {
  const d = await decideOpen({ kind: "spaceship", id: "x" }, judgeOf());
  assert.equal(d.to, "peek");
});

test("a signed-out visitor's link is held through sign-in and acted on once, after", () => {
  let told = 0;
  const off = onOpenHeld(() => { told++; });
  holdOpen({ kind: "file", id: "fil_1" });
  assert.deepEqual(peekOpen(), { kind: "file", id: "fil_1" }, "still there while the sign-in screen shows");
  assert.deepEqual(takeOpen(), { kind: "file", id: "fil_1" });
  assert.equal(takeOpen(), null, "taken once");
  assert.equal(told, 1);
  off();
});

test("the desktop deep link names the Space, the kind and the id; anything malformed is plain sign-in", () => {
  const r = routeDesktopLink({ action: "open", params: { address: "https://acme.vyre.run", kind: "file", id: "fil_1" } });
  assert.deepEqual(r && r.kind === "signin" ? r.item : null, { kind: "file", id: "fil_1" });
  const bad = routeDesktopLink({ action: "open", params: { address: "https://acme.vyre.run", kind: "File!", id: "x" } });
  assert.equal(bad && bad.kind === "signin" ? bad.item : "x", undefined);
  assert.equal(routeDesktopLink({ action: "open", params: { kind: "file", id: "fil_1" } }), null, "no address");
});

test("the link acts once a Space is open: a person with access is taken there; a person without sees the peek, asks, and is never left on a blank page", async () => {
  const restore = installDom();
  try {
    const log = { opened: [] as unknown[], went: [] as string[], calls: [] as Array<[string, unknown]> };
    const denied: string[] = [];
    const rt = {
      call: async (cap: string, input: unknown) => { log.calls.push([cap, input]); if (denied.includes(cap)) throw Object.assign(new Error("no"), { code: "permission.no_grant" }); return {}; },
      open: (t: unknown) => { log.opened.push(t); },
    };
    const hub = { go: (p: string) => { log.went.push(p); } } as never;
    const root = await mount(createRoot, <OpenLink hub={hub} rt={rt as never} me="usr_maya" spaceId="spc_1" />);
    holdOpen({ kind: "file", id: "fil_1" });
    await flush(); await flush();
    assert.deepEqual(log.opened, [{ subject: { type: "file", id: "fil_1" } }]);
    assert.equal(find(root, "open-link-peek"), null);

    denied.push("files.get");
    holdOpen({ kind: "file", id: "fil_2" });
    await flush(); await flush();
    assert.equal(log.opened.length, 1, "the page never opens");
    assert.deepEqual(log.went, ["chats"], "the person lands somewhere");
    assert.ok(textOf(find(root, "open-link-peek") as never).includes("A file you don't have access to"));
    await press(find(root, "open-link-ask"));
    await flush();
    assert.ok(find(root, "open-link-asked"));
    assert.equal(log.calls.at(-1)![0], "access.request");
  } finally { restore(); }
});
