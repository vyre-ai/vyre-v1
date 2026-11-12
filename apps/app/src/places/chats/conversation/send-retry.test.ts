// @tsx
// The path a person takes: a send with a file over the inline limit, the post fails once on the network after the upload, "Not sent.", Retry. Nothing is dropped while chat.post has not succeeded,
// the message arrives once with its file, and the file is uploaded once. The pending list moves exactly as Conversation.tsx moves it (sendPending, withUploaded, afterFailure).
import test from "node:test";
import assert from "node:assert/strict";
import { INLINE_LIMIT, sendPending } from "./actions.ts";
import { afterFailure, withUploaded } from "./model.ts";
import type { Pending } from "./model.ts";

const conflict = (cap: string) => Object.assign(new Error("That key was already used with different input."), { code: "validation.precondition_failed", details: { reason: "idempotency_conflict", cap } });

function server(o: { failPost?: number; failCreateAt?: { file: string; times: number } } = {}) {
  let blobs = 0, files = 0, posts = 0, failPost = o.failPost ?? 0;
  const failCreate = { ...(o.failCreateAt ?? { file: "", times: 0 }) };
  const keys = new Map<string, { input: string; out: unknown }>();
  const thread: Array<{ body: string; attachments: string[] }> = [];
  const puts: string[] = [];
  const call = async (cap: string, input: Record<string, unknown>): Promise<unknown> => {
    if (cap === "files.tree") return { roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_me", count: 0 }] };
    if (cap === "files.list") return { files: [], folders: [{ folderId: "fld_up", name: "Chat uploads" }], hasMore: false };
    if (cap === "files.upload_url") { blobs++; return { url: `u${blobs}`, blobId: `blob_${blobs}` }; }
    if (cap === "files.create") {
      if (failCreate.times > 0 && input["name"] === failCreate.file) { failCreate.times--; throw new TypeError("fetch failed"); }
      const k = String(input["idempotencyKey"]);
      const prior = keys.get(k);
      const body = JSON.stringify({ ...input, idempotencyKey: undefined });
      if (prior) { if (prior.input !== body) throw conflict("files.create"); return prior.out; }
      const out = { file: { fileId: `fil_${++files}`, name: input["name"] } };
      keys.set(k, { input: body, out });
      return out;
    }
    if (cap === "chat.post") {
      posts++;
      if (failPost > 0) { failPost--; throw new TypeError("fetch failed"); }
      const k = String(input["idempotencyKey"]);
      if (keys.has(k)) return keys.get(k)!.out;
      const out = { message: { messageId: `msg_${posts}`, threadSeq: thread.length + 1 } };
      keys.set(k, { input: "post", out });
      thread.push({ body: String(input["body"]), attachments: (input["attachments"] as string[] | undefined) ?? [] });
      return out;
    }
    throw new Error(`unexpected ${cap}`);
  };
  const data = { call, putBlob: async (url: string) => { puts.push(url); }, threadId: "thr_1" } as never;
  return { data, thread, puts, uploads: () => blobs };
}

const big = (name: string) => ({ name, file: new Blob([new Uint8Array(INLINE_LIMIT + 1)]), mime: "application/pdf" });

/** The pending list as Conversation.tsx keeps it, one send. */
function sender(srv: ReturnType<typeof server>, files: Array<{ name: string; file?: unknown; mime?: string }>) {
  let list: Pending[] = [{ key: "k1", body: "the deck", at: 1, state: "sending", kind: "queue", mentions: [], working: false, files }];
  const run = async (): Promise<boolean> => {
    const p = list.find((x) => x.key === "k1")!;
    list = list.map((x) => (x.key === "k1" ? { ...x, state: "sending" as const } : x));
    try {
      const r = await sendPending(srv.data, p, (ids) => { list = list.map((x) => (x.key === "k1" ? { ...x, files: withUploaded(x.files, ids) } : x)); });
      list = list.map((x) => (x.key === "k1" ? { ...x, messageId: r.messageId } : x));
      return true;
    } catch (e) { list = afterFailure(list, "k1", e); return false; }
  };
  return { run, list: () => list };
}

test("a large file, the post fails once: Not sent, then Retry sends the message once with its file and uploads nothing again", async () => {
  const srv = server({ failPost: 1 });
  const s = sender(srv, [big("deck.pdf")]);
  assert.equal(await s.run(), false);
  assert.equal(s.list().length, 1, "the bubble stays: nothing is dropped while chat.post has not succeeded");
  assert.equal(s.list()[0]!.state, "failed", "Not sent.");
  assert.equal(srv.thread.length, 0);
  assert.equal(await s.run(), true, "Retry");
  assert.equal(srv.thread.length, 1, "the message arrives once");
  assert.deepEqual(srv.thread[0]!.attachments, ["fil_1"], "with its file");
  assert.equal(srv.uploads(), 1, "the file was uploaded once");
});

test("several large files, a later upload fails after the earlier one was stored: Retry keeps the stored one and the message arrives once with both", async () => {
  const srv = server({ failCreateAt: { file: "b.pdf", times: 1 } });
  const s = sender(srv, [big("a.pdf"), big("b.pdf")]);
  assert.equal(await s.run(), false);
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0]!.state, "failed");
  assert.equal(s.list()[0]!.files![0]!.fileId, "fil_1", "the file already stored stays with the send");
  assert.equal(await s.run(), true);
  assert.equal(srv.thread.length, 1);
  assert.deepEqual(srv.thread[0]!.attachments, ["fil_1", "fil_2"]);
  assert.equal(srv.uploads(), 3, "a.pdf once, b.pdf twice (its first create never ran); a.pdf is not uploaded again");
});
