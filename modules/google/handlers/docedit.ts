// google.docs.replace_text and google.docs.insert_text: editing a Google Doc by the words in it, not by character positions (live folders L3, native editing by agents).
// batchUpdate takes positions, which an agent cannot know and which go stale the moment anyone types. These two say what they mean (replace this text, add this after that sentence) and do the
// position work here, against the revision they read: a document that changed in between answers validation.version_conflict, so a write never lands in the wrong place.
// Both go through the same Gate act as google.docs.batch_update.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, codeOf, DOCS, enc, int, list, obj, text } from "../projections.ts";
import type { GoogleCtx } from "../projections.ts";
import type { Act } from "./gmail.ts";

const g = (ctx: GoogleCtx, a: Act, cap: string, c: { method?: "GET" | "POST"; url: string; body?: unknown }): Promise<Record<string, unknown>> =>
  api(ctx, { cap, connectionId: a.connectionId, ...(a.as ? { as: a.as } : {}), scope: "documents", ...c });

export async function docReplace(ctx: GoogleCtx, a: Act & { documentId: string; find: string; replace: string; matchCase?: boolean }) {
  if (a.find === "") bad(ctx, "find must name the text to replace.");
  const r = await g(ctx, a, "google.docs.replace_text", {
    method: "POST", url: `${DOCS}/${enc(a.documentId)}:batchUpdate`,
    body: { requests: [{ replaceAllText: { containsText: { text: a.find, matchCase: a.matchCase === true }, replaceText: a.replace } }] },
  });
  return { replaced: int(obj(obj(list(r.replies)[0]).replaceAllText).occurrencesChanged) ?? 0 };
}

interface Run { start: number; end: number; text: string }

/** Every text run of a body, in reading order, including the ones inside table cells. */
function runsOf(content: unknown[], out: Run[]): void {
  for (const block of content) {
    const b = obj(block);
    for (const el of list(obj(b.paragraph).elements)) {
      const e = obj(el);
      const run = obj(e.textRun);
      const start = int(e.startIndex), end = int(e.endIndex), t = text(run.content);
      if (start !== undefined && end !== undefined && t !== undefined) out.push({ start, end, text: t });
    }
    for (const row of list(obj(b.table).tableRows)) for (const cell of list(obj(row).tableCells)) runsOf(list(obj(cell).content), out);
    runsOf(list(obj(b.tableOfContents).content), out);
  }
}

/** The text of a document as one string, with the document index of every character. A gap between runs (a picture, a page break) is a separator no anchor can span. */
export function flatten(content: unknown[]): { full: string; indexAt: number[]; endIndex: number } {
  const runs: Run[] = [];
  runsOf(content, runs);
  let full = "";
  const indexAt: number[] = [];
  let at = -1;
  for (const run of runs) {
    if (at >= 0 && run.start !== at) { full += "\u0000"; indexAt.push(at); }
    for (let i = 0; i < run.text.length; i++) { full += run.text[i]; indexAt.push(run.start + i); }
    at = run.end;
  }
  const last = obj(content[content.length - 1]);
  return { full, indexAt, endIndex: int(last.endIndex) ?? (at < 0 ? 1 : at) };
}

export async function docInsert(ctx: GoogleCtx, a: Act & { documentId: string; text: string; where?: "after" | "before" | "start" | "end"; anchor?: string; matchCase?: boolean }) {
  if (a.text === "") bad(ctx, "text must not be empty.");
  const where = a.where ?? (a.anchor !== undefined ? "after" : "end");
  if ((where === "after" || where === "before") && (a.anchor === undefined || a.anchor === "")) bad(ctx, `${where} needs an anchor: the text to put it ${where}.`);
  const doc = await g(ctx, a, "google.docs.insert_text", { url: `${DOCS}/${enc(a.documentId)}` });
  const revisionId = text(doc.revisionId);
  const content = list(obj(doc.body).content);
  const flat = flatten(content);
  let index: number;
  if (where === "start") index = 1;
  else if (where === "end") index = Math.max(1, flat.endIndex - 1);   // the last index is the document's closing newline
  else {
    const anchor = a.anchor as string;
    const exact = a.matchCase !== false;
    const pos = (exact ? flat.full : flat.full.toLowerCase()).indexOf(exact ? anchor : anchor.toLowerCase());
    if (pos < 0) throw fail("validation.not_found", ctx.trace.traceId, { message: "That text is not in the document." });
    index = where === "before" ? (flat.indexAt[pos] as number) : (flat.indexAt[pos + anchor.length - 1] as number) + 1;
  }
  try {
    await g(ctx, a, "google.docs.insert_text", {
      method: "POST", url: `${DOCS}/${enc(a.documentId)}:batchUpdate`,
      body: { requests: [{ insertText: { location: { index }, text: a.text } }], ...(revisionId !== undefined ? { writeControl: { requiredRevisionId: revisionId } } : {}) },
    });
  } catch (e) {
    // Google refuses a write based on a revision that is no longer the latest with a 400 (or a 409 or 412); the position is stale, not the request wrong
    if (revisionId !== undefined && (codeOf(e) === "validation.bad_input" || codeOf(e) === "validation.precondition_failed")) throw fail("validation.version_conflict", ctx.trace.traceId, { message: "The document changed while the edit was being prepared. Read it again and retry." });
    throw e;
  }
  return { inserted: true, index };
}
