// One name resolver for every place (owner, 13 Nov 2026: an id is never shown to a person): Settings, Automations, Vault and Apps answer a plain word for someone they do not know, never the id.
import test from "node:test";
import assert from "node:assert/strict";
import { nameOf } from "./misc-common.ts";
import { nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

const rt = (ready: boolean): ShellRuntime => ({
  me: { id: "usr_me", name: "Olivia Park" },
  principals: { subscribe: () => () => undefined, getSnapshot: () => (ready ? { status: "ready", data: [{ id: "usr_maya", name: "Maya Chen", kind: "person" }, { id: "agt_docs", name: "Docs", kind: "agent" }] } : { status: "loading" }) },
}) as unknown as ShellRuntime;

test("a known person or agent is named; an unknown one, or any id while the list loads, is a plain word", () => {
  const n = nameOf(rt(true));
  assert.equal(n("usr_maya"), "Maya Chen");
  assert.equal(n("agt_docs"), "Docs");
  assert.equal(n("usr_me"), "Olivia Park");
  assert.equal(n("usr_gone0123456789ab"), "Someone");
  assert.equal(n("agt_gone0123456789ab"), "An agent");
  assert.equal(nameOf(rt(false))("usr_maya"), "Someone");
  assert.equal(nameOf(rt(true))("usr_gone0123456789ab"), nameLookup(rt(true))("usr_gone0123456789ab"), "the same resolver as Records and Chats");
});
