// What a person can do about a signature request: send, read, remind, cancel. One capability call each, as plain functions the screens and the tests share.
import { envelopeOf, sentOf } from "./model.ts";
import type { Envelope, SendInput } from "./model.ts";
import type { SignData } from "./data.tsx";

type Call = SignData["call"];

export type Sent = NonNullable<ReturnType<typeof sentOf>>;

/** Send. A refusal comes back as the server's own sentence; nothing else is added to it. */
export async function sendForSignature(
  call: Call,
  input: SendInput,
  origin: string,
): Promise<{ ok: true; sent: Sent } | { ok: false; error: string }> {
  try {
    const out = await call("esign.send", input);
    const sent = sentOf(out, origin);
    if (!sent) return { ok: false, error: "That did not go through. Try again." };
    return { ok: true, sent };
  } catch (e) {
    return { ok: false, error: sayError(e) };
  }
}

export function sayError(e: unknown): string {
  const x = e as { error?: { message?: string }; message?: string };
  const m = x?.error?.message ?? x?.message;
  return typeof m === "string" && m !== "" ? m : "That did not go through. Try again.";
}

/** The requests made from a file, newest first (esign.list). A file nobody sent has none. */
export async function requestsOf(call: Call, key: { fileId?: string; recordId?: string }): Promise<Envelope[]> {
  const out = (await call("esign.list", key)) as { envelopes?: unknown[] } | undefined;
  return (out?.envelopes ?? []).flatMap((r) => {
    const e = envelopeOf(r);
    return e ? [e] : [];
  });
}

/** One request with each signer's state and link (esign.status). */
export async function readRequest(call: Call, envelopeId: string): Promise<Envelope | null> {
  const out = (await call("esign.status", { envelopeId })) as Record<string, unknown> | undefined;
  return envelopeOf(out && !out.envelopeId ? { ...out, envelopeId } : out);
}

// One key for one envelope: cancelling is the same act however often it is pressed (the server asks for a key on every outward signing call).
export const cancelRequest = (call: Call, envelopeId: string): Promise<unknown> =>
  call("esign.cancel", { envelopeId, idempotencyKey: `cancel-${envelopeId}` });

/** Remind: a new link for the person still to sign (the old one stops working), mailed when the Space can; the answer carries the link to copy. */
export async function remind(call: Call, envelopeId: string, signer: number, origin: string): Promise<Sent | null> {
  return sentOf(
    await call("esign.remind", { envelopeId, signer, idempotencyKey: `remind-${envelopeId}-${signer}-${Date.now()}` }),
    origin,
  );
}

/** Copy to the clipboard; false when the page may not (the link stays on screen to select). */
export async function copyText(text: string): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> | void } } })
      .navigator;
    if (!nav?.clipboard) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
