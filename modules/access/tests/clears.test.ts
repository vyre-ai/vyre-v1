// access.clears: does a principal's clearance reach what a folder is labelled? Yes or no, and nothing else. Who may ask: the server, a call another capability made, or a person with Edit on the target;
// anyone else, including a person who cannot see the target, gets the answer a made-up id gets.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { world } from "../fixtures/askworld.ts";
import { storeOf } from "../projections.ts";

const code = (e: unknown): string => String((e as { error?: { code?: string } }).error?.code ?? e);
const ask = (ctx: unknown, principal: string, id = "fld_1") =>
  handlers["access.clears"](
    ctx as never,
    { principal: { kind: "person", id: principal }, target: { type: "folder", id } } as never,
  );

function restricted() {
  const w = world();
  const store = storeOf(w.h.as("usr_admin"));
  store.resources.get("fld_1")!.label = "restricted";
  store.bump();
  return w;
}

test("a label above a principal's clearance does not clear; the admin's clearance reaches it, a member's does not", async () => {
  const { h } = restricted();
  const server = h.as("svc_host", "service");
  assert.deepEqual(await ask(server, "usr_admin"), { clears: true });
  assert.deepEqual(await ask(server, "usr_maya"), { clears: false });
  assert.deepEqual(await ask(server, "usr_gus"), { clears: false });
  const open = world();
  assert.deepEqual(
    await ask(open.h.as("usr_mgr"), "usr_maya"),
    { clears: true },
    "internal is within a member's clearance",
  );
});

test("an unknown principal and a suspended one clear nothing", async () => {
  const { h, store } = world();
  const mgr = h.as("usr_mgr");
  assert.deepEqual(await ask(mgr, "usr_ghost"), { clears: false });
  store.principals.set("usr_maya", { ...store.principals.get("usr_maya")!, status: "suspended" });
  store.bump();
  assert.deepEqual(await ask(mgr, "usr_maya"), { clears: false });
});

test("a caller who cannot edit the target, or cannot see it, gets the answer a made-up id gets", async () => {
  const { h } = world();
  const made = await ask(h.as("usr_other"), "usr_admin", "fld_nope").catch(code);
  assert.equal(made, "validation.not_found");
  assert.equal(await ask(h.as("usr_other"), "usr_admin").catch(code), made, "no access at all: same answer");
  assert.equal(await ask(h.as("usr_maya"), "usr_admin").catch(code), made, "View only: same answer");
  assert.deepEqual(await ask(h.as("usr_mgr"), "usr_admin"), { clears: true }, "Manage holds Edit");
  assert.equal(
    await ask(h.as("usr_mgr"), "usr_admin", "fld_2").catch(code),
    made,
    "Manage on another folder is not Edit here",
  );
});

test("the server and a call another capability made may ask about any target; a forwarded call may not", async () => {
  const { h } = restricted();
  assert.deepEqual(await ask(h.as("svc_host", "service"), "usr_admin"), { clears: true });
  const viaModule = { ...h.as("usr_maya"), depth: 1 };
  assert.deepEqual(
    await ask(viaModule, "usr_maya"),
    { clears: false },
    "the Vault request handler asks for a person who could not browse it",
  );
  const forwarded = { ...h.as("usr_maya"), depth: 1, forwarded: true };
  assert.equal(await ask(forwarded, "usr_admin").catch(code), "validation.not_found");
});

test("an agent acting for no person, or a person's agent without Edit, is refused like a stranger", async () => {
  const { h } = restricted();
  assert.equal(await ask(h.as("agt_x", "agent"), "usr_admin").catch(code), "validation.not_found");
});
