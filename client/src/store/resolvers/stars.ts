// stars.list from the replica: my stars (spaces_star), newest first, each with the title of the thing starred when the replica holds it.
import { resolver } from "./types.ts";
import { num, rows, str } from "./util.ts";
import type { LocalDb } from "../space.ts";

const TITLE_OF: Record<string, { table: string; column: string }> = {
  thread: { table: "chat_thread", column: "title" }, file: { table: "files_file", column: "name" }, calendar: { table: "calendar_list", column: "title" },
};

function titleOf(db: LocalDb, type: string, id: string): string {
  const t = TITLE_OF[type];
  if (!t) return id;
  const r = rows(db, `SELECT "${t.column}" AS title FROM "${t.table}" WHERE "id" = ?`, [id])[0];
  const title = r ? str(r["title"]) : "";
  return title === "" ? id : title;
}

export const starsList = resolver<{ type?: string }, { stars: Array<{ resource: { type: string; id: string }; title: string; at: number }> }>({
  cap: "stars.list", entities: ["star", "thread", "file", "calendar"],
  run(db, input, ctx) {
    const rs = input.type === undefined
      ? rows(db, `SELECT * FROM "spaces_star" WHERE deleted_at IS NULL AND "person" = ? ORDER BY "createdAt" DESC, "id"`, [ctx.person])
      : rows(db, `SELECT * FROM "spaces_star" WHERE deleted_at IS NULL AND "person" = ? AND "resourceType" = ? ORDER BY "createdAt" DESC, "id"`, [ctx.person, input.type]);
    return { stars: rs.map((r) => ({ resource: { type: str(r["resourceType"]), id: str(r["resourceId"]) }, title: titleOf(db, str(r["resourceType"]), str(r["resourceId"])), at: num(r["createdAt"]) })) };
  },
});
