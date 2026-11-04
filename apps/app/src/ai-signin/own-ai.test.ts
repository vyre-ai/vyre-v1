// The one mapping from a refused save of a person's own AI account to words, and the Space AI key line. "Locked, unlock it" only where unlocking here works; on a Space that runs
// elsewhere signing in opens the key (owner ruling 3 Nov); a session that ended is told to sign in.
import test from "node:test";
import assert from "node:assert/strict";
import { LOCKED_LINE, SIGNED_OUT_LINE, SIGN_IN_AGAIN_LINE, adminOf, aiHomeOf, ownAiRefusal, readSpaceAi, spaceAiWords } from "./own-ai.ts";
import { saveApiKey } from "../onboarding/connect-ai.ts";
import { describeFailure } from "../oauth/logic.ts";
import { CapError } from "../shell/session/caps.ts";

const refusal = (message: string, reason?: string): Error => Object.assign(new Error(message), { code: "auth.unauthenticated", ...(reason ? { details: { reason } } : {}) });

test("where the Space runs comes from what this app can reach, not the browser's name", () => {
  assert.equal(aiHomeOf("http://127.0.0.1:4100", false), "here", "a Space on this computer: the local key route");
  assert.equal(aiHomeOf("http://localhost:4100", true), "here");
  assert.equal(aiHomeOf("https://mla.vyre.run", true), "computer");
  assert.equal(aiHomeOf("https://mla.vyre.run", false), "none");
});

test("the wording: locked only where it can be unlocked here; elsewhere sign in again; no vault reason is a session that ended", () => {
  const locked = refusal("Your vault key is locked. Unlock it to save the sign-in.", "vault_locked");
  assert.equal(ownAiRefusal(locked, "here"), LOCKED_LINE);
  assert.equal(ownAiRefusal(locked, "computer"), SIGN_IN_AGAIN_LINE);
  assert.equal(ownAiRefusal(locked, "none"), SIGN_IN_AGAIN_LINE);
  assert.doesNotMatch(SIGN_IN_AGAIN_LINE, /locked|unlock/i);
  assert.equal(ownAiRefusal(refusal("Your vault key is locked on this computer."), "here"), LOCKED_LINE, "an older daemon says it in words");
  assert.equal(ownAiRefusal(refusal("Sign in."), "here"), SIGNED_OUT_LINE, "no vault reason: not a lock");
  assert.equal(ownAiRefusal(refusal("Sign in."), "none"), SIGNED_OUT_LINE);
  assert.equal(ownAiRefusal(Object.assign(new Error("bad"), { code: "validation.bad_input" }), "none"), null, "other refusals keep the caller's words");
  assert.equal(ownAiRefusal({ error: { code: "auth.unauthenticated", message: "Locked.", details: { reason: "vault_locked" } } }, "none"), SIGN_IN_AGAIN_LINE, "the wire shape too");
});

test("saving a personal key: a browser on a server Space is never told to unlock; a Space on this computer is", async () => {
  const call = async (): Promise<never> => { throw refusal("Your vault key is locked on this computer. Unlock it to open your Mine items.", "vault_locked"); };
  await assert.rejects(saveApiKey(call as never, "openai", "sk-test-0001", "k", "none"), (e: Error) => e.message === SIGN_IN_AGAIN_LINE);
  await assert.rejects(saveApiKey(call as never, "openai", "sk-test-0001", "k"), (e: Error) => e.message === LOCKED_LINE);
});

test("finishing an app sign-in: locked only here, a server Space says sign in again, a session that ended says signed out", () => {
  const err = (message: string, reason?: string): CapError => new CapError({ code: "auth.unauthenticated", message, traceId: "t", status: 401, ...(reason ? { details: { reason } } : {}) });
  const here = describeFailure(err("Your vault is locked on this computer. Unlock it."), "here");
  assert.equal(here.kind === "failed" && here.message, "Your vault is locked");
  const there = describeFailure(err("Your vault is locked on this computer. Unlock it."), "none");
  assert.ok(there.kind === "failed" && !/locked/i.test(there.message) && /sign in/i.test(there.next), JSON.stringify(there));
  const out = describeFailure(err("Sign in."), "here");
  assert.equal(out.kind === "failed" && out.message, "You were signed out");
});

test("the Space key in plain words: covered with its models, failing, none with who can add it, unreadable; always a way forward", () => {
  assert.deepEqual(spaceAiWords({ set: true, name: "OpenCode Go", state: "ok", models: ["glm-5.3", "kimi-k3", "qwen", "deepseek"] }, null), { covered: true, title: "You're covered", line: "This Space's AI key (OpenCode Go) works for you for the models below. It has no Claude, GPT, Gemini models: connect your own sign-in to use those.", models: "glm-5.3, kimi-k3, qwen and 1 more" });
  // a key that lists Claude models covers a Claude pick, and says nothing of Claude missing
  assert.equal(spaceAiWords({ set: true, name: "Team", state: "ok", models: ["claude-sonnet-5-5", "gpt-5", "gemini-2.5-pro"] }, null).line, "This Space's AI key (Team) works for you for the models below.");
  assert.match(spaceAiWords({ set: true, name: "OpenCode Go", state: "failing" }, "Irfad Imtiaz (owner)").line, /Ask Irfad Imtiaz \(owner\) to check it/);
  const none = spaceAiWords({ set: false }, "Irfad Imtiaz (owner)");
  assert.equal(none.covered, false);
  assert.equal(none.line, "Ask Irfad Imtiaz (owner) to add one in Console, or connect your own account.");
  assert.match(spaceAiWords({ set: false }, null).line, /Ask the Space owner or an admin/);
  assert.match(spaceAiWords({ set: false, mayManage: true }, null).line, /Add one in Console/);
  assert.match(spaceAiWords("error", null).line, /connect your own account/);
  for (const w of [none, spaceAiWords("error", null)]) assert.doesNotMatch(`${w.title} ${w.line}`, /—|§/, "no em dash, no section sign");
});

test("who can add a Space key: the owner by name and role, then an admin, never the asker", async () => {
  const people = [
    { id: "usr_me", kind: "person", name: "Dana", status: "active", roles: ["rol_owner"] },
    { id: "usr_a", kind: "person", name: "Sam", status: "active", roles: ["admin"] },
    { id: "usr_o", kind: "person", name: "Irfad Imtiaz", status: "active", roles: ["Owner"] },
  ];
  assert.equal(adminOf(people, "usr_me"), "Irfad Imtiaz (owner)");
  assert.equal(adminOf(people.slice(0, 2), "usr_me"), "Sam (admin)");
  assert.equal(adminOf([], "usr_me"), null);
  const read = await readSpaceAi(async (cap) => { if (cap === "access.principals.list") throw new Error("no"); return { set: false }; }, { fallbackAdmin: "Irfad Imtiaz" });
  assert.deepEqual(read, { key: { set: false }, admin: "Irfad Imtiaz" }, "a people list a member cannot read falls back to the inviter");
});
