// The left side as one list (design 2.6): his Automations, what needs him first, a dot for the state, a quiet scope word, search above. The places that were here (Failed runs, Templates, Watching, Analytics,
// Dependencies, Events, Packages) are gone: a failure is a card on the first page and an amber dot here. Pure.
export interface ListRowIn {
  id: string;
  name: string;
  state: "needs" | "on" | "off";
  scope: "Space" | "Shared" | null;
}
export interface ListRow {
  id: string;
  name: string;
  dot: "amber" | "green" | "grey";
  scope: "Space" | "Shared" | null;
}

const DOT = { needs: "amber", on: "green", off: "grey" } as const;

export function listView(
  rows: readonly ListRowIn[],
  query: string,
): { head: { title: "Automations"; count: number }; rows: ListRow[]; empty: string | null } {
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => q === "" || r.name.toLowerCase().includes(q))
    .sort((a, b) => (a.state === "needs" ? 0 : 1) - (b.state === "needs" ? 0 : 1) || a.name.localeCompare(b.name))
    .map((r): ListRow => ({ id: r.id, name: r.name, dot: DOT[r.state], scope: r.scope }));
  return {
    head: { title: "Automations", count: rows.filter((r) => r.state === "needs").length },
    rows: shown,
    empty: shown.length > 0 ? null : q !== "" ? `Nothing called “${query.trim()}”.` : "No automations yet.",
  };
}
