// This computer links to each signed-in Team Space through the desktop shell, so the person's chats there can run here (lane l-runson).
import test from "node:test";
import assert from "node:assert/strict";
import { linkComputer, linkable, unlinkComputer } from "./computer-link.ts";
import type { StoredSession } from "./stored.ts";

const def = (spaceId: string, kind: "team" | "personal") => ({ spaceId, name: spaceId, kind, kit: "office", skinDefault: "x", tint: ["a", "b"], counts: {}, dots: {} }) as unknown as StoredSession["def"];
const s = (spaceId: string, kind: "team" | "personal", baseUrl: string): StoredSession => ({ baseUrl, token: `vst_${spaceId}`, def: def(spaceId, kind), personId: "usr_dana", marker: "m" });

test("every signed-in Team Space elsewhere is linked for chats; a Personal Space and one on this computer go to Vyre for Chrome only", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const invoke = async (c: string, a?: Record<string, unknown>) => { calls.push([c, a]); return null; };
  const sessions = [s("spc_mla", "team", "https://mla.vyre.run"), s("spc_me", "personal", "http://127.0.0.1:4100"), s("spc_mac", "team", "http://127.0.0.1:8420")];
  assert.equal(await linkComputer(sessions, invoke), 1, "one Space is linked for chats");
  assert.deepEqual(calls, [
    ["link_chrome_space", { id: "spc_mla", name: "spc_mla", address: "https://mla.vyre.run", token: "vst_spc_mla", compute: true }],
    ["link_chrome_space", { id: "spc_me", name: "spc_me", address: "http://127.0.0.1:4100", token: "vst_spc_me", compute: false }],
    ["link_chrome_space", { id: "spc_mac", name: "spc_mac", address: "http://127.0.0.1:8420", token: "vst_spc_mac", compute: false }],
  ], "Vyre for Chrome gets the person's own session for every Space, never anyone else's");
  assert.equal(linkable(sessions[1]!), false);
  await unlinkComputer(sessions[0]!, invoke);
  assert.deepEqual(calls.at(-1), ["unlink_chrome_space", { id: "spc_mla" }]);
  await unlinkComputer(sessions[1]!, invoke);
  assert.deepEqual(calls.at(-1), ["unlink_chrome_space", { id: "spc_me" }], "signing out of a Personal Space takes it from the extension too");
});

test("in a browser there is no shell: nothing is linked, and a shell that refuses one does not stop the rest", async () => {
  assert.equal(await linkComputer([s("spc_mla", "team", "https://mla.vyre.run")], undefined), 0);
  let n = 0;
  const flaky = async () => { if (n++ === 0) throw new Error("daemon starting"); return null; };
  assert.equal(await linkComputer([s("spc_a", "team", "https://a.vyre.run"), s("spc_b", "team", "https://b.vyre.run")], flaky), 1);
});
