// "Why didn't this run?" for one record (rc.41, prototype vyre-v1.html#automations,at:clear.why). A sheet: the record, the thing that happened to it (the newest, or another the person picks), and
// every Automation that watches that kind of record with what became of it. The one that did not do what was hoped is open, with the checks that passed and the one that stopped it. Every word here
// is the server's (automations.why_not); the sheet draws it. It is one component for the record's menu and for an Automation's own page, and needs nothing of the Automations place around it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Glyph } from "../canvas/icons.tsx";
import { look } from "../screens/look.ts";
import { firstOpen, verdictTone, watchLine } from "./model.ts";
import type { WhyOut, WhyRow } from "./model.ts";

export interface WhySheetProps {
  type: string;
  recordId: string;
  /** The thing that happened to open on; the newest when absent. */
  eventId?: string;
  call(cap: string, input: unknown): Promise<unknown>;
  /** A person or an agent by id, as a name. */
  nameOf(id: string): string;
  whenText(at: number): string;
  onOpenAutomation(automationId: string): void;
  onOpenRun?(runId: string): void;
  /** Try an Automation on this record: offered on the one that did not start, when the opener can do it. */
  onTest?(automationId: string, target: { recordId: string; recordType: string; eventId?: string; name: string }): void;
  onClose(): void;
}

const TONE = { warn: "var(--warn)", ok: "var(--ok)", quiet: "var(--ink-3)" } as const;

function Check({ ok, off, line, detail }: { ok: boolean; off: boolean; line: string; detail?: string }): ReactElement {
  const color = ok ? "var(--ok)" : off ? "var(--ink-3)" : "var(--warn)";
  return (
    <View style={s.check}>
      <View style={[s.mark, { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` as string }]}>
        <Glyph name={ok ? "check" : "x"} size={11} color={color} />
      </View>
      <View style={s.grow}>
        <Text style={ok ? s.passed : s.stopped}>{line}</Text>
        {detail ? <Text style={look.quiet}>{detail}</Text> : null}
      </View>
    </View>
  );
}

export function WhySheet(p: WhySheetProps): ReactElement {
  const [eventId, setEventId] = useState<string | undefined>(p.eventId);
  const [out, setOut] = useState<WhyOut | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const { element, show } = useMenu();
  const call = p.call;
  useEffect(() => {
    let live = true;
    setFailed(null);
    void call("automations.why_not", { type: p.type, recordId: p.recordId, ...(eventId ? { eventId } : {}) }).then(
      (o) => {
        if (!live) return;
        const got = o as WhyOut;
        setOut(got);
        setOpen(firstOpen(got.automations));
      },
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : "This could not be read."),
    );
    return () => {
      live = false;
    };
  }, [call, p.type, p.recordId, eventId]);

  const chosen = out?.changes.find((c) => c.eventId === out.eventId) ?? out?.changes[0];
  const title = out?.record.title ?? "This record";
  return (
    <Dialog title="Why didn’t this run?" onClose={p.onClose} width={520} testID="why-sheet" fill>
      <View style={s.body}>
        <Text style={look.quiet} testID="why-record">
          {[title, out?.record.typeName].filter((x) => x).join(" · ")}
        </Text>
        {failed ? (
          <Text style={look.warn} testID="why-failed">
            {failed}
          </Text>
        ) : null}
        {out && chosen ? (
          <Pressable
            testID="why-change"
            accessibilityRole="button"
            accessibilityLabel="Choose another change"
            onPress={(e) => {
              const r = (
                e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }
              ).currentTarget?.getBoundingClientRect?.();
              show(
                [
                  { head: `What happened to ${title}` },
                  ...out.changes.map((c) => ({
                    label: `${c.line}, ${p.whenText(c.at)}`,
                    checked: c.eventId === chosen.eventId,
                    onSelect: () => setEventId(c.eventId),
                  })),
                ],
                r?.left ?? 120,
                (r?.bottom ?? 160) + 4,
                "other",
              );
            }}
            style={s.change}
          >
            <Text style={s.strong}>{chosen.line}</Text>
            <Text style={[look.quiet, s.grow]} numberOfLines={1}>
              {[p.whenText(chosen.at), chosen.by ? `by ${p.nameOf(chosen.by)}` : ""].filter((x) => x).join(" · ")}
            </Text>
            <Text style={s.chev}>{"⌄"}</Text>
          </Pressable>
        ) : null}
        {out && !chosen ? (
          <Text style={look.body} testID="why-nothing">
            Nothing has happened to this record that an automation listens for.
          </Text>
        ) : null}
        {out && chosen ? (
          <Text style={[look.heading, s.gap]} testID="why-count">
            {watchLine(out.automations.length, out.record.typePlural)}
          </Text>
        ) : null}
        {/* ui-rows-lint: not a list (each Automation opens in place to its checks and its own buttons) */}
        {(out?.automations ?? []).map((a: WhyRow) => {
          const on = open === a.automationId;
          const tone = verdictTone(a.verdict);
          return (
            <View key={a.automationId} style={[s.item, on ? s.itemOpen : null]} testID={`why-row-${a.automationId}`}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: on }}
                testID={`why-toggle-${a.automationId}`}
                onPress={() => setOpen(on ? null : a.automationId)}
                style={s.itemHead}
              >
                <View
                  style={[s.dot, { backgroundColor: (a.status === "on" ? "var(--ok)" : "var(--ink-4)") as string }]}
                />
                <Text style={[s.name, s.grow]} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={[s.verdict, { color: TONE[tone] as string }]}>{a.line}</Text>
                <Text style={s.chev}>{on ? "⌄" : "›"}</Text>
              </Pressable>
              {on ? (
                <View style={s.itemBody}>
                  {/* ui-rows-lint: not a list (what the trigger looked at, in the order it looked) */}
                  {a.checks.map((c, i) => (
                    <Check
                      key={`${i}-${c.line}`}
                      ok={c.ok}
                      off={a.verdict === "off"}
                      line={c.line}
                      {...(c.detail ? { detail: c.detail } : {})}
                    />
                  ))}
                  <View style={s.ways}>
                    <Pressable
                      testID={`why-open-${a.automationId}`}
                      accessibilityRole="button"
                      onPress={() => p.onOpenAutomation(a.automationId)}
                      style={[look.btn, look.outlined]}
                    >
                      <Text style={look.btnText}>Open</Text>
                    </Pressable>
                    {a.runId && p.onOpenRun ? (
                      <Pressable
                        testID={`why-run-${a.automationId}`}
                        accessibilityRole="button"
                        onPress={() => p.onOpenRun!(a.runId!)}
                        style={[look.btn, look.outlined]}
                      >
                        <Text style={look.btnText}>See the run</Text>
                      </Pressable>
                    ) : null}
                    {a.verdict === "not_started" && p.onTest ? (
                      <Pressable
                        testID={`why-test-${a.automationId}`}
                        accessibilityRole="button"
                        onPress={() =>
                          p.onTest!(a.automationId, {
                            recordId: p.recordId,
                            recordType: p.type,
                            ...(out?.eventId ? { eventId: out.eventId } : {}),
                            name: title,
                          })
                        }
                        style={[look.btn, look.outlined]}
                      >
                        <Text style={look.btnText}>{`Test it on ${title}`}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {element}
    </Dialog>
  );
}

const s = StyleSheet.create({
  body: { gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  gap: { marginTop: 14, marginBottom: 2 },
  strong: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  change: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  chev: { fontSize: 16, lineHeight: 18, color: "var(--ink-3)" as string },
  item: { borderRadius: 12 },
  itemOpen: {
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    backgroundColor: "var(--raised)" as string,
    marginVertical: 2,
  },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  verdict: { fontSize: 12.5, fontWeight: "500" },
  itemBody: { paddingLeft: 30, paddingRight: 12, paddingBottom: 12, gap: 2 },
  check: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 4 },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  passed: { fontSize: 13, lineHeight: 20, color: "var(--ink-2)" as string },
  stopped: { fontSize: 13, lineHeight: 20, fontWeight: "500", color: "var(--ink)" as string },
  ways: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginLeft: 28 },
});
