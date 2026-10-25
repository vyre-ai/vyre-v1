// Base64 for Yjs updates on the wire and in capability inputs. btoa and atob exist on Node, browsers and Hermes, so the same code runs on every device.
export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A Yjs update with no structs and no deletes is two zero bytes. Nothing to send. */
export function isEmptyUpdate(u: Uint8Array): boolean {
  return u.length <= 2 && u.every((b) => b === 0);
}
