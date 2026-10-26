// notifications.list from the replica: the person's own notification rows (notifications_items), newest first.
import { resolver } from "./types.ts";
import { json, num, optNum, optStr, page, put, rows, str } from "./util.ts";

interface ListIn { place?: string; level?: string; unseenOnly?: boolean; cursor?: string; limit?: number }

export const notificationsList = resolver<ListIn, { notifications: Array<Record<string, unknown>>; next?: string; total?: number }>({
  cap: "notifications.list", entities: ["notification"],
  run(db, input, ctx) {
    const where = [`deleted_at IS NULL`, `"person" = ?`];
    const args: Array<string | number> = [ctx.person];
    if (input.place !== undefined) { where.push(`"place" = ?`); args.push(input.place); }
    if (input.level !== undefined) { where.push(`"level" = ?`); args.push(input.level); }
    if (input.unseenOnly === true) where.push(`"seen_at" IS NULL`);
    const clause = where.join(" AND ");
    const total = num(rows(db, `SELECT COUNT(*) AS n FROM "notifications_items" WHERE ${clause}`, args)[0]?.["n"]);
    const { offset, limit } = page(input.cursor, input.limit);
    const rs = rows(db, `SELECT * FROM "notifications_items" WHERE ${clause} ORDER BY "at" DESC, "id" LIMIT ? OFFSET ?`, [...args, limit, offset]);
    const notifications = rs.map((r) => {
      const o: Record<string, unknown> = {
        id: str(r["id"]), kind: str(r["kind"]), level: str(r["level"]), place: str(r["place"]), title: str(r["title"]), count: Math.max(1, num(r["count"])), at: num(r["at"]),
        actions: json(r["actions"], []), spaceId: ctx.spaceId,
      };
      put(o, "body", optStr(r["body"]));
      const type = optStr(r["subject_type"]), id = optStr(r["subject_id"]);
      if (type !== undefined && id !== undefined) o["subject"] = { type, id };
      put(o, "seenAt", optNum(r["seen_at"]));
      return o;
    });
    const out: { notifications: Array<Record<string, unknown>>; next?: string; total?: number } = { notifications, total };
    if (offset + rs.length < total) out.next = String(offset + rs.length);
    return out;
  },
});
