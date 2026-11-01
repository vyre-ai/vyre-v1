// Records > Sync page of a synced type (spec 2.10): the app it comes from, how far it has got, the last pass, what waits and what failed, and the five things a person does: Pause or Resume,
// Resync, bring in everything (when a first-pull filter still holds), Edit mapping (the assistant opens with the spec) and Remove (keep the records as plain records, or remove them).
// Few words: the numbers carry the page and every explanation is a tooltip.
import { useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Tip } from "../../../../../../ui/src/Tip/index.tsx";
import { usePolled } from "./data.ts";
import type { Call } from "./data.ts";
import { DELETE_WORDS, PAGE_STATE, agoShort, pageState, progressOf, recordsLine, untilShort } from "./model.ts";
import type { OutboxItem, TypeStatus } from "./model.ts";
import { SyncDot, SyncLogo } from "./parts.tsx";

export interface SyncPageNav {
  /** The records of this type, in the table. */
  openRecords(type: string): void;
  /** Edit mapping: the assistant opens with the spec the type was made from. */
  editMapping(a: { app: string; type: string }): void;
  /** After Remove: the type is gone or plain, so the page goes back to Records. */
  closed(): void;
}
export interface SyncPageProps { type: string; call: Call; nav: SyncPageNav; now?: () => number; /** Only a person who manages connections gets the buttons; anyone else reads the page. Default true. */ canManage?: boolean; /** The title of the record type, for the header. */ title?: string }

let keys = 0;
const key = (cap: string, type: string): string => `${cap}:${type}:${Date.now()}:${++keys}`;

function Btn({ label, onPress, danger = false, primary = false, disabled = false, why, testID }: { label: string; onPress: () => void; danger?: boolean; primary?: boolean; disabled?: boolean; why?: string; testID?: string }): ReactElement {
  return (
    <Tip help={disabled ? why : undefined}>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress}
        style={({ hovered }: { hovered?: boolean }) => [s.btn, primary ? s.btnPrimary : null, hovered === true && !primary ? s.btnOver : null, disabled ? { opacity: 0.45 } : null]}
      >
        <Text style={[s.btnText, primary ? s.btnTextPrimary : null, danger ? { color: "var(--danger)" as string } : null]}>{label}</Text>
      </Pressable>
    </Tip>
  );
}

function Stat({ label, value, tip, bad = false, testID }: { label: string; value: string; tip?: string; bad?: boolean; testID?: string }): ReactElement {
  return (
    <Tip help={tip}>
      <View style={s.stat} testID={testID}>
        <Text style={[s.statValue, bad ? { color: "var(--danger)" as string } : null]}>{value}</Text>
        <Text style={s.statLabel}>{label}</Text>
      </View>
    </Tip>
  );
}

export function SyncPage({ type, call, nav, now = Date.now, title, canManage = true }: SyncPageProps): ReactElement {
  const status = usePolled(async () => (await call("sync_types.status", { type })) as TypeStatus, `status:${type}`, 6000);
  const outbox = usePolled(async () => {
    const [failed, pending, sent] = await Promise.all([call("connectors.outbox.list", { type, state: "failed", limit: 5 }), call("connectors.outbox.list", { type, state: "pending", limit: 5 }), call("connectors.outbox.list", { type, state: "sent", limit: 3 })]);
    const items = (r: unknown): OutboxItem[] => (r as { items?: OutboxItem[] }).items ?? [];
    return { open: [...items(failed), ...items(pending)], sent: items(sent) };
  }, `waiting:${type}`, 6000);
  const waiting = { value: outbox.value?.open, refresh: outbox.refresh };
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = status.value;
  const act = async (cap: string, input: Record<string, unknown>, ok: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try { await call(cap, { ...input, idempotencyKey: key(cap, type) }); setFlash({ text: ok }); } catch (e) { setFlash({ text: (e as { error?: { message?: string } })?.error?.message ?? "That did not work. Try again.", bad: true }); } finally { setBusy(false); status.refresh(); waiting.refresh(); }
  };

  if (!st) return <View style={s.page} testID="sync-page-loading" accessibilityLabel="Loading"><View style={s.head}><Text accessibilityRole="header" style={s.h1}>{title ?? "Sync"}</Text></View></View>;
  const dot = pageState(st);
  const progress = progressOf(st.records, st.estimate);
  const t = now();
  const row = { state: st.paused ? ("paused" as const) : st.state, pending: st.pending, conflicts: st.conflicts, schemaChanges: st.schemaChanges };
  const remove = async (records: "keep" | "remove"): Promise<void> => {
    setRemoving(false);
    setBusy(true);
    try { await call("sync_specs.remove", { type, records }); nav.closed(); } catch (e) { setFlash({ text: (e as { error?: { message?: string } })?.error?.message ?? "Could not remove it. Try again.", bad: true }); setBusy(false); }
  };

  return (
    <View style={s.page} testID="sync-page" accessibilityLabel={`Sync with ${st.app.title}`}>
      <ScrollView contentContainerStyle={s.in}>
        <View style={s.head}>
          <SyncLogo app={st.app} connector={st.app.key} size={28} />
          <View style={s.headText}>
            <Text accessibilityRole="header" aria-level={1} style={s.h1} numberOfLines={1}>{title ?? st.type}</Text>
            <Text style={s.sub} numberOfLines={1}>{`Synced from ${st.app.title}`}</Text>
          </View>
          <View style={s.pill} testID="sync-state">
            <SyncDot row={row} app={st.app.title} />
            <Text style={s.pillText}>{PAGE_STATE[dot]}</Text>
          </View>
        </View>

        {flash ? <View style={[s.flash, flash.bad ? s.flashBad : null]} accessibilityRole="alert" testID="sync-flash"><Text style={s.flashText}>{flash.text}</Text><Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setFlash(null)}><Text style={s.flashX}>x</Text></Pressable></View> : null}

        <View style={s.card} testID="sync-records">
          <View style={s.cardTop}>
            <Text style={s.big} testID="sync-records-line">{recordsLine(st.records, st.estimate)}</Text>
            <Pressable accessibilityRole="link" accessibilityLabel="Open the records" testID="sync-open-records" onPress={() => nav.openRecords(type)}><Text style={s.link}>Open</Text></Pressable>
          </View>
          {st.catchingUp ? <Text style={s.sub} testID="sync-catching-up">Catching up. Newest records come first; more arrive every minute.</Text> : null}
          {progress !== null ? <View style={s.bar} testID="sync-progress" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}><View style={[s.barFill, { width: `${Math.round(progress * 100)}%` as unknown as number }]} /></View> : null}
          {st.canBackfill && st.filter ? (
            <View style={s.filterRow} testID="sync-filter">
              <Text style={s.filterText} numberOfLines={2}>{`Started with: ${st.filter}`}</Text>
              <Btn label="Bring in everything" onPress={() => void act("sync_specs.backfill", { type }, "Bringing in everything. It continues in the background.")} testID="sync-backfill" disabled={busy || st.paused} why="Resume the sync first" />
            </View>
          ) : null}
        </View>

        <View style={s.stats}>
          <Stat label="Last pass" value={st.lastRun ? agoShort(st.lastRun.at, t) : "none"} tip={st.lastRun?.summary ?? "No pass has finished yet"} testID="sync-stat-last" />
          <Stat label="Next check" value={st.paused ? "paused" : st.nextPollAt ? untilShort(st.nextPollAt, t) : "soon"} tip={`The app is checked about every ${Math.round(st.polling.idleSec / 60)} min, sooner while changes wait`} testID="sync-stat-next" />
          <Stat label="Waiting" value={String(st.pending)} tip="Changes made here that are on their way to the app" testID="sync-stat-waiting" />
          <Stat label="Failed" value={String(st.failedPushes)} bad={st.failedPushes > 0} tip="Changes that could not be sent after several tries" testID="sync-stat-failed" />
          <Stat label="To decide" value={String(st.conflicts + st.schemaChanges)} bad={st.conflicts + st.schemaChanges > 0} tip="Changes both sides made that the rule could not settle, and field changes in the app" testID="sync-stat-decide" />
          <Stat label="Sent today" value={String(st.sentToday)} testID="sync-stat-sent" />
        </View>

        <Tip help="A delete here is a decision. It is off for the app unless turned on for this record type.">
          <Text style={s.note} testID="sync-deletes">{DELETE_WORDS[st.deletes]}</Text>
        </Tip>

        {st.failures.length > 0 ? (
          <View style={s.section} testID="sync-failures">
            <Text style={s.secHead}>Failures</Text>
            {st.failures.map((f, i) => <Row key={`${f.at}:${i}`} id={`fail:${i}`} title={f.summary} note={`${agoShort(f.at, t)} ago`} />)}
          </View>
        ) : null}

        {(waiting.value ?? []).length > 0 ? (
          <View style={s.section} testID="sync-outbox">
            <Text style={s.secHead}>On their way</Text>
            {(waiting.value ?? []).map((o) => (
              <Row
                key={o.outboxId} id={`out:${o.outboxId}`} title={`${o.op === "create" ? "New record" : o.op === "delete" ? "Delete" : o.fields.join(", ")}`}
                note={o.state === "failed" ? (o.error ?? "Could not be sent") : "Waiting to be sent"}
                trailing={o.state === "failed" ? <View style={s.rowBtns}><Btn label="Retry" testID={`sync-retry-${o.outboxId}`} onPress={() => void act("connectors.outbox.retry", { outboxId: o.outboxId }, "Trying again.")} /><Btn label="Cancel" onPress={() => void act("connectors.outbox.cancel", { outboxId: o.outboxId }, "Cancelled. The change stays here.")} /></View> : null}
              />
            ))}
          </View>
        ) : null}

        {(outbox.value?.sent ?? []).length > 0 ? (
          <View style={s.section} testID="sync-sent">
            <Text style={s.secHead}>Sent</Text>
            {(outbox.value?.sent ?? []).map((o) => (
              <Row
                key={o.outboxId} id={`sent:${o.outboxId}`} title={o.op === "create" ? "New record" : o.op === "delete" ? "Delete" : o.fields.join(", ")} note={`${agoShort(o.at, t)} ago`}
                trailing={<Btn label="Undo" testID={`sync-undo-${o.outboxId}`} onPress={() => void act("sync_types.undo_push", { outboxId: o.outboxId }, "Put back in the app.")} />}
              />
            ))}
          </View>
        ) : null}

        {canManage ? <View style={s.actions} testID="sync-actions">
          {st.paused
            ? <Btn label="Resume" primary testID="sync-resume" onPress={() => void act("sync_types.resume", { type }, "Resumed.")} disabled={busy} />
            : <Btn label="Pause" testID="sync-pause" onPress={() => void act("sync_types.pause", { type }, "Paused. Nothing moves until you resume.")} disabled={busy} />}
          <Btn label="Resync" testID="sync-resync" onPress={() => void act("connectors.sync_now", { type, mode: "reconcile" }, "Checking everything again.")} disabled={busy || st.paused} why="Resume the sync first" />
          <Btn label="Edit mapping" testID="sync-edit" onPress={() => nav.editMapping({ app: st.app.title, type })} disabled={!st.spec} why="This type was not made from a sync spec" />
          <View style={{ flex: 1 }} />
          <Btn label="Remove" danger testID="sync-remove" onPress={() => setRemoving(true)} disabled={busy} />
        </View> : null}
      </ScrollView>
      {removing ? (
        <Dialog
          title={`Remove ${st.app.title} from Records?`} onClose={() => setRemoving(false)} testID="sync-remove-dialog"
          actions={[
            { label: "Cancel", onPress: () => setRemoving(false) },
            { label: "Remove records", danger: true, onPress: () => void remove("remove"), testID: "sync-remove-all" },
            { label: "Keep records", primary: true, onPress: () => void remove("keep"), testID: "sync-remove-keep" },
          ]}
        >
          <Text style={s.dialogText}>Syncing stops either way and nothing changes in {st.app.title}. Keep the records and they stay here as ordinary records. Remove them and a copy waits in Trash for 30 days.</Text>
        </Dialog>
      ) : null}
    </View>
  );
}

const web = Platform.OS === "web";
const s = StyleSheet.create({
  page: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  in: { padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  h1: { margin: 0, fontSize: 18, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string, marginTop: 2 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: "var(--sunk)" as string },
  pillText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  big: { fontSize: 26, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  link: { fontSize: 13, color: "var(--accent)" as string },
  bar: { height: 6, borderRadius: 3, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  filterText: { flexGrow: 1, flexBasis: 220, fontSize: 12.5, color: "var(--ink-3)" as string },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { minWidth: 104, flexGrow: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  statValue: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 11.5, color: "var(--ink-3)" as string, marginTop: 2 },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string },
  section: { gap: 2 },
  secHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginBottom: 4 },
  rowBtns: { flexDirection: "row", gap: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", ...(web ? ({ cursor: "pointer" } as object) : {}) },
  btnPrimary: { backgroundColor: "var(--accent)" as string, borderColor: "transparent" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--accent-ink, #fff)" as string, fontWeight: "600" },
  flash: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, backgroundColor: "var(--accent-wash)" as string },
  flashBad: { backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--danger)" as string },
  flashText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  flashX: { fontSize: 13, color: "var(--ink-3)" as string, paddingHorizontal: 6 },
  dialogText: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
});
