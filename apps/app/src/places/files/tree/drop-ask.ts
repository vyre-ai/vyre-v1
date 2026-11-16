// What a drop onto a folder in the tree does: it works out where each dragged item is now (the list knows its rows; the tree reads them), then either moves or asks first.
import { askMove, dropMoves, fileLine, parsePayload } from "./model.ts";
import type { Line, Move, MoveAsk } from "./model.ts";

export interface DropPlan {
  planned: Move[];
  ask: MoveAsk | null;
}

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** A dragged file is read from the server (its folder and its provider); a dragged folder is one the tree has drawn (`known`). */
export async function planTreeDrop(
  call: Call,
  payload: string,
  target: { id: string | null; source: string | null },
  known: ReadonlyMap<string, Line>,
): Promise<DropPlan> {
  const items = parsePayload(payload);
  const lines = new Map<string, Line>();
  await Promise.all(
    items.map(async (it) => {
      if (it.type === "folder") {
        const l = known.get(it.id);
        if (l) lines.set(`folder:${it.id}`, l);
        return;
      }
      try {
        const o = (await call("files.get", { fileId: it.id })) as { file?: Parameters<typeof fileLine>[0] };
        if (o.file) lines.set(`file:${it.id}`, fileLine(o.file));
      } catch {
        // a file that cannot be read is moved without asking; the move itself says if it is refused
      }
    }),
  );
  const lineOf = (it: { type: "file" | "folder"; id: string }): Line | undefined => lines.get(`${it.type}:${it.id}`);
  const planned = dropMoves(items, target.id, (it) => lineOf(it)?.folderId ?? null);
  return { planned, ask: askMove(items, target, lineOf, planned) };
}
