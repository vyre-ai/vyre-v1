// The side panel names the real cause when the app does not answer well: no host registered, an app of another version, or an app that is not running.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compareVersions, versionState } from "../src/worker/version.js";
import { createPanel } from "../src/worker/panel.js";
import { createPrivacy } from "../src/worker/privacy.js";
import { createStore } from "../src/worker/store.js";
import { BridgeFailure } from "../src/worker/protocol.js";
import { createChromeApp } from "../../../lib/chrome-app.ts";

function memoryArea() {
  const data: Record<string, unknown> = {};
  return { async get(keys: string[]) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); }, async set(i: Record<string, unknown>) { Object.assign(data, i); }, async remove(keys: string[]) { for (const k of keys) delete data[k]; } };
}

function world(o: { own: string; hello?: any; fail?: string }) {
  const tab = { id: 7, windowId: 3, active: true, url: "https://a.test/", title: "A", incognito: false };
  const store = createStore(memoryArea());
  const bridge = {
    async op(op: string) {
      if (op === "hello") { if (o.fail) throw new BridgeFailure(o.fail, "x"); return o.hello; }
      return { agents: [], suggested: null };
    },
    async invoke() { return {}; },
    onPush() { return () => {}; },
  };
  const ext = { tabs: { async query() { return [tab]; } }, runtime: { getManifest: () => ({ version: "1.0.0.22", version_name: o.own }) } };
  const privacy = createPrivacy(store);
  const context = { async read() { return { title: "", text: "", selection: "", emails: [], phones: [] }; }, async page(t: any) { return { tabId: t.id, url: t.url, title: t.title, host: "a.test", privacy: await privacy.of(t), page: null, shot: null }; }, async selection() { return ""; } };
  return createPanel({ ext, bridge, store, privacy, context: context as any });
}
const hello = (appVersion?: string) => ({ ...(appVersion ? { appVersion } : {}), spaces: [{ id: "spc_a", name: "A", webUrl: "" }], active: "spc_a", locked: false, signedIn: true });
const statusOf = async (w: any) => (await w.handle({ type: "panel.state", windowId: 3 })).data.status;

test("release names compare the way releases are numbered, and a final release is newer than its candidates", () => {
  assert.ok(compareVersions("1.0.0-rc.14", "1.0.0-rc.22")! < 0);
  assert.equal(compareVersions("1.0.0-rc.22", "1.0.0-rc.22"), 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.22")! > 0);
  assert.ok(compareVersions("1.0.1-rc.1", "1.0.0")! > 0);
  assert.equal(compareVersions("dev", "1.0.0"), null);
  assert.equal(compareVersions(undefined, "1.0.0"), null);
});

test("versionState: same or unknown is fine; an older extension is reloaded; a newer one needs the app updated", () => {
  assert.equal(versionState("1.0.0-rc.22", "1.0.0-rc.22"), "ok");
  assert.equal(versionState(undefined, "1.0.0-rc.22"), "ok");
  assert.equal(versionState("0.0.0-dev", "1.0.0-rc.22"), "ok");
  assert.equal(versionState("1.0.0-rc.22", "1.0.0-rc.14"), "reload");
  assert.equal(versionState("1.0.0-rc.14", "1.0.0-rc.22"), "update_app");
});

test("panel.state says which of the four things is wrong", async () => {
  assert.equal(await statusOf(world({ own: "1.0.0-rc.22", hello: hello("1.0.0-rc.22") })), "online");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.22", hello: hello() })), "online", "an app that sends no version is trusted");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.14", hello: hello("1.0.0-rc.22") })), "needs_reload");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.22", hello: hello("1.0.0-rc.14") })), "needs_app_update");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.22", fail: "no_host" })), "no_host");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.22", fail: "offline" })), "offline");
  assert.equal(await statusOf(world({ own: "1.0.0-rc.14", hello: { ...hello("1.0.0-rc.22"), signedIn: false } })), "signed_out", "signed out still wins");
});

test("the panel shows a different message for each cause, and none of them says the app is missing unless the host is", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/panel/panel.js"), "utf8");
  assert.match(src, /S\.status === "no_host"\) return e\(mark\(26\), "This browser can't find the Vyre app"/);
  assert.match(src, /S\.status === "needs_reload"\) return e\(mark\(26\), "Vyre needs updating: reload the extension"/);
  assert.match(src, /S\.status === "needs_app_update"\) return e\(mark\(26\), "Update the Vyre app"/);
  assert.match(src, /S\.status === "offline"\) return e\(mark\(26\), "The Vyre app is not running"/);
  assert.doesNotMatch(src, /not on this computer/);
});

test("the app puts its own version in hello when it knows it, and leaves the key out when it does not", async () => {
  const mk = (appVersion?: string) => createChromeApp({ sessions: () => [], call: async () => ({}), push: () => {}, ...(appVersion ? { appVersion } : {}) });
  assert.equal(((await mk("1.0.0-rc.22").op("hello", {})) as any).appVersion, "1.0.0-rc.22");
  assert.ok(!("appVersion" in ((await mk().op("hello", {})) as object)));
});
