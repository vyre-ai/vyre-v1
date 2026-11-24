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

const MAX_RECORDS = 50;

const isCard = (b: Block): b is Block & { data: Record<string, unknown> } =>
  b.type === "record_card" &&
  typeof b.data === "object" &&
  b.data !== null &&
  !Array.isArray(b.data) &&
  typeof (b.data as Record<string, unknown>)["recordId"] === "string";

/** What each record's card may show this caller: its fields, or null when the caller cannot read it. */
async function visibleFields(
  ctx: ChatCtx,
  blocks: readonly Block[],
): Promise<Map<string, Record<string, unknown> | null>> {
  const seen = new Map<string, Record<string, unknown> | null>();
  if (!ctx.call) return seen;
  for (const b of blocks) {
    if (!isCard(b)) continue;
    const id = b.data["recordId"] as string;
    if (seen.has(id) || seen.size >= MAX_RECORDS) continue;
    const type = typeof b.data["type"] === "string" ? (b.data["type"] as string) : undefined;
    try {
      const got = (await ctx.call("records.get", { recordId: id, ...(type ? { type } : {}) })) as {
        record?: { fields?: Record<string, unknown> };
      };
      seen.set(id, got.record?.fields ?? {});
    } catch {
      seen.set(id, null);
    }
  }
  return seen;
}

function shown(
  data: Record<string, unknown>,
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  // a record that could not be read (or that this call did not look up) shows the card's name only
  if (fields === undefined) return data;
  const { summary: _s, status: _t, fields: listed, ...rest } = data;
  if (fields === null) return { ...rest, fields: [] };
  const had = Array.isArray(listed) ? (listed as CardField[]) : [];
  const kept = had.flatMap((f) =>
    typeof f.key === "string" && f.key in fields ? [{ ...f, value: fields[f.key] }] : [],
  );
  const lost =
    kept.length < had.length || kept.some((f, i) => JSON.stringify(f.value) !== JSON.stringify(had[i]?.value));
  return {
    ...rest,
    ...(lost
      ? {}
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
