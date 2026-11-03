// Space defaults: the rows that apply to everyone in a Space. The Console draws them; a Personal Space, which has no Console, draws its own in Settings. A row saves as it is made through
// settings.set_space, with Undo, and comes back from settings.list so what shows is what the server holds.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { useSettingsData } from "./data.tsx";
import { PERSONAL_SPACE_ROWS, SPACE_ROWS, splitList } from "./model.ts";
import type { SettingRow, SpacePage, SpaceRowDef } from "./model.ts";
import { subOf } from "./rows.tsx";
import { SavedBar, SavedProvider, useSaved } from "./saved.tsx";
import { MemoryKeys } from "./MemoryKeys.tsx";
import { MemoryLearningLimits } from "./MemoryLearning.tsx";
import { Choice, Field, Section, SettingsRow, Stepper, Switch } from "./ui.tsx";

type ListOut = CapMap["settings.list"]["out"];

/** The Space rows as the server holds them, read when the person can change them. */
export function useSpaceRows(can: boolean): { rows: readonly SettingRow[]; reload(): void } {
  const data = useSettingsData();
  const [rows, setRows] = useState<readonly SettingRow[]>([]);
  const reload = useCallback((): void => {
    if (!can) return;
    void data.call("settings.list", { scope: "space" }).then((out) => setRows((out as ListOut).rows), () => undefined);
  }, [data, can]);
  useEffect(() => { reload(); }, [reload]);
  return useMemo(() => ({ rows, reload }), [rows, reload]);
}

function SpaceControlFor({ def, row, onChanged }: { def: SpaceRowDef; row: SettingRow; onChanged(): void }): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const put = (value: unknown): void => {
    void data.call("settings.set_space", { key: row.key, value }).then(
      (out) => {
        onChanged();
        const before = (out as { previous?: unknown }).previous;
        saved.saved("Saved", before === undefined ? undefined : async () => { await data.call("settings.set_space", { key: row.key, value: before }); onChanged(); saved.saved("Put back"); });
      },
      (e: unknown) => saved.failed(e instanceof Error ? e.message : "That did not save."),
    );
  };
  const c = def.control;
  const v = row.value;
  const testID = `ctl-${def.id}`;
  switch (c.kind) {
    case "switch": return <Switch on={v === true} label={def.label} testID={testID} onChange={put} />;
    case "flag": {
      const all = (v ?? {}) as Record<string, boolean>;
      return <Switch on={all[c.field] === true} label={def.label} testID={testID} onChange={(n) => put({ ...all, [c.field]: n })} />;
    }
    case "choice": return <Choice value={String(v)} options={c.options} label={def.label} testID={testID} onChange={put} />;
    case "number": return <Stepper value={typeof v === "number" ? v : 0} min={c.min} max={c.max} label={def.label} unit={c.unit} testID={testID} onChange={put} />;
    case "list": return <Field value={Array.isArray(v) ? v.join(", ") : ""} label={def.label} width={220} testID={testID} onCommit={(n) => put(splitList(n))} />;
    default: return <Field value={typeof v === "string" ? v : ""} label={def.label} placeholder="Not set" width={220} testID={testID} onCommit={put} />;
  }
}

export function SpacePageBody({ page, rows, reload, found, personal = false }: { page: SpacePage; rows: readonly SettingRow[]; reload(): void; found: string | null; personal?: boolean }): ReactElement {
  const parts: ReactElement[] = [];
  const shown = SPACE_ROWS.filter((def) => def.page === page && (!personal || PERSONAL_SPACE_ROWS.has(def.id)));
  const heads: string[] = [];
  for (const def of shown) if (!heads.includes(def.section)) heads.push(def.section);
  for (const head of heads) {
    const items: ReactElement[] = [];
    for (const def of shown) {
      if (def.section !== head) continue;
      const row = rows.find((r) => r.key === def.key);
      if (!row) continue;
      const sub = subOf(row);
      items.push(<SettingsRow key={def.id} id={def.id} label={def.label} help={def.help} first={items.length === 0} found={found === def.id} inline={def.control.kind === "switch" || def.control.kind === "flag"} {...(sub ? { sub } : {})} control={<SpaceControlFor def={def} row={row} onChanged={reload} />} />);
    }
    if (items.length > 0) parts.push(<Section key={head} title={head}>{items}</Section>);
  }
  return <>{parts}</>;
}

/** One page of Space defaults, as the Console opens it. */
export function SpaceDefaults({ page }: { page: SpacePage | "memory" | "memlearn" }): ReactElement {
  return <SavedProvider><SavedBar />{page === "memory" ? <MemoryKeys tier="space" /> : page === "memlearn" ? <MemoryLearningLimits /> : <SpaceDefaultRows page={page} />}</SavedProvider>;
}

function SpaceDefaultRows({ page }: { page: SpacePage }): ReactElement {
  const { rows, reload } = useSpaceRows(true);
  return <SpacePageBody page={page} rows={rows} reload={reload} found={null} />;
}
