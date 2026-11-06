// The status cards of a chat (owner, 6 Nov 2026, prototype t-session): a result ("Merged #893 into main", a summary, View the change), a progress ("Release rc.22.1, Step 3 of 3", its steps with states, Watch and Stop)
// and a status (what happened, one fix button, a "..." menu). Each is one block (result_card, progress_card, status_card) drawn with the one card library; an agent or the server posts the block, nobody posts a line of words beside it.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, CardActions, CardBody, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import type { CardActionSpec } from "../../../../../../ui/src/Card/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Glyph } from "./parts.tsx";

export const STATUS_CARD_TYPES = ["result_card", "progress_card", "status_card"] as const;
export const isStatusCard = (type: string): boolean => (STATUS_CARD_TYPES as readonly string[]).includes(type);

export interface CardAct { key: string; label: string; cap?: string; input?: Record<string, unknown> }
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The actions a card carries, read defensively. */
export function actsOf(v: unknown): CardAct[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a): CardAct[] => { const d = rec(a); const key = str(d["key"]), label = str(d["label"]); return key && label ? [{ key, label, ...(str(d["cap"]) ? { cap: str(d["cap"]) } : {}), ...(d["input"] && typeof d["input"] === "object" ? { input: rec(d["input"]) } : {}) }] : []; });
}

export interface StatusCardHost {
  /** Runs an action: the card's capability as the person, or reports its key to the host. */
  run(act: CardAct): void | Promise<unknown>;
  /** Shown with the time of the message, right of the title. */
  time?: string | undefined;
}

export function StatusCard({ id, type, data, host }: { id: string; type: string; data: unknown; host: StatusCardHost }): ReactElement | null {
  const d = rec(data);
  const title = str(d["title"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  if (title === "") return null;
  const go = (a: CardAct): void => {
    setBusy(a.key); setErr(null);
    void Promise.resolve(host.run(a)).catch(() => setErr("That did not work. Try again.")).finally(() => setBusy(null));
  };
  const spec = (a: CardAct): CardActionSpec => ({ label: a.label, testID: `card-${id}-${a.key}`, onPress: () => go(a) });
  const meta = host.time ? <Text style={st.time}>{host.time}</Text> : undefined;
  if (type === "result_card") {
    const acts = actsOf(d["actions"]);
    const [first, ...rest] = acts;
    return (
      <Card kind="result" tone="ok" testID={`status-card-${id}`} label={title}>
        <CardHead lead={<Glyph name="check" size={14} color="var(--ok)" />} title={title} tone="ok" trailing={meta} />
        {str(d["body"]) !== "" ? <CardBody bare><Text style={st.body}>{str(d["body"])}</Text></CardBody> : null}
        {first ? <CardActions primary={spec(first)} secondary={rest.map(spec)} busy={busy !== null} error={err} /> : null}
      </Card>
    );
  }
  if (type === "progress_card") {
    const steps = Array.isArray(d["steps"]) ? (d["steps"] as unknown[]).map(rec) : [];
    const acts = actsOf(d["actions"]);
    const stop = acts.find((a) => a.key === "stop");
    const others = acts.filter((a) => a.key !== "stop");
    return (
      <Card kind="progress" testID={`status-card-${id}`} label={`${title}. ${str(d["step"])}`}>
        <CardHead lead={<Glyph name="spark" size={14} color="var(--ink-3)" />} title={title} trailing={str(d["step"]) !== "" ? <Text style={st.time}>{str(d["step"])}</Text> : meta} />
        <CardBody bare>
          {/* ui-rows-lint: not a list (the steps of one progress card: a state mark and a label, nothing to press) */}
          {steps.map((x, i) => (
            <View key={i} testID={`card-${id}-step-${i}`} style={st.step}>
              <View style={[st.mark, x["state"] === "done" && st.markDone, x["state"] === "running" && st.markRun]} />
              <Text style={[st.stepText, x["state"] === "todo" && st.todo]}>{str(x["label"])}</Text>
            </View>
          ))}
        </CardBody>
        {acts.length > 0 ? <CardActions secondary={others.map(spec)} busy={busy !== null} error={err} note={stop ? <Pressable accessibilityRole="button" testID={`card-${id}-stop`} onPress={() => go(stop)}><Text style={st.stop}>{stop.label}</Text></Pressable> : undefined} /> : null}
      </Card>
    );
  }
  // status
  const tone = d["tone"] === "error" ? "error" : d["tone"] === "info" ? "info" : "warn";
  const fix = actsOf([d["fix"]])[0];
  const more = actsOf(d["more"]);
  return (
    <Card kind="status" tone={tone} testID={`status-card-${id}`} label={title}>
      <CardHead lead={<Glyph name="alert" size={14} color={tone === "error" ? "var(--danger)" : "var(--warn)"} />} title={title} tone={tone} trailing={meta} />
      {str(d["body"]) !== "" ? <CardBody bare><Text style={st.body}>{str(d["body"])}</Text></CardBody> : null}
      {fix || more.length > 0 ? (
        <CardActions
          {...(fix ? { primary: spec(fix) } : {})} busy={busy !== null} error={err}
          note={more.length > 0 ? (
            <View>
              <Pressable accessibilityRole="button" accessibilityLabel="More" testID={`card-${id}-more`} onPress={() => setMenu((o) => !o)}><Text style={st.dots}>···</Text></Pressable>
              {menu ? <View testID={`card-${id}-menu`} style={st.menu}>{more.map((a) => <Row key={a.key} id={`card-${id}-${a.key}`} title={a.label} onPress={() => { setMenu(false); go(a); }} />)}</View> : null}
            </View>
          ) : undefined}
        />
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  time: { fontSize: 12, color: "var(--ink-3)" as string },
  body: { fontSize: 14, lineHeight: 21, color: "var(--ink-2)" as string },
  step: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  mark: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: "var(--ink-4)" as string },
  markDone: { backgroundColor: "var(--ink-3)" as string, borderColor: "var(--ink-3)" as string },
  markRun: { borderColor: "var(--accent)" as string },
  stepText: { fontSize: 14, color: "var(--ink)" as string },
  todo: { color: "var(--ink-3)" as string },
  stop: { fontSize: 14, color: "var(--danger)" as string },
  dots: { fontSize: 16, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
  menu: { gap: 2, paddingVertical: 4 },
  menuItem: { fontSize: 13, color: "var(--ink-2)" as string, paddingVertical: 4, paddingHorizontal: 8 },
});
