import { createHash, randomBytes } from "node:crypto";

/** sha-256 over text and bytes in order, lowercase hex. Only the kernel imports crypto (boundary B3). */
export function sha256Hex(...parts: (string | Uint8Array)[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

/** The hash `prev` of event 1. */
export const genesis = (space: string): string => sha256Hex(`vyre-genesis:${space}`);

export const newSalt = (): Uint8Array => new Uint8Array(randomBytes(16));
export const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
