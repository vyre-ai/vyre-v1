// A record card carries field values into a chat that every member of the thread reads, so it shows each reader only what that reader may see, and what is stored never holds more than the poster could see.
// The record is read as the person at hand (records.get answers each caller with the fields their grant lets through): when the card is posted, as the poster; when it is served, as the reader. A card's
// fields keep only the keys that reader gets, each with the value that reader gets (a value written into a card by hand is not believed); a card whose reader cannot read the record shows no fields; and a
// summary or status, free text that may repeat a hidden field, stays only when nothing of the card had to be taken away. The stored blocks of a served message are never touched: copies are returned.
import type { ChatCtx } from "../projections.ts";

interface Block {
  type?: string;
  data?: unknown;
  [k: string]: unknown;
}
interface CardField {
  key?: unknown;
  title?: unknown;
  value?: unknown;
}

/** How many records are read at once, and how many distinct records one call looks up at all: a record beyond that is treated as one the reader cannot read, never shown whole. */
const GROUP = 8;
const MAX_RECORDS = 200;

const isCard = (b: Block): b is Block & { data: Record<string, unknown> } =>
  b.type === "record_card" &&
  typeof b.data === "object" &&
  b.data !== null &&
  !Array.isArray(b.data) &&
  typeof (b.data as Record<string, unknown>)["recordId"] === "string";

/** What each record's card may show this caller: its fields, or null when the caller cannot read it (or it was not looked up). A record that is not in the answer is treated as null too. */
async function visibleFields(
  ctx: ChatCtx,
  blocks: readonly Block[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const seen = new Map<string, Record<string, unknown> | null>();
  const wanted = new Map<string, string | undefined>();
  for (const b of blocks) {
    if (!isCard(b)) continue;
    const id = b.data["recordId"] as string;
    if (!wanted.has(id)) wanted.set(id, typeof b.data["type"] === "string" ? (b.data["type"] as string) : undefined);
  }
  const ids = [...wanted.keys()];
  for (const id of ids.slice(MAX_RECORDS)) seen.set(id, null);
  const read = async (id: string): Promise<void> => {
    const type = wanted.get(id);
    try {
      if (!ctx.call) throw new Error("no way to ask");
      const got = (await ctx.call("records.get", { recordId: id, ...(type ? { type } : {}) })) as {
        record?: { fields?: Record<string, unknown> };
      };
      seen.set(id, got.record?.fields ?? {});
    } catch {
      seen.set(id, null);
    }
  };
  const head = ids.slice(0, MAX_RECORDS);
  for (let at = 0; at < head.length; at += GROUP) await Promise.all(head.slice(at, at + GROUP).map(read));
  return seen;
}

/** The card's own name when something of it had to be taken away: the title may be the value of a hidden field, so the type and the end of the id stand in for it. */
const nameOf = (data: Record<string, unknown>): string => {
  const type = typeof data["type"] === "string" && data["type"] !== "" ? (data["type"] as string) : "Record";
  const id = String(data["recordId"]);
  return `${type} ${id.slice(-6)}`;
};

function shown(
  data: Record<string, unknown>,
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const { summary: _s, status: _t, fields: listed, ...rest } = data;
  // a record that could not be read, or that was never looked up, shows no fields and no words of its own
  if (fields === null || fields === undefined) return { ...rest, title: nameOf(data), fields: [] };
  const had = Array.isArray(listed) ? (listed as CardField[]) : [];
  const kept = had.flatMap((f) =>
    typeof f.key === "string" && f.key in fields ? [{ ...f, value: fields[f.key] }] : [],
  );
  const lost =
    kept.length < had.length || kept.some((f, i) => JSON.stringify(f.value) !== JSON.stringify(had[i]?.value));
  return {
    ...rest,
    ...(lost
      ? { title: nameOf(data) }
      : {
          ...(data["summary"] !== undefined ? { summary: data["summary"] } : {}),
          ...(data["status"] !== undefined ? { status: data["status"] } : {}),
        }),
    fields: kept,
  };
}

/** Blocks as the caller may keep them stored: a card they post holds no field they cannot read. */
export async function sealCards<B extends Block>(ctx: ChatCtx, blocks: readonly B[]): Promise<B[]> {
  if (!blocks.some(isCard)) return [...blocks];
  const seen = await visibleFields(ctx, blocks);
  return blocks.map((b) => (isCard(b) ? { ...b, data: shown(b.data, seen.get(b.data["recordId"] as string)) } : b));
}

/** Copies of the messages with every record card cut to what the reader may see. */
export async function attachCards<M extends { blocks?: unknown }>(ctx: ChatCtx, messages: readonly M[]): Promise<M[]> {
  const all = messages.flatMap((m) => (Array.isArray(m.blocks) ? (m.blocks as Block[]) : []));
  if (!all.some(isCard)) return [...messages];
  const seen = await visibleFields(ctx, all);
  return messages.map((m) => {
    if (!Array.isArray(m.blocks) || !(m.blocks as Block[]).some(isCard)) return m;
    const blocks = (m.blocks as Block[]).map((b) =>
      isCard(b) ? { ...b, data: shown(b.data, seen.get(b.data["recordId"] as string)) } : b,
    );
    return { ...m, blocks };
  });
}
