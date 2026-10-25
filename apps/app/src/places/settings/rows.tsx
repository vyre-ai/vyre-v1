// Every SettingDef of the registry in one row: `SettingControl` draws the right control for the value (a switch, a choice, a number, a field, hours, a mode, one switch per Space) and saves
// as it is made through settings.set, which returns the previous value so Undo is one more call. A change the Space's floor refuses says so in a sentence and the control goes back.
import type { ReactElement } from "react";
import { Fragment } from "react";
import { useSaved } from "./saved.tsx";
import { useSettingsData } from "./data.tsx";
import { MODES, bytesLabel, controlFor, hoursSummary, labelOf, rowLabel, splitList, summaryOf, timeIn } from "./model.ts";
import type { Hours, SettingRow } from "./model.ts";
import { Choice, Field, Segmented, SettingsRow, SmallButton, Slider, Stepper, Switch, Value } from "./ui.tsx";

export const HOURS_PRESETS: readonly { id: string; label: string; value: Hours }[] = [
  { id: "wk95", label: "Mon to Fri, 9:00 AM to 5:30 PM", value: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:30" } },
  { id: "wk84", label: "Mon to Fri, 8:00 AM to 4:00 PM", value: { days: [1, 2, 3, 4, 5], from: "08:00", to: "16:00" } },
  { id: "wk106", label: "Mon to Fri, 10:00 AM to 6:00 PM", value: { days: [1, 2, 3, 4, 5], from: "10:00", to: "18:00" } },
  { id: "mt", label: "Mon to Thu, 9:00 AM to 5:00 PM", value: { days: [1, 2, 3, 4], from: "09:00", to: "17:00" } },
  { id: "all", label: "Every day, 9:00 AM to 5:00 PM", value: { days: [0, 1, 2, 3, 4, 5, 6], from: "09:00", to: "17:00" } },
];

/** Save one change: the new value goes through settings.set, then the line says Saved with Undo (which puts the previous value back). */
export function useChange(): (row: SettingRow, value: unknown, say?: string) => Promise<void> {
  const data = useSettingsData();
  const saved = useSaved();
  return async (row, value, say) => {
    try {
      const out = (await data.call("settings.set", { key: row.key, value })) as { previous?: unknown };
      saved.saved(say ?? "Saved", out.previous === undefined ? undefined : async () => { await data.call("settings.set", { key: row.key, value: out.previous }); saved.saved("Put back"); });
    } catch (e) {
      saved.failed(e instanceof Error ? e.message : "That did not save.");
    }
  };
}

export function SettingControl({ row }: { row: SettingRow }): ReactElement {
  const change = useChange();
  const c = controlFor(row);
  const v = row.value;
  const label = rowLabel(row);
  switch (c.kind) {
    case "switch": return <Switch on={v === true} label={label} testID={`ctl-${row.key}`} onChange={(n) => void change(row, n)} />;
    case "choice":
      if (row.key === "appearance.density") return <Segmented value={String(v)} options={c.options} label={label} testID={`ctl-${row.key}`} onChange={(n) => void change(row, n)} />;
      return <Choice value={String(v)} options={c.options} label={label} testID={`ctl-${row.key}`} onChange={(n) => void change(row, n)} />;
    case "number":
      if (row.key === "appearance.text_size") return <Slider value={typeof v === "number" ? v : 100} min={c.min ?? 90} max={c.max ?? 120} step={5} label={label} format={(n) => `${n}%`} testID={`ctl-${row.key}`} onChange={(n) => void change(row, n)} />;
      return <Stepper value={typeof v === "number" ? v : 0} {...(c.min !== undefined ? { min: c.min } : {})} {...(c.max !== undefined ? { max: c.max } : {})} step={c.step} label={label} {...(row.key.endsWith("_mb") ? { format: bytesLabel } : {})} testID={`ctl-${row.key}`} onChange={(n) => void change(row, n)} />;
    case "text": return <Field value={typeof v === "string" ? v : ""} label={label} testID={`ctl-${row.key}`} {...(c.pattern ? { pattern: c.pattern } : {})} mono={c.mono === true} onCommit={(n) => void change(row, n)} />;
    case "hours": return <HoursControl row={row} />;
    case "mode": {
      const cur = (v ?? {}) as { base?: string; spaces?: Record<string, string> };
      return <Choice value={cur.base ?? "ask"} options={MODES} label={label} testID={`ctl-${row.key}`} onChange={(n) => void change(row, { ...cur, base: n })} />;
    }
    case "list": return <Field value={Array.isArray(v) ? v.join(", ") : ""} label={label} width={240} testID={`ctl-${row.key}`} onCommit={(n) => void change(row, splitList(n))} />;
    case "spacemap": return <Value text={summaryOf(v)} testID={`ctl-${row.key}`} />;
    default:
      if (row.key === "home.digest_schedule") {
        const cur = (v ?? { at: "07:30", tz: "UTC" }) as { at: string; tz: string };
        return <Field value={cur.at} label={label} width={90} pattern="^[0-2][0-9]:[0-5][0-9]$" testID={`ctl-${row.key}`} onCommit={(n) => void change(row, { ...cur, at: n })} />;
      }
      return <Value text={summaryOf(v)} testID={`ctl-${row.key}`} />;
  }
}

function HoursControl({ row }: { row: SettingRow }): ReactElement {
  const change = useChange();
  const cur = row.value as Hours | null;
  const match = HOURS_PRESETS.find((p) => JSON.stringify(p.value.days) === JSON.stringify(cur?.days) && p.value.from === cur?.from && p.value.to === cur?.to);
  const options: { value: string; label: string }[] = [];
  for (const p of HOURS_PRESETS) options.push({ value: p.id, label: p.label });
  if (!match) options.unshift({ value: "current", label: hoursSummary(cur) });
  return (
    <Choice
      value={match?.id ?? "current"} options={options} label={row.title} testID={`ctl-${row.key}`}
      onChange={(id) => { const p = HOURS_PRESETS.find((x) => x.id === id); if (p) void change(row, { ...p.value, tz: cur?.tz ?? "UTC" }); }}
    />
  );
}

/** What a row says under its label: where the value comes from, or the floor the Space set. Nothing when the row says it all. */
export function subOf(row: SettingRow): string | undefined {
  if (row.floorable && row.floor !== undefined && row.floor !== null) return `Your Space asks for at least ${summaryOf(row.floor)}`;
  if (row.source === "space") return "Set by your Space";
  return undefined;
}

/** One row for one setting, with its reset when it differs from the default. */
export function SettingRowFor({ row, first, found = false }: { row: SettingRow; first: boolean; found?: boolean }): ReactElement {
  const data = useSettingsData();
  const saved = useSaved();
  const c = controlFor(row);
  const changed = row.source === "person" && JSON.stringify(row.value) !== JSON.stringify(row.default);
  const reset = async (): Promise<void> => {
    const before = row.value;
    try { await data.call("settings.reset", { key: row.key }); saved.saved("Back to the default", async () => { await data.call("settings.set", { key: row.key, value: before }); saved.saved("Put back"); }); }
    catch (e) { saved.failed(e instanceof Error ? e.message : "That did not reset."); }
  };
  if (c.kind === "spacemap") {
    const map = (row.value ?? {}) as Record<string, boolean>;
    const items = data.spaces.filter((sp) => sp.kind === "team");
    const out: ReactElement[] = [<SettingsRow key={row.key} id={row.key} label={row.title} first={first} found={found} control={<Value text={items.length === 0 ? "No Team Spaces" : `${items.filter((sp) => map[sp.id] === true).length} of ${items.length}`} />} />];
    for (const sp of items) {
      out.push(<SettingsRow key={`${row.key}-${sp.id}`} id={`${row.key}.${sp.id}`} label={sp.name} indent control={<SpaceSwitch rowKey={row} spaceId={sp.id} on={map[sp.id] === true} />} />);
    }
    return <Fragment>{out}</Fragment>;
  }
  const sub = row.key === "profile.timezone" && typeof row.value === "string" ? `It is ${timeIn(data.clock().now, row.value)} for you now` : subOf(row);
  return (
    <SettingsRow
      id={row.key} label={rowLabel(row)} first={first} found={found} {...(sub ? { sub } : {})}
      control={<>{changed ? <SmallButton label="Reset" testID={`reset-${row.key}`} onPress={() => void reset()} /> : null}<SettingControl row={row} /></>}
    />
  );
}

function SpaceSwitch({ rowKey, spaceId, on }: { rowKey: SettingRow; spaceId: string; on: boolean }): ReactElement {
  const change = useChange();
  const map = (rowKey.value ?? {}) as Record<string, boolean>;
  return <Switch on={on} label={`${rowKey.title}, ${spaceId}`} testID={`ctl-${rowKey.key}.${spaceId}`} onChange={(n) => void change(rowKey, { ...map, [spaceId]: n })} />;
}

export { labelOf };
