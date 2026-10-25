// The writes the Chats right pane makes, each one capability. Plain functions over a `call` and a `note`, so the tests drive them without a renderer. A failed write becomes
// one quiet line ("Could not ..."), never a thrown error from a click; a change that can be taken back says so with Undo.
import type { Fact, Routine } from "./model.ts";

export interface PaneDeps {
  call(cap: string, input: unknown): Promise<unknown>;
  /** The quiet line at the foot of the pane. `undo` is absent when the change cannot be taken back. */
  note(text: string, undo?: () => Promise<void> | void): void;
}

async function attempt(d: PaneDeps, what: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; } catch { d.note(`Could not ${what}. Try again.`); return false; }
}

let seq = 0;
const key = (what: string, id: string): string => `rp-${what}-${id}-${++seq}`;

/* ---------- computer ---------- */

export function wake(d: PaneDeps, computerId: string, name: string): Promise<boolean> {
  return attempt(d, "wake it", async () => { await d.call("computers.wake", { computerId }); d.note(`${name} is awake`); });
}

export function provision(d: PaneDeps, agentId: string, name: string): Promise<boolean> {
  return attempt(d, "set up its computer", async () => { await d.call("computers.provision", { agentId, idempotencyKey: key("computer", agentId) }); d.note(`Setting up ${name}'s computer`); });
}

export function signOut(d: PaneDeps, computerId: string, site: string): Promise<boolean> {
  return attempt(d, `sign out of ${site}`, async () => { await d.call("computers.session.sign_out", { computerId, site }); d.note(`Signed out of ${site}`); });
}

/* ---------- memory ---------- */

/** Accept a proposed fact. Undo rejects it again. */
export function accept(d: PaneDeps, f: Fact): Promise<boolean> {
  return attempt(d, "accept that fact", async () => {
    await d.call("memory.fact.accept", { factId: f.factId });
    d.note("Accepted. It is in what the agent knows.", () => attempt(d, "undo that", async () => { await d.call("memory.fact.reject", { factId: f.factId }); }).then(() => undefined));
  });
}

/** Reject a proposed fact. Undo accepts it again. */
export function reject(d: PaneDeps, f: Fact): Promise<boolean> {
  return attempt(d, "reject that fact", async () => {
    await d.call("memory.fact.reject", { factId: f.factId });
    d.note("Rejected. It will not be remembered.", () => attempt(d, "undo that", async () => { await d.call("memory.fact.accept", { factId: f.factId }); }).then(() => undefined));
  });
}

/** Correct a fact: the old one is kept, marked replaced, and the new one names you as its source. */
export function correct(d: PaneDeps, f: Fact, text: string): Promise<boolean> {
  const next = text.trim();
  if (next === "" || next === f.text) return Promise.resolve(false);
  return attempt(d, "correct that fact", async () => {
    await d.call("memory.fact.correct", { factId: f.factId, text: next });
    d.note("Corrected. The old fact is kept, marked replaced.");
  });
}

/** Remove a fact from the agent's answers. The history keeps it. */
export function removeFact(d: PaneDeps, f: Fact): Promise<boolean> {
  return attempt(d, "remove that fact", async () => {
    await d.call("memory.facts.remove", { factIds: [f.factId] });
    d.note("Removed from what the agent knows.");
  });
}

/* ---------- routines ---------- */

function routineInput(r: Routine, enabled: boolean): Record<string, unknown> {
  return { agentId: r.agentId, routineId: r.routineId, title: r.title, cron: r.cron, prompt: r.prompt, ...(r.channelId ? { channelId: r.channelId } : {}), enabled };
}

/** Turn a routine on or off. Undo flips it back. */
export function setRoutine(d: PaneDeps, r: Routine, enabled: boolean): Promise<boolean> {
  return attempt(d, enabled ? "resume it" : "pause it", async () => {
    await d.call("agents.routine.save", { ...routineInput(r, enabled), idempotencyKey: key("routine", r.routineId) });
    d.note(`${enabled ? "Resumed" : "Paused"} ${r.title}`, () => attempt(d, "undo that", async () => { await d.call("agents.routine.save", { ...routineInput(r, !enabled), idempotencyKey: key("routine", r.routineId) }); }).then(() => undefined));
  });
}

/** Duplicate a routine, paused until you turn it on. */
export function duplicateRoutine(d: PaneDeps, r: Routine): Promise<boolean> {
  return attempt(d, "duplicate it", async () => {
    await d.call("agents.routine.save", { agentId: r.agentId, title: `${r.title} copy`, cron: r.cron, prompt: r.prompt, ...(r.channelId ? { channelId: r.channelId } : {}), enabled: false, idempotencyKey: key("routine-copy", r.routineId) });
    d.note("Duplicated, paused until you turn it on");
  });
}

/** Rename a routine. */
export function renameRoutine(d: PaneDeps, r: Routine, title: string): Promise<boolean> {
  const next = title.trim();
  if (next === "" || next === r.title) return Promise.resolve(false);
  return attempt(d, "rename it", async () => { await d.call("agents.routine.save", { ...routineInput(r, r.enabled), title: next, idempotencyKey: key("routine", r.routineId) }); d.note(`Renamed to ${next}`); });
}

/** Delete a routine. Undo saves it again as it was. */
export function deleteRoutine(d: PaneDeps, r: Routine): Promise<boolean> {
  return attempt(d, "delete it", async () => {
    await d.call("agents.routine.delete", { agentId: r.agentId, routineId: r.routineId });
    d.note(`Deleted ${r.title}`, () => attempt(d, "undo that", async () => {
      await d.call("agents.routine.save", { agentId: r.agentId, title: r.title, cron: r.cron, prompt: r.prompt, ...(r.channelId ? { channelId: r.channelId } : {}), enabled: r.enabled, idempotencyKey: key("routine-undo", r.routineId) });
    }).then(() => undefined));
  });
}

/** Take over the agent's computer. Its actions become one "You took over" step. */
export function takeOver(d: PaneDeps, computerId: string, name: string): Promise<boolean> {
  return attempt(d, "take over", async () => { await d.call("computers.take_over", { computerId }); d.note(`You're in control. ${name} waits.`); });
}

/** Give control back to the agent. */
export function giveBack(d: PaneDeps, computerId: string, name: string): Promise<boolean> {
  return attempt(d, "give control back", async () => { await d.call("computers.give_back", { computerId }); d.note(`Control given back to ${name}`); });
}

/** Put the computer to sleep. Undo wakes it. */
export function sleep(d: PaneDeps, computerId: string, name: string): Promise<boolean> {
  return attempt(d, "put it to sleep", async () => {
    await d.call("computers.sleep", { computerId });
    d.note(`${name}'s computer is asleep`, () => attempt(d, "undo that", async () => { await d.call("computers.wake", { computerId }); }).then(() => undefined));
  });
}

/** Copy text to the clipboard and say so. Where there is no clipboard it says it could not. */
export async function copyText(d: PaneDeps, text: string): Promise<boolean> {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
  if (!clip) { d.note("Could not copy. Select the text and copy it."); return false; }
  return attempt(d, "copy that", async () => { await clip.writeText(text); d.note("Copied"); });
}

/** Save new instructions for a routine. The old version is kept, so nothing is lost. */
export function saveInstructions(d: PaneDeps, r: Routine, prompt: string): Promise<boolean> {
  const next = prompt.trim();
  if (next === "" || next === r.prompt) return Promise.resolve(false);
  return attempt(d, "save the instructions", async () => {
    await d.call("agents.routine.save", { ...routineInput(r, r.enabled), prompt: next, idempotencyKey: key("routine", r.routineId) });
    d.note("Saved as a new version. The old one is kept.", () => attempt(d, "undo that", async () => { await d.call("agents.routine.save", { ...routineInput(r, r.enabled), idempotencyKey: key("routine", r.routineId) }); }).then(() => undefined));
  });
}
