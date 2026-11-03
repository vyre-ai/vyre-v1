// Opening an artifact from Vyre for Chrome: the app mints the one-time code as the signed-in person (bridge op artifact.open, lib/chrome-app.ts) and the worker opens the tab
// (apps/chrome/src/worker/artifacts.js). The code is a path on the artifact host, never a token in a URL; with no artifact host or nobody signed in the tab gets the plain /a/<id>.
import test from "node:test";
import assert from "node:assert/strict";
import { createArtifacts } from "../src/worker/artifacts.js";
import { BridgeFailure, parseIncoming } from "../src/worker/protocol.js";
import { createChromeApp } from "../../../lib/chrome-app.ts";

const CODE = "c".repeat(48);
const SID = "sit_abc123";

function appWith(o: { signedIn?: boolean; reply?: (cap: string, input: any) => unknown } = {}) {
  const calls: { cap: string; input: any; as: string }[] = [];
  const sessions = o.signedIn === false ? [] : [{ id: "spc_me", name: "Personal", address: "https://harbor.vyre.run", token: "vst_me" }];
  const app = createChromeApp({
    sessions: () => sessions,
    call: async (sess, cap, input) => {
      calls.push({ cap, input, as: sess.token });
      const r = o.reply ? o.reply(cap, input) : { path: `/x/${CODE}`, url: `https://harbor-a.vyre.run/x/${CODE}`, expiresAt: 1 };
      if (r instanceof Error) throw r;
      return r;
    },
    push: () => {},
    setTimer: () => 0,
  });
  return { app, calls };
}

/** The worker around that app: bridge.op goes straight to the app, the tabs are recorded. */
function workerWith(a: ReturnType<typeof appWith>) {
  const tabs: string[] = [];
  const store = { async get() { return { spaces: [{ id: "spc_me", name: "Personal", webUrl: "https://harbor.vyre.run" }], activeSpace: "spc_me" }; } };
  const bridge = {
    async op(op: string, input: any) {
      try { return await a.app.op(op, input); } catch (e: any) { throw new BridgeFailure(e.code === "signed_out" ? "signed_out" : e.code || "error", e.message); }
    },
  };
  const artifacts = createArtifacts({ ext: { tabs: { async create(o: any) { tabs.push(o.url); } } }, bridge, store });
  return { artifacts, tabs };
}

test("artifact.open mints the code as the signed-in person and the tab opens the host's /x/<code>", async () => {
  const a = appWith();
  const w = workerWith(a);
  assert.deepEqual(await w.artifacts.open(SID), { opened: "host" });
  assert.deepEqual(w.tabs, [`https://harbor-a.vyre.run/x/${CODE}`]);
  assert.deepEqual(a.calls.map((c) => [c.cap, c.input, c.as]), [["sites.artifact_open", { artifactId: SID }, "vst_me"]], "the person's own session");
});

test("a keyed address (a token in the URL) is never opened: the tab gets the plain /a/<id>", async () => {
  const a = appWith({ reply: () => ({ path: `/a/${SID}/k/${"d".repeat(48)}/`, url: `https://harbor.vyre.run/a/${SID}/k/${"d".repeat(48)}/`, expiresAt: 1 }) });
  const w = workerWith(a);
  assert.deepEqual(await w.artifacts.open(SID), { opened: "web" });
  assert.deepEqual(w.tabs, [`https://harbor.vyre.run/a/${SID}`]);
  assert.ok(!w.tabs.some((u) => /\/k\//.test(u)));
});

test("not shared with this person: no code, and the plain address shows the app's own no-access page", async () => {
  const a = appWith({ reply: () => Object.assign(new Error("You don't have access."), { code: "permission.no_grant" }) });
  const w = workerWith(a);
  assert.deepEqual(await w.artifacts.open(SID), { opened: "web" });
  assert.deepEqual(w.tabs, [`https://harbor.vyre.run/a/${SID}`]);
});

test("nobody signed in on this computer: the plain address, where the web app asks for its sign-in and then continues", async () => {
  const a = appWith({ signedIn: false });
  const w = workerWith(a);
  assert.deepEqual(await w.artifacts.open(SID), { opened: "web" });
  assert.deepEqual(w.tabs, [`https://harbor.vyre.run/a/${SID}`]);
  assert.equal(a.calls.length, 0, "nothing is minted for nobody");
});

test("only an artifact id is accepted, from the app's push and from the worker", async () => {
  const w = workerWith(appWith());
  for (const bad of ["", "../x", "sit_", "sit_ABC", `sit_${"a".repeat(90)}`, "https://evil.test/"]) await assert.rejects(w.artifacts.open(bad), (e: any) => e.code === "bad_input", bad);
  assert.deepEqual(parseIncoming({ type: "artifact.open", artifactId: SID }), { type: "artifact.open", artifactId: SID });
  assert.equal(parseIncoming({ type: "artifact.open", artifactId: "../x" }), null);
  assert.equal(w.tabs.length, 0);
  const a = appWith();
  await assert.rejects(a.app.op("artifact.open", { artifactId: "nope" }), (e: any) => e.code === "validation.invalid");
});
