// Settings capabilities (spec 3.9, ARCH 7.9): the registry rows of every module's SettingDef, read for the person asking; changes that save as they are made and hand back the previous
// value so Undo is one more call; the Space-wide rows and the owner floor; Cmd-F; Copy from another Space; and the Kit choice. A value no schema accepts is refused with a sentence.
import { COPY_KEY, DEFAULT_KIT, PAGES, byOf, comparable, defOf, defs, drop, effective, floorOf, meetsFloor, me, pageOf, put, raise, refusal, rowOut, search, stored } from "../projections.ts";
import type { CopyField, SettingsCtx } from "../projections.ts";

// ---- reads

export async function pages(_ctx: SettingsCtx, _input: Record<string, never>) {
  const counts = new Map<string, number>();
  for (const d of defs) { const p = pageOf(d); if (p) counts.set(p, (counts.get(p) ?? 0) + 1); }
  return { pages: PAGES.map((p) => ({ key: p.key, title: p.title, group: p.group, rows: counts.get(p.key) ?? 0 })) };
}

export async function list(ctx: SettingsCtx, input: { page?: string; scope?: "space" | "person" }) {
  const person = me(ctx);
  const rows = [];
  for (const d of defs) {
    if (input.scope && d.scope !== input.scope) continue;
    if (input.page && (pageOf(d) ?? d.page) !== input.page) continue;
    // with no page named, a person reads the rows of the ten pages; the Console's Space rows are asked for by name
    if (!input.page && !input.scope && pageOf(d) === null) continue;
    rows.push(rowOut(ctx, d, person));
  }
  return { rows };
}

export async function get(ctx: SettingsCtx, input: { key: string }) {
  return { row: rowOut(ctx, defOf(ctx, input.key), me(ctx)) };
}

export async function searchRows(_ctx: SettingsCtx, input: { q: string }) {
  return { rows: search(input.q) };
}

// ---- my values

function check(ctx: SettingsCtx, key: string, value: unknown): void {
  const d = defOf(ctx, key);
  const why = refusal(d, value);
  if (why) raise(ctx, "validation.bad_input", why);
  const floor = d.floorable === true ? floorOf(ctx, key) : undefined;
  if (floor !== undefined && !meetsFloor(key, value, floor)) raise(ctx, "validation.field_locked", `${d.title}: your Space does not allow anything less strict than ${JSON.stringify(floor)}.`);
}

function changed(ctx: SettingsCtx, key: string, scope: "space" | "person", person: string, before: unknown, after: unknown): void {
  ctx.emit("settings.changed", key, { key, scope, ...(scope === "person" ? { person } : {}), before, after, by: byOf(ctx) });
}

export async function set(ctx: SettingsCtx, input: { key: string; value: unknown }) {
  const person = me(ctx);
  const d = defOf(ctx, input.key);
  if (d.scope !== "person") raise(ctx, "validation.bad_input", `${d.title} is a Space setting; an admin changes it for the whole Space.`);
  check(ctx, input.key, input.value);
  const before = effective(ctx, d, person).value;
  put(ctx, input.key, "person", person, input.value);
  changed(ctx, input.key, "person", person, before, input.value);
  return { row: rowOut(ctx, d, person), previous: before };
}

export async function reset(ctx: SettingsCtx, input: { key: string }) {
  const person = me(ctx);
  const d = defOf(ctx, input.key);
  if (d.scope !== "person") raise(ctx, "validation.bad_input", `${d.title} is a Space setting; an admin changes it for the whole Space.`);
  const before = effective(ctx, d, person).value;
  drop(ctx, input.key, "person", person);
  const after = effective(ctx, d, person).value;
  if (JSON.stringify(before) !== JSON.stringify(after)) changed(ctx, input.key, "person", person, before, after);
  return { row: rowOut(ctx, d, person) };
}

// ---- the Space's values and the owner floor

export async function setSpace(ctx: SettingsCtx, input: { key: string; value: unknown }) {
  const person = me(ctx);
  const d = defOf(ctx, input.key);
  const why = refusal(d, input.value);
  if (why) raise(ctx, "validation.bad_input", why);
  const floor = d.floorable === true ? floorOf(ctx, input.key) : undefined;
  if (floor !== undefined && !meetsFloor(input.key, input.value, floor)) raise(ctx, "validation.field_locked", `${d.title}: the owner floor does not allow anything less strict than ${JSON.stringify(floor)}.`);
  const before = stored(ctx, input.key, "space", "")?.value ?? d.default;
  put(ctx, input.key, "space", "", input.value);
  changed(ctx, input.key, "space", person, before, input.value);
  return { row: rowOut(ctx, d, person), previous: before };
}

export async function resetSpace(ctx: SettingsCtx, input: { key: string }) {
  const person = me(ctx);
  const d = defOf(ctx, input.key);
  const before = stored(ctx, input.key, "space", "")?.value ?? d.default;
  drop(ctx, input.key, "space", "");
  if (JSON.stringify(before) !== JSON.stringify(d.default)) changed(ctx, input.key, "space", person, before, d.default);
  return { row: rowOut(ctx, d, person) };
}

export async function floorSet(ctx: SettingsCtx, input: { key: string; floor: unknown }) {
  const person = me(ctx);
  const d = defOf(ctx, input.key);
  if (d.floorable !== true || !comparable(input.key)) raise(ctx, "validation.bad_input", `${d.title} cannot have a floor.`);
  const why = refusal(d, input.floor);
  if (why) raise(ctx, "validation.bad_input", why);
  ctx.db.run(`INSERT OR REPLACE INTO settings_floor (setting, floor, changed_by, updated_at) VALUES (?, ?, ?, ?)`, input.key, JSON.stringify(input.floor), byOf(ctx), ctx.now());
  ctx.emit("settings.floor_changed", input.key, { key: input.key, by: byOf(ctx) });
  return { row: rowOut(ctx, d, person) };
}

// ---- Copy from another Space

const COPY_FIELDS = Object.keys(COPY_KEY) as CopyField[];
const present = (v: unknown): boolean => v !== null && v !== undefined && v !== "" && !(typeof v === "object" && Object.keys(v as object).length === 0);

/** This Space's side of Copy from another Space: the profile values of mine that may be carried over. Title is never among them. */
export async function copySource(ctx: SettingsCtx, _input: Record<string, never>) {
  const person = me(ctx);
  const val = (f: CopyField): unknown => effective(ctx, defOf(ctx, COPY_KEY[f]), person).value;
  const out: Record<string, unknown> = {};
  if (present(val("photo"))) out["photoFileId"] = val("photo");
  if (present(val("name"))) out["name"] = val("name");
  if (present(val("handle"))) out["handle"] = val("handle");
  if (present(val("timezone"))) out["timezone"] = val("timezone");
  if (present(val("hours"))) out["hours"] = val("hours");
  const contact = val("contact") as { email?: string; phone?: string } | undefined;
  if (contact && (contact.email || contact.phone)) out["contact"] = { ...(contact.email ? { email: contact.email } : {}), ...(contact.phone ? { phone: contact.phone } : {}) };
  return out;
}

/** This Space's other half: write the chosen values into my profile here. A field that is not listed is left alone, and a title in the values is ignored. */
export async function copyProfile(ctx: SettingsCtx, input: { fields: CopyField[]; values: Record<string, unknown> }) {
  const person = me(ctx);
  const applied: CopyField[] = [];
  const todo: { f: CopyField; key: string; value: unknown }[] = [];
  for (const f of input.fields) {
    if (!COPY_FIELDS.includes(f)) raise(ctx, "validation.bad_input", `${String(f)} cannot be copied`);
    const value = f === "photo" ? (input.values["photo"] ?? input.values["photoFileId"]) : input.values[f];
    if (value === undefined) raise(ctx, "validation.bad_input", `there is no value to copy for ${f}`);
    const why = refusal(defOf(ctx, COPY_KEY[f]), value);
    if (why) raise(ctx, "validation.bad_input", why);
    todo.push({ f, key: COPY_KEY[f], value });
  }
  for (const t of todo) {
    const d = defOf(ctx, t.key);
    const before = effective(ctx, d, person).value;
    put(ctx, t.key, "person", person, t.value);
    changed(ctx, t.key, "person", person, before, t.value);
    if (!applied.includes(t.f)) applied.push(t.f);
  }
  return { applied };
}

// ---- Kit choice

function kitOut(ctx: SettingsCtx, person: string) {
  const space = (stored(ctx, "kit.space_choice", "space", "")?.value ?? null) as string | null;
  const mine = (stored(ctx, "kit.person_choice", "person", person)?.value ?? null) as string | null;
  return { kit: { space, person: mine, effective: mine ?? space ?? DEFAULT_KIT } };
}

export async function kitGet(ctx: SettingsCtx, _input: Record<string, never>) {
  return kitOut(ctx, me(ctx));
}

export async function kitSetMine(ctx: SettingsCtx, input: { kitId: string | null }) {
  const person = me(ctx);
  const d = defOf(ctx, "kit.person_choice");
  const why = refusal(d, input.kitId);
  if (why) raise(ctx, "validation.bad_input", why);
  const before = (stored(ctx, "kit.person_choice", "person", person)?.value ?? null) as string | null;
  if (input.kitId === null) drop(ctx, "kit.person_choice", "person", person); else put(ctx, "kit.person_choice", "person", person, input.kitId);
  if (before !== input.kitId) changed(ctx, "kit.person_choice", "person", person, before, input.kitId);
  return kitOut(ctx, person);
}

export async function kitSetSpace(ctx: SettingsCtx, input: { kitId: string }) {
  const person = me(ctx);
  const d = defOf(ctx, "kit.space_choice");
  const why = refusal(d, input.kitId);
  if (why) raise(ctx, "validation.bad_input", why);
  const before = (stored(ctx, "kit.space_choice", "space", "")?.value ?? null) as string | null;
  put(ctx, "kit.space_choice", "space", "", input.kitId);
  if (before !== input.kitId) changed(ctx, "kit.space_choice", "space", person, before, input.kitId);
  return kitOut(ctx, person);
}
