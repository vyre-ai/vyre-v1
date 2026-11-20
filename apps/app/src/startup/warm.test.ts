// A device with a session loads the shell and the place it will open as soon as the page starts (warm.ts), and nothing else loads anything.
import test from "node:test";
import assert from "node:assert/strict";
import { placeToWarm, warmSignedIn } from "./warm.ts";
import type { WarmDeps } from "./warm.ts";

function deps(o: { session: boolean; last?: string | null }): WarmDeps & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    hasSession: () => o.session,
    loadShell: () => {
      loaded.push("shell");
      return Promise.resolve();
    },
    loadPlace: (id) => {
      loaded.push(`place:${id}`);
      return Promise.resolve();
    },
    last: () => o.last,
  };
}

test("the place to load is the address's, else the last one opened, else Chats", () => {
  assert.equal(placeToWarm("/files/abc", "chat"), "files");
  assert.equal(placeToWarm("/", "records"), "records");
  assert.equal(placeToWarm("/", null), "chat");
  assert.equal(placeToWarm("/", "gone"), "chat");
  assert.equal(placeToWarm("/join/XYZ", "vault"), "vault");
});

test("a device with a session loads the shell and its place; one without loads nothing", () => {
  const a = deps({ session: true, last: "automations" });
  assert.equal(warmSignedIn("/", a), true);
  assert.deepEqual(a.loaded, ["shell", "place:automations"]);
  const b = deps({ session: false });
  assert.equal(warmSignedIn("/", b), false);
  assert.deepEqual(b.loaded, []);
});

test("a claim, a join or an OAuth page loads nothing, and a failing load is not an error", async () => {
  for (const path of ["/claim/abc", "/join/CODE-1", "/oauth/callback", "/oauth/allow"]) {
    const d = deps({ session: true });
    assert.equal(warmSignedIn(path, d), false, path);
    assert.deepEqual(d.loaded, [], path);
  }
  const failing: WarmDeps = {
    hasSession: () => true,
    loadShell: () => Promise.reject(new Error("offline")),
    loadPlace: () => Promise.reject(new Error("offline")),
    last: () => null,
  };
  assert.equal(warmSignedIn("/", failing), true);
  await new Promise((r) => setImmediate(r));
});
