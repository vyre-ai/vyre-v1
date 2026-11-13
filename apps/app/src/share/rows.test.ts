// The item's own link and the call input the Share sheet builds: an artifact has its address on the Space, every other kind its vyre:// deep link, never the page the person is on.
import test from "node:test";
import assert from "node:assert/strict";
import { callbackOrigin, copyItemLink, itemLink, linkOrigin, messageLink, setLinkOrigin, withNotify } from "./rows.ts";
import { targetOfOpen } from "../shell/reach/open-link.ts";
import { notices } from "../shell/noticeslot/model.ts";

test("an artifact links to its own address on the Space; every other kind to the Space's /open link, never vyre://", () => {
  const o = "https://northwind.vyre.run";
  assert.equal(itemLink("site", "sit_ab12", o), `${o}/a/sit_ab12`);
  assert.equal(itemLink("note", "not_1", o), `${o}/open/note/not_1`);
  assert.equal(itemLink("agent", "agt_dex", o), `${o}/open/agent/agt_dex`);
  assert.equal(itemLink("folder", "fld_1", o), `${o}/open/folder/fld_1`);
  assert.equal(itemLink("record_type", "deal", o), `${o}/open/record_type/deal`);
  assert.equal(itemLink("vault_item", "vit_1", o), `${o}/open/vault/vit_1`);
  assert.equal(itemLink("automation", "aut_1", o), `${o}/open/automation/aut_1`);
  for (const t of ["note", "agent", "folder", "record", "project"])
    assert.ok(!itemLink(t, "x", o).startsWith("vyre://"), t);
});

test("withNotify adds notify only when the person asked to tell them, with the message", () => {
  const base = { resource: { type: "agent", id: "agt_dex" } };
  assert.deepEqual(withNotify(base), base);
  assert.deepEqual(withNotify(base, { notify: false }), base);
  assert.deepEqual(withNotify(base, { notify: true }), { ...base, notify: {} });
  assert.deepEqual(withNotify(base, { notify: true, message: "Take a look" }), {
    ...base,
    notify: { message: "Take a look" },
  });
});

// 13 Nov 2026: the Share sheet's Copy link copied tauri://localhost/a/<id> from the desktop app (the link was made from the page's origin), which opens nowhere.
test("a link is made from the Space's own address, never from the page the app runs in (tauri:// on desktop), and a Space with no public address gives words, not a dead link", () => {
  const g = globalThis as Record<string, unknown>;
  const had = {
    location: Object.getOwnPropertyDescriptor(g, "location"),
    navigator: Object.getOwnPropertyDescriptor(g, "navigator"),
  };
  const put = (k: string, v: unknown): void =>
    void Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  const copied: string[] = [];
  put("location", { origin: "tauri://localhost" });
  put("navigator", { clipboard: { writeText: async (t: string) => void copied.push(t) } });
  try {
    setLinkOrigin("https://mla.vyre.run");
    assert.equal(itemLink("site", "sit_ab12"), "https://mla.vyre.run/a/sit_ab12");
    assert.equal(itemLink("note", "not_1"), "https://mla.vyre.run/open/note/not_1");
    assert.equal(messageLink("thr_1", "msg_1"), "https://mla.vyre.run/open/message/thr_1/msg_1");
    copyItemLink("site", "sit_ab12");
    assert.deepEqual(copied, ["https://mla.vyre.run/a/sit_ab12"], "what lands on the clipboard on desktop");
    // Windows desktop
    put("location", { origin: "http://tauri.localhost" });
    assert.equal(itemLink("site", "sit_ab12"), "https://mla.vyre.run/a/sit_ab12");
    // a web app opened at the Space itself
    setLinkOrigin(null);
    put("location", { origin: "https://team.example.com" });
    assert.equal(itemLink("site", "sit_ab12"), "https://team.example.com/a/sit_ab12");
    // a Space with no public address (decision, 14 Nov): the WEB page at a local or network address copies its own origin (it opens for that person); the DESKTOP app copies the in-app form, which opens in Vyre on
    // this computer only, and says so; a link meant for OTHER people (the Share sheet) on desktop is never that form: words
    for (const local of ["http://127.0.0.1:8420", "http://localhost:8420"]) {
      setLinkOrigin(local);
      put("location", { origin: local });
      assert.equal(linkOrigin(), "", local);
      assert.equal(itemLink("site", "sit_ab12"), `${local}/a/sit_ab12`, `web at ${local}`);
    }
    // a Space on a network address (not loopback) is an address like any other: its link opens for people on that network
    setLinkOrigin("http://192.168.1.5:8420");
    put("location", { origin: "tauri://localhost" });
    assert.equal(itemLink("site", "sit_ab12"), "http://192.168.1.5:8420/a/sit_ab12");
    setLinkOrigin("http://127.0.0.1:8420");
    const inApp = `vyre://open?address=${encodeURIComponent("http://127.0.0.1:8420")}&kind=note&id=not_1`;
    assert.equal(itemLink("note", "not_1"), inApp);
    copied.length = 0;
    copyItemLink("note", "not_1");
    assert.deepEqual(copied, [inApp], "a personal copy on desktop: the in-app form");
    // an artifact has no in-app form the resolver on this branch opens: no link, said in words, never a link that opens nothing
    assert.equal(itemLink("site", "sit_ab12"), "");
    copied.length = 0;
    copyItemLink("site", "sit_ab12");
    assert.deepEqual(copied, []);
    assert.match(JSON.stringify(notices.getSnapshot()), /opens in Vyre on this computer only/);
    copied.length = 0;
    copyItemLink("note", "not_1", true);
    assert.deepEqual(copied, [], "a link for other people: nothing dead is copied");
    assert.match(JSON.stringify(notices.getSnapshot()), /no public address yet, so there is no link to give/);
    // no address at all
    setLinkOrigin(null);
    assert.equal(itemLink("site", "sit_ab12"), "");
  } finally {
    setLinkOrigin(null);
    for (const k of ["location", "navigator"] as const) {
      if (had[k]) Object.defineProperty(g, k, had[k]!);
      else delete g[k];
    }
  }
});

test("a sign-in comes back to exactly what rc.26 sent on the web (the page's origin), and to the Space's own address in the desktop app", () => {
  const g = globalThis as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(g, "location");
  const put = (v: unknown): void =>
    void Object.defineProperty(g, "location", { value: v, configurable: true, writable: true });
  const rc26 = (): string => (g["location"] as { origin: string }).origin; // what rc.26 sent: the page's origin
  try {
    // web, by shape: served at the Space's own address; at the phone name with the Space known by another address; at a local address; with the session pointing elsewhere (?space=)
    for (const [page, space] of [
      ["https://mla.vyre.run", "https://mla.vyre.run"],
      ["https://harbor.vyre.run", "https://team.example.com"],
      ["http://127.0.0.1:8420", "http://127.0.0.1:8420"],
      ["http://192.168.1.5:8420", "http://192.168.1.5:8420"],
      ["https://app.example.com", "https://space.other.example"],
    ] as const) {
      put({ origin: page });
      setLinkOrigin(space);
      assert.equal(callbackOrigin(), rc26(), `web at ${page} with the Space at ${space}`);
    }
    // desktop
    setLinkOrigin("https://mla.vyre.run");
    put({ origin: "tauri://localhost" });
    assert.equal(callbackOrigin(), "https://mla.vyre.run");
    put({ origin: "http://tauri.localhost" });
    assert.equal(callbackOrigin(), "https://mla.vyre.run");
    setLinkOrigin("http://127.0.0.1:8420");
    assert.equal(
      callbackOrigin(),
      "",
      "desktop on a Space with no public address: nothing can come back (rc.26 sent tauri://localhost, which never worked)",
    );
    put({ origin: "tauri://localhost" });
    assert.equal(callbackOrigin(), "");
  } finally {
    setLinkOrigin(null);
    if (had) Object.defineProperty(g, "location", had);
    else delete g.location;
  }
});

test("round trip: every kind the maker can write in the in-app form is one the app's resolver opens; a kind it cannot open gives no link", () => {
  const g = globalThis as Record<string, unknown>;
  const had = Object.getOwnPropertyDescriptor(g, "location");
  Object.defineProperty(g, "location", { value: { origin: "tauri://localhost" }, configurable: true, writable: true });
  try {
    setLinkOrigin("http://127.0.0.1:8420");
    const types = [
      "site",
      "note",
      "agent",
      "folder",
      "file",
      "record",
      "project",
      "person",
      "chat",
      "automation",
      "record_type",
      "vault_item",
      "vault_folder",
      "task",
      "goal",
      "channel",
      "thread",
      "run",
      "skill",
      "computer",
      "unknown_kind",
    ];
    for (const type of types) {
      const link = itemLink(type, "x_1");
      if (link === "") continue; // no link is truthful; a link that opens nothing is the fault
      const u = new URL(link);
      assert.equal(u.protocol, "vyre:", type);
      const kind = u.searchParams.get("kind")!;
      assert.notEqual(targetOfOpen({ kind, id: u.searchParams.get("id")! }), null, `${type} -> ${link} opens nothing`);
    }
    assert.notEqual(itemLink("note", "x_1"), "", "a kind that opens does get its link");
  } finally {
    setLinkOrigin(null);
    if (had) Object.defineProperty(g, "location", had);
    else delete g.location;
  }
});
