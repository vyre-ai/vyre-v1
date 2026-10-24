# Grok harness rehearsal (P-PR_72)

Three trial packets on local branch `throwaway/grok-rehearsal` (parent `4ee2d06`). That branch is not merged. This file is the only change on `packet/P-PR_72`.

Worker: grok. Lane: prep. Date: 2026-10-24.

## Setup

`trk.py` is not in this worktree, and the parent tree is not readable from the worker. The same gap is recorded for `trk.py brief P-PR_42` in `docs/import-log/lanes-c.md`. The tracker brief used here is the PACKET BRIEF block in the worker prompt.

ARCHITECTURE-V1 is not in this worktree. The ARCH 12 rules that are copied into the tree were read:

- 12.2 F12: `scripts/import-0.6.ts` and `docs/import-log/README.md`. Copy KEEP and CLEAN rows. No cleaning and no ports in that step.
- 12.2 F13: `scripts/brief/build.ts` and `docs/lanes/TEMPLATE.md`. A worker brief stays under 6000 tokens. `estimateTokens` is `ceil(chars / 4)`.
- 12.3: `scripts/lanes.json`. Longest `owns` prefix wins. Frozen paths are lead-owned. `ui/src/*/props.ts` is frozen. `docs/` is L11. `ui/` is L9a. `modules/sites/` is L8. `connectors/hubspot/` is L3.
- 12.4: `host/src/loader.ts`. While `host/modules.json` says `stub`, the host serves `generated/modules/<id>/stub-impl.ts`. A module `impl` loads only after status is `live`.

V1-SPEC is not in this worktree. The in-repo citation of V1-SPEC section 1 is D51: in any menu every item has an icon or none does (`scripts/lint/menu-icons.ts`, `ui/src/Menu/props.ts`).

Dependencies named in the brief:

- P-PR_33 is on this branch as the F11 generator acceptance (`scripts/f11-accept.test.ts`): 72 modules generate, and committed output has no drift.
- P-PR_53 is `4ee2d06`, the frozen props batch. UI placeholders are string markup with `data-placeholder`. `ui/src/__screens__/P-PR_51/batch1.screen.test.ts` covers `MenuPlaceholder`.
- P-PR_71 is marked done in the brief. No commit and no file in this worktree names it.

Repo rule on this machine: do not run node, npm, npx, pnpm, or yarn. Checks run in CI after the harness pushes.

## Targets

| Trial | Pick | Why this one | Owned path on the throwaway branch |
| --- | --- | --- | --- |
| UI placeholder | `ui/Menu` | D51 is the V1-SPEC section 1 rule already implemented by `resolveMenuItems`. The placeholder can show the result without editing frozen props. | `ui/src/Menu/Placeholder.tsx` |
| Stub handler group | `sites.create`, `sites.get`, `sites.list`, `sites.update`, `sites.delete` | Five CRUD capabilities on an existing manifest (`manifests/sites.ts`, lane L8). The generated stub still answers with examples. | `modules/sites/crud.ts` |
| Connector adapter | HubSpot | Built-in connector (`manifests/connectors/hubspot.ts`): four capabilities, domains `api.hubapi.com` and `app.hubspot.com`. | `connectors/hubspot/account.ts` |

Generated files were not edited. `host/modules.json` was not edited.

## Time and tokens

Wall clock is the gap between git commits on `throwaway/grok-rehearsal`. Reading for the setup section happened before the branch and is not inside these intervals.

Token use is `ceil((brief chars + diff chars) / 4)`, the same rule as `estimateTokens` in `scripts/brief/build.ts`. Diff chars are `git show --format=` (the patch only). These are not API billing totals. The session does not split model usage by trial.

| Trial | Commit | Clock (+0500) | Wall | Brief chars | Diff chars | Tokens |
| --- | --- | --- | --- | --- | --- | --- |
| UI | `219efe5` | 22:55:34 to 22:55:42 | 8 s | 169 | 1205 | 344 |
| CRUD | `9891a3a` | 22:55:42 to 22:56:20 | 38 s | 248 | 6166 | 1604 |
| Adapter | `249e267` | 22:56:20 to 22:56:36 | 16 s | 249 | 3782 | 1008 |

Briefs, verbatim:

- UI: `Owned: ui/src/Menu/Placeholder.tsx. Set data-menu-icons to all, none, or mixed from the resolved actionable items. D51, V1-SPEC section 1. Do not edit props.ts or tests.`
- CRUD: `Owned: modules/sites/crud.ts. Implement sites.create, sites.get, sites.list, sites.update, and sites.delete against ctx.db. Match the sites.create through sites.delete outputs in manifests/sites.ts. Do not edit generated files or host/modules.json.`
- Adapter: `Owned: connectors/hubspot/account.ts. Parse recorded responses for hubspot.test_connection, hubspot.health, hubspot.list_objects, and hubspot.push_object. Use the domains in manifests/connectors/hubspot.ts. Do not fetch. Do not edit generated stubs.`

## Lead review

### UI placeholder: accept

`data-menu-icons` is `all`, `none`, or `mixed` over `isItem` entries after `resolveMenuItems`. Heads and separators are not items. An empty menu is `none`. A menu whose items all carry icons, including the appended Report a problem item with `flag`, is `all`. A mixed caller menu stays `mixed`, which matches `appendReportProblem` (it adds `flag` only when every existing item has an icon).

Frozen `ui/src/Menu/props.ts` is untouched. The file stays in L9a. The existing Menu tests key off `data-item` and `data-icon="flag"`, so the new attribute is additive. Tests were not executed here.

### Sites CRUD group: send back

The five handlers call `ctx.authorize`, use bound SQL, emit `site.created`, and map rows to the `siteRow` fields. That is the right shape for a handler group. It is not a module packet.

- `host/src/loader.ts` (ARCH 12.4) keeps serving `generated/modules/sites/stub-impl.ts` while status is `stub`. This file is not on the boot path.
- `manifests/sites.ts` declares 23 capabilities. This group has 5. A scaffold-style contract test (one handler per capability) would fail.
- `CREATE TABLE` runs inside the handlers. DDL belongs in `modules/sites/migrations`.
- The id is `sit_` plus `ctx.now().toString(36)`. Two creates in the same millisecond collide, and the insert then throws a raw database error.
- `sites.create` ignores `repoUrl` and `templateKit`. The manifest says create makes the root folder under Deployments. This handler does not.
- `sites.list` ignores `section`.
- `sites.update` drops `settings` and, when `name` is omitted, returns the current row. `siteRow` has no settings field, so the call should fail `validation.bad_input` when settings are sent.
- The delete gate stays in the host. `host/src/invoke.ts` applies a capability `gate` before the handler. The handler does not need a second check.
- No contract test was added.

Do not hand `modules/sites/crud.ts` to the sites build packet.

### HubSpot adapter: send back

`testConnectionFromBody` and `healthFromResponse` match the manifest outputs. Health detail is a fixed phrase, so the provider body is not copied into the result. `listObjectsFromBody` reads CRM v3 `results` and `paging.next.after`. A non-2xx or a non-object body returns null so the caller can raise `provider.bad_response`. The file does not call `fetch`. Domains match the manifest. Generated `stub-impl.ts` is untouched.

`pushObjectFromBody` treats response `properties` as `replaced`. The manifest says the push stores the replaced value so the push can be undone. That prior value is not in the success body. The handler has to snapshot it before the call. Shipping this parser as `replaced` would undo to the new value.

`connectors/` is an L3 path in `scripts/lanes.json` and is not a layer in `scripts/boundaries.json`. This file has no imports, so it creates no boundary edge. A module that later imports it needs a layer ruling. The host still serves the HubSpot stub, so this adapter is not live.

Do not hand `connectors/hubspot/account.ts` to the HubSpot build packet until `replaced` is the prior value.

## Checks

`npm run check -- --affected` was not run. The repo rule forbids node and npm on this machine. The harness pushes `packet/P-PR_72` and CI runs the checks.

The packet diff is this file only:

- `gen --check`: no path under `generated/` changes, so there is no generator drift.
- typecheck: the diff has no TypeScript.
- lint: `scripts/lint/no-em-dash-or-section-sign.ts` applies to markdown. This file uses hyphens and periods.
- boundaries: this file has no imports. `docs/` is L11.

The throwaway branch is outside the packet diff, so CI on `packet/P-PR_72` does not typecheck `modules/sites/crud.ts` or `connectors/hubspot/account.ts`. That is intended. Those files failed lead review and stay off the branch CI will build.

## Diff: UI (`219efe5`)

```diff
diff --git a/ui/src/Menu/Placeholder.tsx b/ui/src/Menu/Placeholder.tsx
index 61c9f3d..1517a48 100644
--- a/ui/src/Menu/Placeholder.tsx
+++ b/ui/src/Menu/Placeholder.tsx
@@ -21,10 +21,19 @@ function entryHtml(entry: MenuEntry): string {
   return `<div data-item="true" role="menuitem"${report}${icon}${checked}${danger}>${esc(entry.label)}</div>`;
 }
 
+/** D51 (V1-SPEC section 1): every actionable item has an icon, or none do. */
+function iconCoverage(items: readonly MenuEntry[]): "all" | "none" | "mixed" {
+  const actionable = items.filter(isItem);
+  const withIcon = actionable.filter((entry) => typeof entry.icon === "string" && entry.icon.length > 0).length;
+  if (withIcon === 0) return "none";
+  if (withIcon === actionable.length) return "all";
+  return "mixed";
+}
+
 export function MenuPlaceholder(props: MenuProps): string {
   const items = resolveMenuItems(props);
   const first = items.find(isItem);
   const label = first?.label ?? "Menu";
-  const body = `<div role="menu">${items.map(entryHtml).join("")}</div>`;
+  const body = `<div role="menu" data-menu-icons="${iconCoverage(items)}">${items.map(entryHtml).join("")}</div>`;
   return labelledBox("Menu", label, body);
 }
```

## Diff: CRUD (`9891a3a`)

```diff
diff --git a/modules/sites/crud.ts b/modules/sites/crud.ts
new file mode 100644
index 0000000..22c016c
--- /dev/null
+++ b/modules/sites/crud.ts
@@ -0,0 +1,152 @@
+// sites CRUD handler group (lane L8): sites.create, sites.get, sites.list, sites.update, sites.delete.
+// The host still serves generated/modules/sites/stub-impl.ts while host/modules.json says status stub.
+// Table creation belongs in a migration. This rehearsal file creates the table so a seeded Space can call the group.
+import { ERROR_CODES, VyreErr } from "../../packages/contracts/src/errors.ts";
+import type { Ctx } from "../../packages/contracts/src/ctx.ts";
+import type { ErrorCode, Level, VyreError } from "../../packages/contracts/src/types.ts";
+
+const TABLE = "sites_item";
+const KINDS = ["site", "app", "api", "worker", "artifact"] as const;
+type Kind = (typeof KINDS)[number];
+
+export interface SiteRow {
+  siteId: string;
+  name: string;
+  kind: Kind;
+  owner: string;
+  repoFolderId?: string;
+  stagingUrl?: string;
+  productionUrl?: string;
+  state: "queued" | "building" | "ready" | "failed" | "stopped";
+}
+
+interface DbRow {
+  id: string;
+  name: string;
+  kind: Kind;
+  owner: string;
+  state: SiteRow["state"];
+  repo_folder_id: string | null;
+}
+
+function raise(ctx: Ctx, code: ErrorCode, message?: string): never {
+  const def = ERROR_CODES.find((row) => row.code === code);
+  const error: VyreError = {
+    code,
+    message: message ?? def?.what ?? code,
+    retryable: def?.retryable ?? false,
+    traceId: ctx.trace.traceId,
+    next: (def?.next ?? ["report"]).map((kind) => ({ kind, label: kind })),
+  };
+  throw new VyreErr(error);
+}
+
+function allow(ctx: Ctx, perm: string | null, level: Level, siteId: string | null): void {
+  const decision = ctx.authorize({ perm, level }, { type: "site", id: siteId });
+  if (decision.effect !== "allow") raise(ctx, "permission.no_grant");
+}
+
+function ensure(ctx: Ctx): void {
+  ctx.db.run(
+    `CREATE TABLE IF NOT EXISTS ${TABLE} (
+      id TEXT PRIMARY KEY,
+      name TEXT NOT NULL,
+      kind TEXT NOT NULL,
+      owner TEXT NOT NULL,
+      state TEXT NOT NULL,
+      repo_folder_id TEXT
+    )`,
+  );
+}
+
+function fromRow(row: DbRow): SiteRow {
+  const site: SiteRow = {
+    siteId: row.id,
+    name: row.name,
+    kind: row.kind,
+    owner: row.owner,
+    state: row.state,
+  };
+  if (row.repo_folder_id) site.repoFolderId = row.repo_folder_id;
+  return site;
+}
+
+function one(ctx: Ctx, siteId: string): SiteRow | undefined {
+  const rows = ctx.db.all(`SELECT id, name, kind, owner, state, repo_folder_id FROM ${TABLE} WHERE id = ?`, siteId) as DbRow[];
+  const row = rows[0];
+  return row ? fromRow(row) : undefined;
+}
+
+export const handlers = {
+  "sites.create": async (ctx: Ctx, input: { name: string; kind: Kind; repoUrl?: string; templateKit?: string }): Promise<{ site: SiteRow }> => {
+    allow(ctx, "sites.deploy", "edit", null);
+    if (!KINDS.includes(input.kind)) raise(ctx, "validation.bad_input");
+    const name = input.name.trim();
+    if (name.length === 0) raise(ctx, "validation.bad_input");
+    ensure(ctx);
+    const siteId = `sit_${ctx.now().toString(36)}`;
+    ctx.db.run(
+      `INSERT INTO ${TABLE} (id, name, kind, owner, state, repo_folder_id) VALUES (?, ?, ?, ?, 'queued', NULL)`,
+      siteId, name, input.kind, ctx.principal.id,
+    );
+    ctx.emit("site.created", siteId, { siteId, name });
+    const site = one(ctx, siteId);
+    if (!site) raise(ctx, "internal.unexpected");
+    return { site };
+  },
+
+  "sites.get": async (ctx: Ctx, input: { siteId: string }): Promise<{ site: SiteRow }> => {
+    allow(ctx, null, "view", input.siteId);
+    ensure(ctx);
+    const site = one(ctx, input.siteId);
+    if (!site) raise(ctx, "permission.not_found");
+    return { site };
+  },
+
+  "sites.list": async (ctx: Ctx, input: { section?: "personal" | "shared" | "space"; folderId?: string; cursor?: string; limit?: number }): Promise<{ sites: SiteRow[]; next?: string; total?: number }> => {
+    allow(ctx, null, "view", null);
+    ensure(ctx);
+    const limit = input.limit ?? 50;
+    const offset = input.cursor ? Number(input.cursor) : 0;
+    if (!Number.isInteger(offset) || offset < 0 || limit < 1 || limit > 500) raise(ctx, "validation.bad_input");
+    const args: unknown[] = [];
+    let where = "";
+    if (input.folderId) {
+      where = " WHERE repo_folder_id = ?";
+      args.push(input.folderId);
+    }
+    const totalRow = ctx.db.all(`SELECT COUNT(*) AS n FROM ${TABLE}${where}`, ...args) as { n: number }[];
+    const rows = ctx.db.all(
+      `SELECT id, name, kind, owner, state, repo_folder_id FROM ${TABLE}${where} ORDER BY id LIMIT ? OFFSET ?`,
+      ...args, limit, offset,
+    ) as DbRow[];
+    const nextOff = offset + rows.length;
+    const total = totalRow[0]?.n ?? rows.length;
+    const out: { sites: SiteRow[]; next?: string; total?: number } = { sites: rows.map(fromRow), total };
+    if (nextOff < total) out.next = String(nextOff);
+    return out;
+  },
+
+  "sites.update": async (ctx: Ctx, input: { siteId: string; name?: string; settings?: Record<string, unknown> }): Promise<{ site: SiteRow }> => {
+    allow(ctx, "sites.deploy", "edit", input.siteId);
+    ensure(ctx);
+    const current = one(ctx, input.siteId);
+    if (!current) raise(ctx, "permission.not_found");
+    if (input.name === undefined) return { site: current };
+    const name = input.name.trim();
+    if (name.length === 0) raise(ctx, "validation.bad_input");
+    ctx.db.run(`UPDATE ${TABLE} SET name = ? WHERE id = ?`, name, input.siteId);
+    const site = one(ctx, input.siteId);
+    if (!site) raise(ctx, "internal.unexpected");
+    return { site };
+  },
+
+  "sites.delete": async (ctx: Ctx, input: { siteId: string }): Promise<{ deleted: boolean }> => {
+    allow(ctx, "sites.deploy", "manage", input.siteId);
+    ensure(ctx);
+    const current = one(ctx, input.siteId);
+    if (!current) raise(ctx, "permission.not_found");
+    const result = ctx.db.run(`DELETE FROM ${TABLE} WHERE id = ?`, input.siteId);
+    return { deleted: result.changes === 1 };
+  },
+};
```

## Diff: adapter (`249e267`)

```diff
diff --git a/connectors/hubspot/account.ts b/connectors/hubspot/account.ts
new file mode 100644
index 0000000..267e833
--- /dev/null
+++ b/connectors/hubspot/account.ts
@@ -0,0 +1,100 @@
+// HubSpot response adapter (lane L3). Parses bodies that ctx.http already fetched.
+// Domains match manifests/connectors/hubspot.ts. This file does not call fetch.
+// The host still serves generated/modules/hubspot/stub-impl.ts while the module is a stub.
+
+export const HUBSPOT_DOMAINS = ["api.hubapi.com", "app.hubspot.com"] as const;
+
+export const HUBSPOT_ACCOUNT_URL = "https://api.hubapi.com/account-info/v3/details";
+
+export interface TestConnectionOut {
+  ok: boolean;
+  portalId?: string;
+}
+
+export interface HealthOut {
+  state: "healthy" | "degraded" | "down";
+  detail?: string;
+  latencyMs?: number;
+}
+
+export interface ListObjectsOut {
+  objects: Record<string, unknown>[];
+  next?: string;
+}
+
+export interface PushObjectOut {
+  remoteId: string;
+  replaced?: Record<string, unknown>;
+}
+
+function record(value: unknown): Record<string, unknown> | undefined {
+  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
+  return value as Record<string, unknown>;
+}
+
+function portalIdOf(value: unknown): string | undefined {
+  if (typeof value === "number" && Number.isFinite(value)) return String(value);
+  if (typeof value === "string" && value.length > 0) return value;
+  return undefined;
+}
+
+/** hubspot.test_connection. A non-2xx or a body that is not JSON is not ok. */
+export function testConnectionFromBody(status: number, body: string): TestConnectionOut {
+  if (status < 200 || status >= 300) return { ok: false };
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(body);
+  } catch {
+    return { ok: false };
+  }
+  const row = record(parsed);
+  const portalId = portalIdOf(row?.portalId);
+  return portalId ? { ok: true, portalId } : { ok: true };
+}
+
+/** hubspot.health. Detail is a fixed phrase. The provider body is not copied. */
+export function healthFromResponse(status: number, latencyMs: number): HealthOut {
+  if (status >= 200 && status < 300) return { state: "healthy", latencyMs };
+  if (status === 429 || status >= 500) return { state: "degraded", detail: "provider unavailable", latencyMs };
+  return { state: "down", detail: "provider refused", latencyMs };
+}
+
+/** hubspot.list_objects. Null means the handler should raise provider.bad_response. */
+export function listObjectsFromBody(status: number, body: string): ListObjectsOut | null {
+  if (status < 200 || status >= 300) return null;
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(body);
+  } catch {
+    return null;
+  }
+  const row = record(parsed);
+  if (!row) return null;
+  const results = Array.isArray(row.results) ? row.results : [];
+  const objects: Record<string, unknown>[] = [];
+  for (const item of results) {
+    const obj = record(item);
+    if (obj) objects.push(obj);
+  }
+  const paging = record(row.paging);
+  const nextRow = record(paging?.next);
+  const after = nextRow?.after;
+  const next = typeof after === "string" && after.length > 0 ? after : undefined;
+  return next ? { objects, next } : { objects };
+}
+
+/** hubspot.push_object. Null means the handler should raise provider.bad_response. */
+export function pushObjectFromBody(status: number, body: string): PushObjectOut | null {
+  if (status < 200 || status >= 300) return null;
+  let parsed: unknown;
+  try {
+    parsed = JSON.parse(body);
+  } catch {
+    return null;
+  }
+  const row = record(parsed);
+  const remoteId = portalIdOf(row?.id);
+  if (!remoteId) return null;
+  const replaced = record(row?.properties);
+  return replaced ? { remoteId, replaced } : { remoteId };
+}
```
