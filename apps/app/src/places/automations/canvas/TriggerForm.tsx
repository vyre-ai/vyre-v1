// The Configure form for a trigger: its name, then what narrows it (a record type, a form, a spreadsheet), or for a schedule the picker: how often, at what time, on which days, in which
// time zone, with the schedule in words and the next three runs under it. A cron line is the last resort, under Advanced.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useOptionalAutomationsData } from "./data.tsx";
import { Choice, Field, Hint } from "./fields.tsx";
import { fieldsOfTrigger, specOf, triggerText, triggerValue, writeTriggerField } from "./form-model.ts";
import type { TriggerField } from "./form-model.ts";
import { Glyph } from "./icons.tsx";
import type { DefTrigger } from "./model.ts";
import { pointer } from "./parts.tsx";
import {
  DAY_SHORT, EVERY_CHOICES, configFromDraft, cronFromDraft, deviceTimeZone, draftProblem, nextRuns, runWords, scheduleOf, scheduleWords, timeParts, validTimeZone,
} from "./schedule.ts";
import type { Every, ScheduleDraft } from "./schedule.ts";
import { useRefPicks } from "./steps/useLists.ts";
import type { OpenMenu } from "./steps/StepForms.tsx";

/** The common zones, for the Change link. The person's own zone and this device's always head the list. */
const ZONES: readonly string[] = [
  "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Africa/Cairo",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

/** The person's time zone from Settings (profile.timezone). Until it has answered, or if it cannot, this device's zone. */
export function usePersonZone(): string {
  const data = useOptionalAutomationsData();
  const [zone, setZone] = useState<string>(() => deviceTimeZone());
  useEffect(() => {
    if (!data) return undefined;
    let live = true;
    data.call("settings.get", { key: "profile.timezone" }).then((out) => {
      const row = out && typeof out === "object" ? (out as { row?: { value?: unknown } }).row : undefined;
      if (live && typeof row?.value === "string" && validTimeZone(row.value)) setZone(row.value);
    }, () => undefined);
    return () => { live = false; };
  }, [data]);
  return zone;
}

const EVERY_LABEL: Record<Every, string> = {
  minutes: "Every few minutes", hours: "Every few hours", day: "Every day", weekdays: "Every weekday", week: "Every week", month: "Every month", cron: "Custom (cron)",
};
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

export function SchedulePicker({ trigger, onChange, openMenu, zone: personZone, now }: {
  trigger: DefTrigger; onChange(next: DefTrigger): void; openMenu: OpenMenu; zone: string; now?: number;
}): ReactElement {
  const cfg = trigger.config;
  const read = scheduleOf(cfg, personZone);
  const [draft, setDraft] = useState<ScheduleDraft>(read.draft);
  const [advanced, setAdvanced] = useState(read.draft.every === "cron");
  const tz = read.timezone;
  // follow the saved schedule when it changes from outside (Undo, the JSON box)
  useEffect(() => {
    if (read.set && cronFromDraft(draft) !== read.cron) setDraft(read.draft);
    // only the stored cron matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read.cron]);
  const problem = draftProblem(draft);
  const save = (next: ScheduleDraft, zone: string = tz, missed?: string): void => {
    setDraft(next);
    const made = configFromDraft({ ...(cfg ?? {}), ...(missed ? { missed } : {}) }, next, zone);
    if (made) onChange({ ...trigger, config: made });
  };
  const patch = (p: Partial<ScheduleDraft>): void => save({ ...draft, ...p });
  const cron = cronFromDraft(draft);
  const words = cron ? scheduleWords(cron, tz) : undefined;
  const clock = useNow();
  const at = now ?? clock;
  const runs = cron ? nextRuns(cron, tz, at, 3) : [];
  const zones = useMemo(() => {
    const out: string[] = [];
    for (const z of [personZone, deviceTimeZone(), tz, ...ZONES]) if (z && validTimeZone(z) && !out.includes(z)) out.push(z);
    return out;
  }, [personZone, tz]);
  const minute = timeParts(draft.time)?.m ?? 0;
  return (
    <View style={s.wrap} testID="schedule-picker">
      <Choice
        label="Repeat" value={EVERY_LABEL[draft.every]} testID="schedule-every"
        onOpen={(x, y) => openMenu(EVERY_CHOICES.map((c): MenuEntry => ({
          label: EVERY_LABEL[c.key], checked: draft.every === c.key,
          onSelect: () => { setAdvanced(false); save({ ...draft, every: c.key, ...(c.key === "minutes" && (draft.n < 1 || draft.n > 59) ? { n: 15 } : {}), ...(c.key === "hours" && (draft.n < 1 || draft.n > 23) ? { n: 1 } : {}) }); },
        })), x, y, "other")}
      />
      {draft.every === "minutes" ? <Field label="Every how many minutes" value={String(draft.n)} testID="schedule-n" onCommit={(t) => patch({ n: Number(t.trim()) })} /> : null}
      {draft.every === "hours" ? (
        <>
          <Field label="Every how many hours" value={String(draft.n)} testID="schedule-n" onCommit={(t) => patch({ n: Number(t.trim()) })} />
          <Field label="At minute" value={String(minute)} testID="schedule-minute" onCommit={(t) => { const m = Number(t.trim()); patch({ time: Number.isInteger(m) && m >= 0 && m <= 59 ? `00:${String(m).padStart(2, "0")}` : "xx" }); }} />
        </>
      ) : null}
      {draft.every === "day" || draft.every === "weekdays" || draft.every === "week" || draft.every === "month" ? (
        <Field label="At (24-hour time)" value={draft.time} placeholder="09:00" testID="schedule-time" onCommit={(t) => { const p = timeParts(t); patch({ time: p ? `${String(p.h).padStart(2, "0")}:${String(p.m).padStart(2, "0")}` : t.trim() }); }} />
      ) : null}
      {draft.every === "week" ? (
        <View style={s.field}>
          <Text style={s.label}>On</Text>
          <View style={s.chips} accessibilityRole="toolbar" accessibilityLabel="Days of the week">
            {/* ui-rows-lint: not a list (seven day chips) */}
            {MONDAY_FIRST.map((d) => {
              const on = draft.days.includes(d);
              return (
                <Pressable
                  key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={DAY_SHORT[d]} testID={`schedule-day-${d}`}
                  onPress={() => patch({ days: on ? draft.days.filter((x) => x !== d) : [...draft.days, d] })}
                  style={[s.chip, on && s.chipOn, pointer]}
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{DAY_SHORT[d]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {draft.every === "month" ? <Field label="On day of the month" value={String(draft.day)} testID="schedule-day-of-month" onCommit={(t) => patch({ day: Number(t.trim()) })} /> : null}
      <View style={s.field}>
        <Text style={s.label}>Time zone</Text>
        <View style={s.zoneRow}>
          <Text testID="schedule-zone" style={s.zone}>{tz}</Text>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`Change the time zone, now ${tz}`} testID="schedule-zone-change" style={pointer}
            onPress={(e) => {
              const ev = e as unknown as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } };
              const r = ev.currentTarget?.getBoundingClientRect?.();
              openMenu(zones.map((z): MenuEntry => ({ label: z === personZone ? `${z} (yours)` : z, checked: z === tz, onSelect: () => save(draft, z) })), r?.left ?? ev.nativeEvent?.pageX ?? 0, (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4, "other");
            }}
          >
            <Text style={s.link}>Change</Text>
          </Pressable>
        </View>
      </View>
      {problem ? <Hint danger testID="schedule-problem">{problem}</Hint> : null}
      {words ? (
        <View style={s.preview} testID="schedule-preview-box">
          <Text testID="schedule-preview" style={s.previewText}>{words}</Text>
          <Text style={s.label}>Next 3 runs</Text>
          {/* ui-rows-lint: not a list (three next run times, one line each) */}
          {runs.length === 0 ? <Text testID="schedule-no-runs" style={s.hint}>This schedule never runs.</Text> : runs.map((r, n) => <Text key={r} testID={`schedule-next-${n}`} style={s.hint}>{runWords(r, tz)}</Text>)}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} accessibilityLabel={advanced ? "Hide advanced" : "Advanced"} testID="schedule-advanced" onPress={() => setAdvanced(!advanced)} style={[s.adv, pointer]}>
        <Glyph name={advanced ? "chevD" : "chevR"} size={12} color="var(--ink-3)" />
        <Text style={s.advText}>Advanced</Text>
      </Pressable>
      {advanced ? (
        <>
          <Field
            label="Custom (cron)" value={draft.every === "cron" ? draft.cron : (cron ?? "")} mono placeholder="0 9 * * 1" testID="schedule-cron"
            onCommit={(t) => save({ ...draft, every: "cron", cron: t })}
          />
          <Hint>Five fields: minute, hour, day of the month, month, day of the week.</Hint>
          <Choice
            label="If a run was missed" value={read.missed === "run_once" ? "Run once" : read.missed === "backfill_each_tick" ? "Run each missed time" : "Skip it"} testID="schedule-missed"
            onOpen={(x, y) => openMenu([
              { label: "Skip it", checked: read.missed === "skip", onSelect: () => save(draft, tz, "skip") },
              { label: "Run once", checked: read.missed === "run_once", onSelect: () => save(draft, tz, "run_once") },
              { label: "Run each missed time", checked: read.missed === "backfill_each_tick", onSelect: () => save(draft, tz, "backfill_each_tick") },
            ], x, y, "other")}
          />
        </>
      ) : null}
    </View>
  );
}

function useNow(): number {
  const data = useOptionalAutomationsData();
  return useMemo(() => data?.clock().now ?? Date.now(), [data]);
}

function PickInner({ field, value, onText, openMenu }: { field: TriggerField; value: unknown; onText(text: string): void; openMenu: OpenMenu }): ReactElement {
  const picks = useRefPicks(field.from ?? "types");
  const text = typeof value === "string" ? value : "";
  const label = field.required ? `${field.label} (required)` : field.label;
  if (picks.state !== "ready" || picks.items.length === 0) {
    return <Field label={label} value={text} placeholder={field.placeholder ?? ""} testID={`trigger-${field.name}`} onCommit={onText} />;
  }
  const shown = text === "" ? "Any" : (picks.items.find((i) => i.value === text)?.label ?? text);
  return (
    <Choice
      label={label} value={shown} testID={`trigger-${field.name}`}
      onOpen={(x, y) => openMenu([
        ...(field.required ? [] : [{ label: "Any", checked: text === "", onSelect: () => onText("") }]),
        ...picks.items.map((i) => ({ label: i.label, checked: i.value === text, onSelect: () => onText(i.value) })),
      ], x, y, "other")}
    />
  );
}

export function TriggerForm({ trigger, onChange, openMenu, zone, now }: { trigger: DefTrigger; onChange(next: DefTrigger): void; openMenu: OpenMenu; zone: string; now?: number }): ReactElement {
  const [problem, setProblem] = useState<{ name: string; message: string } | null>(null);
  const note = specOf(trigger.key).note;
  const write = (field: TriggerField, text: string): void => {
    const out = writeTriggerField(trigger, field, text);
    if ("problem" in out) { setProblem({ name: field.name, message: out.problem }); return; }
    setProblem(null);
    onChange(out as DefTrigger);
  };
  const fields = fieldsOfTrigger(trigger.key);
  const [name, ...rest] = fields;
  const render = (field: TriggerField): ReactElement => {
    const v = triggerValue(trigger, field);
    const id = `trigger-${field.name}`;
    const label = field.required ? `${field.label} (required)` : field.label;
    const help = problem?.name === field.name ? <Hint danger testID={`${id}-problem`}>{problem.message}</Hint> : field.help ? <Hint>{field.help}</Hint> : null;
    if (field.kind === "choice") {
      const current = typeof v === "string" ? v : "";
      return (
        <View key={field.name} style={s.group}>
          <Choice label={label} value={current || "Any"} testID={id} onOpen={(x, y) => openMenu([
            ...(field.required ? [] : [{ label: "Any", checked: current === "", onSelect: () => write(field, "") }]),
            ...(field.options ?? []).map((o) => ({ label: o, checked: current === o, onSelect: () => write(field, o) })),
          ], x, y, "other")} />
          {help}
        </View>
      );
    }
    if (field.kind === "pick") return <View key={field.name} style={s.group}><PickInner field={field} value={v} onText={(t) => write(field, t)} openMenu={openMenu} />{help}</View>;
    return (
      <View key={field.name} style={s.group}>
        <Field
          label={label} value={triggerText(field, v)} testID={id} placeholder={field.placeholder ?? ""} mono={field.kind === "json"} invalid={problem?.name === field.name}
          {...(field.kind === "list" ? { rows: 3 } : field.kind === "json" ? { rows: 4 } : {})}
          onCommit={(t) => write(field, t)}
        />
        {help}
      </View>
    );
  };
  return (
    <View style={s.wrap} testID="trigger-form">
      {name ? render(name) : null}
      {trigger.key === "schedule" ? <SchedulePicker trigger={trigger} onChange={onChange} openMenu={openMenu} zone={zone} {...(now !== undefined ? { now } : {})} /> : null}
      {rest.map(render)}
      {note ? <Hint testID="trigger-note">{note}</Hint> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12 },
  group: { gap: 4 },
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { minWidth: 34, height: 28, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "var(--accent-wash)" as string, borderColor: "var(--accent)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
  chipTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  zoneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  zone: { fontSize: 13, color: "var(--ink)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
  preview: { gap: 4, padding: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  previewText: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  adv: { flexDirection: "row", alignItems: "center", gap: 6, height: 26 },
  advText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
