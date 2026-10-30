// What a fact row carries beyond the fact itself, for the screens (owner design 30 Oct 2026): the subject it is about (a page, with its type), the title of the chat, run or record it came from, who wrote it
// and how many versions it has. Optional on every row; a fact with no page or source simply has none of them. Nothing here reads a place the caller cannot open.
import { subjectKey } from "./pages.ts";
import { actorOf, factOut, num, orNull, rowsOf, str } from "./projections.ts";
import type { Fact, MemCtx } from "./projections.ts";

export interface FactExtras {
  subject?: { pageId: string; title: string; kind: string };
  sourceTitle?: string;
  by?: string;
  byKind?: "person" | "agent" | "upkeep" | "system";
  versions?: number;
}

const kindOfId = (id: string): FactExtras["byKind"] => (id.startsWith("usr_") ? "person" : id.startsWith("agt_") ? "agent" : id === "upkeep" ? "upkeep" : "system");

interface PageKey { id: string; title: string; kind: string; layer: string; owner: string; subject: string; subjectRef: string | null }

export function extrasFor(ctx: MemCtx, facts: readonly Fact[]): Map<string, FactExtras> {
  const out = new Map<string, FactExtras>();
  if (facts.length === 0) return out;
  const me = actorOf(ctx);
  // pages a fact can be about: shared pages, and the reader's own personal ones (opened to read their titles)
  const pages: PageKey[] = [];
  for (const r of rowsOf(ctx.db, "SELECT page_id, title, kind, layer, owner_ref, subject, subject_ref FROM memory_pages WHERE trashed_at IS NULL AND layer != 'person' ORDER BY length(subject) DESC LIMIT 1000")) {
    pages.push({ id: str(r["page_id"]), title: str(r["title"]), kind: str(r["kind"]), layer: str(r["layer"]), owner: str(r["owner_ref"]), subject: str(r["subject"]), subjectRef: orNull(r["subject_ref"]) });
  }
  const memo = new Map<string, boolean>();
  const mayOpen = (type: string, id: string): boolean => {
    const k = `${type}:${id}`;
    let ok = memo.get(k);
    if (ok === undefined) { ok = ctx.authorize({ perm: null, level: "view" }, { type, id }).effect === "allow"; memo.set(k, ok); }
    return ok;
  };
  for (const f of facts) {
    const x: FactExtras = {};
    // subject: the page for the record the fact came from, else the longest page title the text names, in the fact's own place or the Space
    if (f.text !== "") {
      const text = ` ${f.text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      let hit = f.subject ? pages.find((p) => p.subjectRef === f.subject) : undefined;
      hit ??= pages.find((p) => (p.layer === "space" || (p.layer === f.layer && p.owner === f.ownerRef)) && p.subject.length >= 2 && text.includes(` ${p.subject.replace(/[^a-z0-9]+/g, " ").trim()} `));
      if (hit) x.subject = { pageId: hit.id, title: hit.title, kind: hit.kind };
    }
    // source title: the chat, run or record, only when the reader may open it
    const node = f.sourceKind === "record" ? `record:${f.sourceRef}` : f.sourceKind === "chat" || f.sourceKind === "channel" || f.sourceKind === "run" ? `chat:${f.sourceRef}` : null;
    if (node) {
      const n = rowsOf(ctx.db, "SELECT title, res_type, res_id FROM memory_graph_nodes WHERE node_id = ?", node)[0];
      if (n && mayOpen(str(n["res_type"]), str(n["res_id"]))) x.sourceTitle = str(n["title"]);
    }
    // who wrote it: the first line of the trail for the fact, else the principal that proposed it
    const first = rowsOf(ctx.db, "SELECT actor, actor_kind FROM memory_trail WHERE fact_id = ? AND action IN ('learn', 'create', 'edit', 'promote') ORDER BY rowid LIMIT 1", f.id)[0];
    if (first) { x.by = str(first["actor"]); x.byKind = str(first["actor_kind"]) as FactExtras["byKind"]; }
    else if (f.proposedBy) { x.by = f.proposedBy; x.byKind = kindOfId(f.proposedBy); }
    if (x.by === undefined && f.sourcePerson === me) { x.by = me; x.byKind = "person"; }
    // versions: this one and the ones it replaced
    let versions = 1;
    for (let cur = f.replaces, n = 0; cur && n < 50; n++) {
      versions++;
      cur = orNull(rowsOf(ctx.db, "SELECT replaces FROM memory_facts WHERE id = ?", cur)[0]?.["replaces"]);
    }
    x.versions = versions;
    out.set(f.id, x);
  }
  return out;
}

/** The contract's fact rows, each with its extras. */
export function factRows(ctx: MemCtx, facts: readonly Fact[]) {
  const ex = extrasFor(ctx, facts);
  return facts.map((f) => ({ ...factOut(f), ...(ex.get(f.id) ?? {}) }));
}

export const countOf = (v: unknown): number => num(v);
