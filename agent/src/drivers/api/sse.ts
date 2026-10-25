// Server-sent events, decoded as the bytes arrive. Nothing waits for the end of the response: an event is yielded the moment its blank line is read, and a chunk that ends in
// the middle of a line or a multi-byte character is completed by the next one. This is the "streams without buffering" half of the send and stream_render budgets.
import type { SseEvent } from "./types.ts";

/** The whole parser state is one partial line and the fields of the event being read. */
export function createSseParser(): { push(chunk: string): SseEvent[]; end(): SseEvent[] } {
  let line = "";
  let sawCr = false;
  let event = "";
  let data: string[] = [];
  const out: SseEvent[] = [];

  const flush = (): void => {
    if (data.length > 0) out.push({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };
  const onLine = (l: string): void => {
    if (l === "") { flush(); return; }
    if (l.startsWith(":")) return;
    const colon = l.indexOf(":");
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  };

  return {
    push(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk.charAt(i);
        if (sawCr) {
          sawCr = false;
          if (c === "\n") continue;
        }
        if (c === "\r") { sawCr = true; onLine(line); line = ""; }
        else if (c === "\n") { onLine(line); line = ""; }
        else line += c;
      }
      return out.splice(0, out.length);
    },
    end() {
      if (line !== "") { onLine(line); line = ""; }
      flush();
      return out.splice(0, out.length);
    },
  };
}

/** Bytes in, events out, one event at a time as they complete. */
export async function* parseSse(body: AsyncIterable<Uint8Array>, onChunk?: (bytes: number) => void): AsyncGenerator<SseEvent> {
  const dec = new TextDecoder();
  const p = createSseParser();
  for await (const chunk of body) {
    onChunk?.(chunk.byteLength);
    for (const ev of p.push(dec.decode(chunk, { stream: true }))) yield ev;
  }
  for (const ev of p.push(dec.decode())) yield ev;
  for (const ev of p.end()) yield ev;
}
