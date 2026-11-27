// An event's payload, decoded once (27 Nov 2026, the start-up scans of the log): the host reads every resource.created event of a big Space four or five times at boot (the access fold, the owner marks, the
// agent repairs), each time turning the same bytes into text and the text into an object, 40 ms to 70 ms a scan. The object is kept against the bytes, so a second read of the same event is a lookup.
// The readers only read it (a row that is kept is copied first), so the one object is shared.
const decoded = new WeakMap<Uint8Array, unknown>();

/** The JSON a payload holds; throws what JSON.parse throws (nothing is kept for a payload that does not parse). */
export function decodePayload(bytes: Uint8Array): unknown {
  let v = decoded.get(bytes);
  if (v === undefined) {
    v = JSON.parse(new TextDecoder().decode(bytes));
    decoded.set(bytes, v);
  }
  return v;
}
