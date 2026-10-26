// P-L9_33: the phone of the open Space. It exists only when the Space can mint a Voice token; with no number or no telephony key the shell has no dock.
import test from "node:test";
import assert from "node:assert/strict";
import { openPhone } from "./phone.ts";
import type { VoiceDeviceLike } from "./phone.ts";

const runtime = (deferred = false) => ({ isDeferred: () => deferred, call: async () => ({}), screens: {}, connection: { get: () => "online", subscribe: () => () => undefined }, clock: () => ({ now: 0, offsetMin: 0 }), open: () => undefined }) as never;
const device = (log: string[]): VoiceDeviceLike => ({
  register: async () => { log.push("register"); },
  connect: async () => { throw new Error("not used"); },
  on: () => { log.push("on"); },
  destroy: () => { log.push("destroy"); },
});

test("no Voice SDK loader, a deferred telephony module or a token the server refuses: no phone", async () => {
  const none = await openPhone({ call: async () => ({ token: "t" }), runtime: runtime() }, { openConversation: () => undefined });
  assert.equal(none, undefined, "no loader");
  const deferred = await openPhone({ call: async () => ({ token: "t" }), runtime: runtime(true) }, { loadDevice: async () => device([]), openConversation: () => undefined });
  assert.equal(deferred, undefined, "the server defers telephony");
  const refused = await openPhone({ call: async () => { throw new Error("no number"); }, runtime: runtime() }, { loadDevice: async () => device([]), openConversation: () => undefined });
  assert.equal(refused, undefined, "no number or no key");
});

test("with a token the device registers and the phone hands the softphone its device and the Inbox's data", async () => {
  const log: string[] = [];
  const tokens: string[] = [];
  const phone = await openPhone({ call: async (cap) => (cap === "telephony.voice_token" ? { token: "tok_1" } : {}), runtime: runtime() }, {
    loadDevice: async (t) => { tokens.push(t); return device(log); }, openConversation: () => undefined,
  });
  assert.ok(phone);
  assert.deepEqual(tokens, ["tok_1"]);
  assert.deepEqual(log, ["register"]);
  phone.device.on("incoming", () => undefined);
  phone.close();
  assert.deepEqual(log, ["register", "on", "destroy"]);
  assert.equal(typeof phone.data.call, "function");
});
