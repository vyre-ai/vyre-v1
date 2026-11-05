// Shared by the chat-flows journeys (one file each, so each stays inside the 120 s cap): the model stand-in, the hash of a chat, and the gate a "slowly" answer waits on.
import { scriptedModel } from "./live.ts";

export const OUT = "shots-evidence/chat-flows";
export const askers: string[] = [];
let release: () => void = () => undefined;
let gate: Promise<void> = Promise.resolve();
export const arm = (): void => { gate = new Promise<void>((r) => { release = r; }); };
export const letGo = (): void => release();

/** The model stand-in: answers in two pieces; a question that says "slowly" waits between them until the test lets it go. */
export const model = scriptedModel(async function* (input) {
  askers.push(input.asker);
  yield { type: "text", text: "Three invoices are paid" };
  if (/slowly/.test(input.trigger?.body ?? "")) await gate;
  yield { type: "text", text: ", two are open." };
});

export const hash = (threadId: string): string => `/chat#screen=chats.conversation&threadId=${threadId}`;
