// Long text documents (ARCH 5.6): server store and capabilities, live ydoc frames, device binding.
export { fromB64, isEmptyUpdate, toB64 } from "./b64.ts";
export { BODY, CONTENT, newDoc, toMarkdown } from "./markdown.ts";
export {
  appendUpdate, baseSnapshot, buildDoc, docMeta, ensureDocTables, ensureMeta, headSeq, updatesAfter, versions,
} from "./store.ts";
export type { DocEnc, DocMeta, DocOwner, StoredSnapshot, StoredUpdate } from "./store.ts";
export { COMPACT_EVERY_MS, COMPACT_EVERY_UPDATES, MAX_UPDATE_BYTES, createDocServer } from "./server.ts";
export type { Attribution, CompactInput, DocAccess, DocDecision, DocDeps, DocServer, DocVerb, OpenInput, OpenOut, UpdateInput } from "./server.ts";
export { createDocLive } from "./live.ts";
export type { DocFrameType, DocLive, DocPeer } from "./live.ts";
export { agreeSpan, aesDocCrypto, attributedInsert, createDocClient, memoryDocStore, spansOf, sqlDocStore } from "./client.ts";
export type { DocBinding, DocClient, DocClientOpts, DocCrypto, DocLink, DocLocalRow, DocLocalStore, OpenOpts, Span } from "./client.ts";
