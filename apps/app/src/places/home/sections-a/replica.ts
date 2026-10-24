// Read models for the Home sections. Rows live in the local replica. The hook layer calls these resolvers.

import type { FakeReplica, Tables } from "../../../../../../client/src/index.ts";

function rows(tables: Tables, name: string): { id: string }[] {
  return [...(tables.get(name)?.values() ?? [])];
}

/** Register the five live queries the Home sections read. Empty tables answer with empty lists, not loading. */
export function bindHomeReplica(replica: FakeReplica): void {
  replica.resolve("tasks.needs_you", (tables, input) => {
    const items = rows(tables, "needs_you").map((row) => {
      const record = row as { task?: unknown; reason?: unknown; handledBy?: unknown };
      const item: Record<string, unknown> = { task: record.task, reason: record.reason };
      if (typeof record.handledBy === "string") item.handledBy = record.handledBy;
      return item;
    });
    const limit = typeof input.limit === "number" ? input.limit : items.length;
    return { items: items.slice(0, Math.max(0, limit)), total: items.length } as never;
  });

  replica.resolve("tasks.my_work", (tables, input) => {
    const all = rows(tables, "my_work") as { section?: unknown; task?: unknown }[];
    const section = input.section;
    const tasks = all
      .filter((row) => section === undefined || section === "all" || row.section === section)
      .map((row) => row.task);
    const count = (name: string) => all.filter((row) => row.section === name).length;
    return {
      tasks,
      counts: { open: count("open"), assignedByMe: count("assigned_by_me"), done: count("done") },
    } as never;
  });

  replica.resolve("home.at_risk", (tables, input) => {
    const meta = rows(tables, "at_risk_meta")[0] as { rule?: unknown } | undefined;
    const rule = typeof meta?.rule === "string" ? meta.rule : "";
    let projects = rows(tables, "at_risk").map((row) => (row as { project?: unknown }).project);
    const limit = typeof input.limit === "number" ? input.limit : projects.length;
    projects = projects.slice(0, Math.max(0, limit));
    return { rule, projects } as never;
  });

  replica.resolve("home.digest", (tables) => {
    const row = rows(tables, "digest")[0] as { digest?: unknown } | undefined;
    return { digest: row?.digest ?? null } as never;
  });

  replica.resolve("home.routines_today", (tables) => {
    const routines = rows(tables, "routines").map((row) => (row as { routine?: unknown }).routine);
    return { routines } as never;
  });
}
