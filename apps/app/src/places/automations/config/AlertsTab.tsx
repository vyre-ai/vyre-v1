// The Alerts tab (spec 3.7, 2.12): who is told when an Automation fails, when, where, and the escalation chain that tells more people if it keeps failing. It opens with the sentence the
// four parts make, so a person can read the whole rule at once. Every change saves as it is made (quiet Saved, Undo). A Personal Automation tells only its owner and has no chain.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { useAutomationsData } from "../canvas/data.tsx";
import { Face, IconButton } from "../canvas/parts.tsx";
import { each } from "../runs/each.ts";
import { useConfigExtras } from "./data.tsx";
import type { DirEntry } from "./data.tsx";
import { Group, Hint, Lab, PickButton, SRow, Switch } from "./parts.tsx";
import { ESCALATE_AFTER_HOURS, FAILURES_IN_A_ROW, MAX_ESCALATION_STEPS, addStep, addWho, alertSentence, hoursWords, nextStepHours, removeStep, removeWho, setStepHours, setStepTo, setWhen, setWhere, subjectKey, whenWords, withoutChannel } from "./model.ts";
import type { Alerts, Automation, Subject } from "./model.ts";
import { useSaved } from "./saved.ts";

type Kind = Subject["kind"];

const subjectTitle = (s: Subject, name: (id: string) => string): string => (s.kind === "role" ? `The ${name(s.id)} role` : s.kind === "group" ? `The ${name(s.id)} group` : name(s.id));

export function AlertsTab({ automation }: { automation: Automation }): ReactElement {
  const data = useAutomationsData();
  const { directory } = useConfigExtras();
  const { element, show } = useMenu();
  const saved = useSaved();
  const a = automation;
  const al = a.alerts;
  const personal = a.kind === "personal";
  const channelName = (id: string): string => directory.channels.find((c) => c.id === id)?.name ?? data.name(id);

  const save = (next: Alerts, text: string): void => {
    void saved.run(text, () => data.call("automations.alerts.set", { automationId: a.id, alerts: next }), () => data.call("automations.alerts.set", { automationId: a.id, alerts: al }));
  };

  const pick = (items: readonly MenuEntry[], x: number, y: number, label: string): void => show(items, x, y, "other", { label });
  const entries = (list: readonly DirEntry[], kind: Kind, on: (s: Subject) => void, skip: (s: Subject) => boolean): MenuEntry[] =>
    each(list.filter((e) => !skip({ kind, id: e.id })), (e) => ({ label: e.name, onSelect: () => on({ kind, id: e.id }) }));
  /** People, then groups, then roles, each under its own heading. */
  const whoMenu = (on: (s: Subject) => void, skip: (s: Subject) => boolean): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const [head, list, kind] of [["People", directory.people, "person"], ["Groups", directory.groups, "group"], ["Roles", directory.roles, "role"]] as const) {
      const rows = entries(list, kind, on, skip);
      if (rows.length === 0) continue;
      if (out.length) out.push({ separator: true });
      out.push({ head }, ...rows);
    }
    return out.length ? out : [{ head: "Nobody to add" }];
  };

  const whoRows = al.who.map((w, i) => (
    <Row
      key={subjectKey(w)} id={`who-${w.id}`} title={data.name(w.id)} note={w.kind === "role" ? "Role" : w.kind === "group" ? "Group" : undefined}
      leading={<View style={t.lead}><Face name={data.name(w.id)} kind={w.kind === "person" ? "person" : "agent"} size={20} /></View>}
      trailing={al.who.length > 1 ? <IconButton icon="x" label={`Stop telling ${data.name(w.id)}`} size={22} testID={`who-remove-${i}`} onPress={() => save(removeWho(al, w), `${data.name(w.id)} will not be told`)} /> : undefined}
    />
  ));

  const hoursMenu = (current: number, on: (h: number) => void): MenuEntry[] => each(ESCALATE_AFTER_HOURS, (h) => ({ label: hoursWords(h), checked: h === current, onSelect: () => on(h) }));

  return (
    <View testID="alerts-tab" accessibilityLabel="Alerts" style={t.body}>
      <Text testID="alert-sentence" style={t.sentence}>{alertSentence(a, data.name, channelName, data.me.id)}</Text>

      <Lab>Who</Lab>
      <Group testID="alert-who">
        {personal ? (
          <SRow label="Only you, it is yours" last minHeight={44}><View style={t.you}><Face name={data.me.name} size={16} /><Text style={t.youText}>You</Text></View></SRow>
        ) : (
          <>
            {whoRows}
            <SRow label="Told when it fails" last minHeight={44}>
              <PickButton label="Add someone" value="Add someone" testID="who-add" onPress={(x, y) => pick(whoMenu((s) => save(addWho(al, s), `${data.name(s.id)} will be told`), (s) => al.who.some((w) => subjectKey(w) === subjectKey(s))), x, y, "Add someone to alerts")} />
            </SRow>
          </>
        )}
      </Group>

      <Lab>When</Lab>
      <Group testID="alert-when">
        <SRow label="Tell them" last={al.when.mode === "every"}>
          <PickButton
            label="When" value={al.when.mode === "every" ? "On every failure" : "After failures in a row"} testID="when-mode"
            onPress={(x, y) => pick([{ label: "On every failure", checked: al.when.mode === "every", onSelect: () => save(setWhen(al, "every"), "Tells on every failure") }, { label: "After failures in a row", checked: al.when.mode === "after_n", onSelect: () => save(setWhen(al, "after_n"), "Tells after failures in a row") }], x, y, "When to tell")}
          />
        </SRow>
        {al.when.mode === "after_n" ? (
          <SRow label="Failures in a row" last>
            <PickButton label="Failures in a row" value={String(al.when.n ?? 2)} testID="when-n" onPress={(x, y) => pick(each(FAILURES_IN_A_ROW, (n) => ({ label: String(n), checked: n === (al.when.n ?? 2), onSelect: () => save(setWhen(al, "after_n", n), `Tells ${whenWords({ mode: "after_n", n })}`) })), x, y, "Failures in a row")} />
          </SRow>
        ) : null}
      </Group>

      <Lab>Where</Lab>
      <Group testID="alert-where">
        <SRow label="Needs you" sub="Opens at the failed step" minHeight={42}>
          <Switch on={al.where.needsYou} label="Needs you" testID="where-needs" onChange={(v) => save(setWhere(al, { needsYou: v }), v ? "Tells in Needs you" : "Does not tell in Needs you")} />
        </SRow>
        <SRow label="A direct message" minHeight={42}>
          <Switch on={al.where.dm} label="A direct message" testID="where-dm" onChange={(v) => save(setWhere(al, { dm: v }), v ? "Tells by direct message" : "Does not send a direct message")} />
        </SRow>
        <SRow label="A channel" minHeight={42} last={al.where.channelId === undefined}>
          <Switch
            on={al.where.channelId !== undefined} label="A channel" testID="where-channel"
            onChange={(v) => { const first = directory.channels[0]; if (v && first) save(setWhere(al, { channelId: first.id }), `Tells in ${first.name}`); else if (!v) save(withoutChannel(al), "Does not tell in a channel"); }}
          />
        </SRow>
        {al.where.channelId !== undefined ? (
          <SRow label="Which channel" minHeight={42} last>
            <PickButton
              label="Which channel" value={channelName(al.where.channelId)} testID="where-channel-pick"
              onPress={(x, y) => pick(each(directory.channels, (c) => ({ label: c.name, checked: c.id === al.where.channelId, onSelect: () => save(setWhere(al, { channelId: c.id }), `Tells in ${c.name}`) })), x, y, "Which channel")}
            />
          </SRow>
        ) : null}
      </Group>

      {personal ? null : (
        <>
          <Lab>If it keeps failing</Lab>
          <Group testID="alert-chain">
            {al.escalation.map((step, i) => (
              <Row
                key={`${i}-${subjectKey(step.to)}`} id={`step-${i}`} title={subjectTitle(step.to, data.name)} note={`After ${hoursWords(step.afterHours)}`}
                leading={<View style={t.lead}><Face name={data.name(step.to.id)} kind={step.to.kind === "person" ? "person" : "agent"} size={20} /></View>}
                trailing={<View style={t.stepTr}>
                  <PickButton label={`When and who for step ${i + 1}`} value={hoursWords(step.afterHours)} testID={`step-hours-${i}`} onPress={(x, y) => pick([{ head: "After" }, ...hoursMenu(step.afterHours, (h) => save(setStepHours(al, i, h), `Escalates after ${hoursWords(h)}`)), { separator: true }, { head: "Tell" }, ...whoMenu((w) => save(setStepTo(al, i, w), `${data.name(w.id)} is told after ${hoursWords(step.afterHours)}`), () => false)], x, y, "When and who")} />
                  <IconButton icon="x" label={`Remove step ${i + 1}`} size={22} testID={`step-remove-${i}`} onPress={() => save(removeStep(al, i), "Removed the step")} />
                </View>}
              />
            ))}
            <SRow label={al.escalation.length ? "Add another step" : "Nobody else is told yet"} last minHeight={44}>
              {al.escalation.length < MAX_ESCALATION_STEPS ? (
                <PickButton label="Add a step" value="Add a step" testID="step-add" onPress={(x, y) => pick(whoMenu((s) => save(addStep(al, s, nextStepHours(al)), `${data.name(s.id)} is told after ${hoursWords(nextStepHours(al))}`), () => false), x, y, "Who is told next")} />
              ) : <Text style={t.dim}>{`Up to ${MAX_ESCALATION_STEPS} steps`}</Text>}
            </SRow>
          </Group>
          <Hint>Each step tells one more person or role if the failure is still open after the time shown.</Hint>
        </>
      )}

      {saved.note ? (
        <View testID="saved-note" accessibilityLiveRegion="polite" style={t.saved}>
          <Text style={[t.savedText, saved.note.failed && { color: "var(--danger)" as string }]}>{saved.note.text}</Text>
          {saved.note.undo ? <Text accessibilityRole="button" testID="saved-undo" onPress={saved.note.undo} style={t.undo}>Undo</Text> : null}
        </View>
      ) : null}
      {element}
    </View>
  );
}

const t = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  sentence: { fontSize: 13, lineHeight: 19, color: "var(--ink)" as string, marginTop: 6 },
  lead: { flexDirection: "row", alignItems: "center", marginRight: 8 },
  stepTr: { flexDirection: "row", alignItems: "center", gap: 4 },
  you: { flexDirection: "row", alignItems: "center", gap: 6 },
  youText: { fontSize: 13, color: "var(--ink-2)" as string },
  dim: { fontSize: 12, color: "var(--ink-3)" as string },
  saved: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  savedText: { fontSize: 12, color: "var(--ink-2)" as string },
  undo: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
});
