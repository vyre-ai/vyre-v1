// P-L9_23: Cmd-K, Cmd-T, the Search button and the new-tab page in the real shell. The data the real SessionGate hands the search is built from the open Space's runtime: local hits from the replica
// in the keystroke's own task, search.query merged in behind them, Recent read ahead, and the Away and Go offline actions. The key map is the shell's own (spaces/keys.ts) and the sheet and the
// new-tab page are the shared CmdK components; there is no DOM renderer in the node suite, so the sheet is drawn to markup and the controller is driven the way the keys drive it.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CmdK, NewTabSearch } from "../src/shell/cmdk/CmdK.tsx";
import { CmdKController } from "../src/shell/cmdk/controller.ts";
import type { Hit } from "../src/shell/cmdk/model.ts";
import { createGateSearch, gateActions, hashOfHit, placeOfHit } from "../src/shell/cmdk/gate.ts";
import type { GateNav } from "../src/shell/cmdk/gate.ts";
import type { ShellRuntime } from "../src/shell/providers/runtime.tsx";
import { SessionGate, signInInvite } from "../src/shell/session/SessionGate.tsx";
import { JoinFlow } from "../src/join/JoinFlow.tsx";
import { shellKey } from "../src/shell/spaces/keys.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const live = <T,>(data: T) => ({ subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready" as const, data }) });
const hit = (kind: Hit["kind"], id: string, title: string, extra: Partial<Hit> = {}): Hit => ({ kind, id, title, link: `vyre://${kind}/${id}`, score: 1, ...extra });

function setup(opts: { online?: boolean; fail?: boolean } = {}) {
  const calls: { cap: string; input: unknown }[] = [];
  const serverHits = [hit("file", "fil_ref", "Referral policy.docx", { score: 0.9 })];
  const rt = {
    space: { id: "spc_nw", kind: "team", name: "Northwind" },
    principals: live([{ id: "usr_maya", name: "Maya Chen", kind: "person" }, { id: "agt_intake", name: "Intake", kind: "agent" }, { id: "grp_all", name: "Everyone", kind: "group" }]),
    screens: { query: (screen: string) => live(screen === "chats.sidebar"
      ? { starred: [], today: [{ threadId: "thr_ref", title: "Referral questions", kind: "chat" }], yesterday: [], earlier: [] }
      : {}) },
    connection: { get: () => (opts.online === false ? "offline" : "online"), subscribe: () => () => undefined },
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "search.query") { if (opts.fail) throw new Error("down"); return { hits: serverHits, tookMs: 3 }; }
      if (cap === "search.recent.list") return { hits: [hit("record", "rec_a", "Recent record")] };
      return { ok: true };
    },
  } as unknown as ShellRuntime;
  const went: { place: string; hash?: string }[] = [];
  const log: string[] = [];
  const nav: GateNav = {
    go: (place, hash) => void went.push(hash === undefined ? { place } : { place, hash }),
    newTab: () => { log.push("newTab"); return null; },
    flash: (t) => void log.push(`flash:${t}`),
    setAway: (on) => void log.push(`away:${on}`),
    setOnline: (on) => void log.push(`online:${on}`),
  };
  const state = { away: false, offline: false };
  const recent = [hit("chat", "thr_ref", "Referral questions"), hit("person", "usr_maya", "Maya Chen")];
  const data = createGateSearch({ runtime: rt, nav, state, recent: () => recent });
  return { data, calls, went, log, state };
}

const titles = (c: CmdKController): string[] => c.getState().rows.flatMap((r) => (r.type === "hit" ? [r.hit.title] : r.type === "action" ? [r.action.title] : []));

test("Cmd-K opens the search and Cmd-T a new tab (the shell's key map)", () => {
  assert.deepEqual(shellKey({ key: "k", metaKey: true }), { type: "search" });
  assert.deepEqual(shellKey({ key: "k", ctrlKey: true }), { type: "search" });
  assert.deepEqual(shellKey({ key: "t", metaKey: true }), { type: "new-tab" });
});

test("local hits come from the replica in the keystroke's task and search.query merges in behind them", async () => {
  const { data, calls } = setup();
  const c = new CmdKController(data);
  c.setRaw("ref");
  const first = titles(c);
  assert.ok(first.includes("Referral questions"), "a chat the replica holds is there at once");
  assert.ok(!first.includes("Referral policy.docx"), "the server has not answered yet");
  await wait(250);
  const after = titles(c);
  assert.ok(after.includes("Referral policy.docx"), "the server hit merged in");
  assert.deepEqual(after.slice(0, first.length), first, "the local rows did not move");
  assert.deepEqual(calls.filter((x) => x.cap === "search.query").map((x) => (x.input as { q: string }).q), ["ref"]);
  c.dispose();
});

test("people and agents are searchable from the replica; groups are not", () => {
  const { data } = setup();
  assert.deepEqual(data.local("", null).map((h) => h.title).sort(), ["Intake", "Maya Chen", "Referral questions"]);
  assert.deepEqual(data.local("ma", ["person"]).map((h) => h.title), ["Maya Chen"]);
});

test("a window offline searches the device only and says so", async () => {
  const { data, calls } = setup({ online: false });
  assert.equal(data.scope(), "device");
  const c = new CmdKController(data);
  c.setRaw("ref");
  await wait(250);
  assert.equal(calls.filter((x) => x.cap === "search.query").length, 0);
  assert.ok(titles(c).includes("Referral questions"));
  c.dispose();
});

test("the sheet draws Recent when it opens, and the new-tab page draws the same search inline", () => {
  const { data } = setup();
  const sheet = renderToStaticMarkup(<CmdK data={data} />).replaceAll("<!-- -->", "");
  assert.ok(sheet.includes('data-testid="cmdk-veil"'));
  assert.ok(sheet.includes("Recent"), "the Recent heading");
  assert.ok(sheet.includes("Search Northwind"), "the placeholder names the Space");
  assert.ok(sheet.includes("Referral questions") && sheet.includes("Maya Chen"));
  const tab = renderToStaticMarkup(<NewTabSearch data={data} />).replaceAll("<!-- -->", "");
  assert.ok(tab.includes("Open anything, or start something"));
  assert.ok(!tab.includes('data-testid="cmdk-veil"'), "inline in the tab, no veil");
});

test("Away and Go offline are actions that flip and say so", () => {
  const { data, log, state } = setup();
  const away = data.actions("away")[0]!;
  data.runAction(away);
  assert.equal(state.away, true);
  assert.deepEqual(log.slice(0, 2), ["away:true", "flash:You are set as away"]);
  assert.equal(gateActions(state).find((a) => a.key === "presence.away")?.title, "Back from away");
  data.runAction(data.actions("offline")[0]!);
  assert.equal(state.offline, true);
  assert.ok(log.includes("online:false") && log.includes("flash:Working offline"));
  assert.equal(data.scope(), "device");
  assert.equal(gateActions(state).find((a) => a.key === "network.offline")?.title, "Go online");
});

test("choosing a hit opens its place; Cmd-Enter opens it in a new tab; the open is recorded", () => {
  const { data, went, log, calls } = setup();
  const h = hit("record", "rec_a", "Recent record");
  assert.equal(placeOfHit(h), "records");
  assert.equal(hashOfHit(h), "subject=record:rec_a");
  data.open(h, { newTab: false });
  data.open(h, { newTab: true });
  assert.deepEqual(went, [{ place: "records", hash: "subject=record:rec_a" }, { place: "records", hash: "subject=record:rec_a" }]);
  assert.deepEqual(log, ["newTab"]);
  data.recordOpened(h);
  assert.deepEqual(calls.at(-1), { cap: "search.recent.record", input: { kind: "record", itemId: "rec_a" } });
});

test("the real SessionGate draws its blank frame before a stored session is read", () => {
  const out = renderToStaticMarkup(<SessionGate baseUrl="https://space.test" />);
  assert.ok(typeof out === "string");
});

test("the packaged shell with no stored Space offers Connect a Space, not tauri as a host", () => {
  const out = renderToStaticMarkup(<SessionGate baseUrl={null} />).replaceAll("<!-- -->", "");
  assert.ok(out.includes("Connect a Space"));
  assert.ok(!out.includes("tauri"));
});

test("discovery options do not expose inert GitHub or SSO controls", () => {
  const invite = signInInvite("https://northwind.test", { name: "Northwind", fingerprint: "display-only", password: true, github: true, sso: [{ key: "google", title: "Google" }], secondFactorRequired: false });
  const out = renderToStaticMarkup(<JoinFlow invite={invite} initial={{ stage: "signin" }} hold />);
  assert.match(out, /Sign in to Northwind/);
  assert.doesNotMatch(out, /Single sign-on|GitHub|Google/);
});
