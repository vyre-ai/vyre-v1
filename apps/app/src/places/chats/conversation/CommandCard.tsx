// The Command card (CMD-RESULTS-2026-11-13, kind b): the answer of /usage and /permissions, laid out, anchored above the composer in the composer's own width. It is built from the shared set: Dialog
// (anchor="composer": no veil, no focus trap), Loadable (loading after 300 ms, a plain failure with Retry and Details, an empty answer, the answer), Group (titled blocks with their hairlines) and Row.
// It is not a message, is never stored, and nobody else sees it. It opens at once and reads its own data, so a slow answer shows the quiet mark and a failed one shows Retry.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Dialog } from "../../../../../../ui/src/Dialog/index.tsx";
import { Group } from "../../../../../../ui/src/Group/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Loadable } from "../../../../../../ui/src/States/Loadable.tsx";
import type { Load } from "../../../../../../ui/src/States/Loadable.tsx";
import { Quiet } from "../../../../../../ui/src/States/Quiet.tsx";
import { Tip } from "../../../../../../ui/src/Tip/index.tsx";
import { useWhenText } from "../../../../../../ui/src/Time/index.tsx";
import { COLUMN } from "../../../../../../ui/src/tokens/calm.ts";
import { SILENT_WORDS, WAITING_WORDS, compactCount } from "./command-result.ts";
import type {
  CardSpec,
  Meter as MeterData,
  PermissionsCard,
  UsageAccount,
  UsageCard,
  UseFigures,
} from "./command-result.ts";

type Spec = Exclude<CardSpec, { kind: "aside" }>;

/** A read as the four things Loadable draws. `retry` reads again. */
function useCardLoad<T>(read: () => Promise<T>, again = 0): Load<T> {
  const [round, setRound] = useState(0);
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    // a re-read after a change keeps the answer on screen until the new one arrives
    setLoad((cur) => (cur.state === "ready" ? cur : { state: "loading" }));
    read().then(
      (data) => live && setLoad({ state: "ready", data }),
      (e: unknown) => {
        const x = e as { traceId?: string; code?: string } | null;
        if (live)
          setLoad({
            state: "failed",
            failure: {
              message: "The Space didn't answer.",
              ...(x?.code ? { code: x.code } : {}),
              ...(x?.traceId ? { traceId: x.traceId } : {}),
            },
            retry: () => setRound((n) => n + 1),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [read, round, again]);
  return load;
}

const toneOf = (pct: number): "bad" | "warn" | "ok" => (pct >= 100 ? "bad" : pct >= 80 ? "warn" : "ok");

/** A 6 px bar with the percent as its label. It turns warn at 80 percent and danger at 100, the rule the model menu uses. */
function Meter({ pct, width }: { pct: number; width: number }): ReactElement {
  const tone = toneOf(pct);
  return (
    <View role="img" accessibilityLabel={`${Math.round(pct)} percent`} style={[st.track, { width }]}>
      <View
        style={[
          st.fill,
          { width: `${Math.max(2, Math.min(100, pct))}%` },
          { backgroundColor: tone === "bad" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--accent)" },
        ]}
      />
    </View>
  );
}

function Limit({ label, m }: { label: string; m: MeterData }): ReactElement {
  const when = useWhenText();
  const body = (
    <View style={st.limit}>
      <Text style={st.quiet}>{label}</Text>
      <Meter pct={m.pct} width={84} />
      <Text style={st.pct}>{`${Math.round(m.pct)}%`}</Text>
    </View>
  );
  // the time it starts over is on hover and focus, through the app's own time words
  return m.resetsAt !== undefined ? <Tip help={`Resets ${when(m.resetsAt, Date.now())}`}>{body}</Tip> : body;
}

function Account({ a, open, onToggle }: { a: UsageAccount; open: boolean; onToggle(): void }): ReactElement {
  const l = a.limits;
  const note = !a.usable
    ? `Can't run here. ${a.why ?? ""}`.trim()
    : l.state === "waiting"
      ? WAITING_WORDS
      : l.state === "silent"
        ? SILENT_WORDS
        : undefined;
  const count = a.models.length === 1 ? "1 model" : `${a.models.length} models`;
  const keys =
    Platform.OS === "web"
      ? {
          onKeyDown: (e: { key: string; preventDefault(): void }) => {
            if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
              e.preventDefault();
              onToggle();
            }
          },
        }
      : undefined;
  return (
    <View>
      <Row
        id={`cmd-account-${a.name}`}
        title={a.name}
        {...(note ? { note } : {})}
        {...(a.models.length > 0
          ? {
              trailing: (
                <View style={st.trail}>
                  <Text style={st.quiet}>{count}</Text>
                  <Text style={[st.chev, open ? st.chevOpen : null]}>{"›"}</Text>
                </View>
              ),
              onPress: onToggle,
            }
          : { inert: true })}
        {...(keys ? { domProps: keys } : {})}
      />
      {l.state === "read" && a.usable ? (
        <View style={st.limits}>
          {l.session ? <Limit label="Session" m={l.session} /> : null}
          {l.week ? <Limit label="Week" m={l.week} /> : null}
        </View>
      ) : null}
      {open && a.models.length > 0 ? (
        <View style={st.models} testID="cmd-models">
          {/* ui-rows-lint: not a list (model names laid out as one wrapped line of words) */}
          {a.models.map((m) => (
            <Text key={m} style={[st.model, m === a.current ? st.modelNow : null]}>
              {m}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const Fig = ({ label, u }: { label: string; u: UseFigures }): ReactElement => (
  <View style={st.fig}>
    <Text style={st.quiet}>{label}</Text>
    <Text
      style={st.figTurns}
    >{`${u.count} ${u.count === 1 ? "reply" : "replies"}${u.costMicros > 0 ? `  $${(u.costMicros / 1e6).toFixed(2)}` : ""}`}</Text>
    <View style={st.tri}>
      <Pair k="New" v={compactCount(u.fresh)} />
      <Pair k="Cached" v={compactCount(u.cached)} tip="Reused, so cheaper" />
      <Pair k="Out" v={compactCount(u.out)} />
    </View>
  </View>
);
const Pair = ({ k, v, tip }: { k: string; v: string; tip?: string }): ReactElement => (
  <View style={st.pair}>
    <Tip help={tip}>
      <Text style={[st.pairK, tip ? st.hinted : null]}>{k}</Text>
    </Tip>
    <Text style={st.pairV}>{v}</Text>
  </View>
);

function UsageBody({ c, onSettings }: { c: UsageCard; onSettings(ref?: string): void }): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (i: number): void =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const used = c.chat.context ? (c.chat.context.used / c.chat.context.window) * 100 : 0;
  // the one action: the account that is open, by name, else the page of accounts
  const opened = [...open].map((i) => c.accounts[i]).find((a) => a?.ref !== undefined);
  return (
    <View style={st.body}>
      <Group title="This chat">
        <Row title="Model" inert trailing={<Text style={st.val}>{c.chat.model ?? "The default model"}</Text>} />
        {c.chat.paidBy ? <Row title="Paid by" inert trailing={<Text style={st.val}>{c.chat.paidBy}</Text>} /> : null}
        {c.chat.context ? (
          <Row
            title="Context"
            inert
            trailing={
              <View style={st.trail}>
                <Meter pct={used} width={120} />
                <Text
                  style={st.val}
                >{`${compactCount(c.chat.context.used)} of ${compactCount(c.chat.context.window)}`}</Text>
              </View>
            }
          />
        ) : null}
      </Group>
      <Group title="AI accounts">
        {/* ui-rows-lint: not a list (each account is its own block: a Row with its meters and models under it) */}
        {c.accounts.map((a, i) => (
          <Account key={`${i}:${a.name}`} a={a} open={open.has(i)} onToggle={() => toggle(i)} />
        ))}
      </Group>
      <Group title="Your use">
        <View style={st.figs}>
          <Fig label="Today" u={c.today} />
          <Fig label="This month" u={c.month} />
        </View>
      </Group>
      <View style={st.foot}>
        <Text
          accessibilityRole="link"
          testID="cmd-settings"
          onPress={() => onSettings(opened?.ref)}
          style={st.link}
        >{`${opened ? `${opened.name} in Settings` : "AI accounts in Settings"}  ›`}</Text>
      </View>
    </View>
  );
}

function PermissionRow({ r, onTake }: { r: PermissionsCard["rules"][number]; onTake(): void }): ReactElement {
  const when = useWhenText();
  return (
    <Row
      title={r.text}
      note={r.until !== undefined ? `Allowed until ${when(r.until, Date.now())}` : "Always allowed"}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Take back: ${r.text}`}
          testID={`cmd-take-${r.id}`}
          onPress={onTake}
          style={st.takeBtn}
        >
          <Text style={st.take}>Take back</Text>
        </Pressable>
      }
    />
  );
}

function PermissionsBody({ c, onTake }: { c: PermissionsCard; onTake(id: string): void }): ReactElement {
  return (
    <View style={st.body}>
      <Group>
        {/* ui-rows-lint: not a list (PermissionRow draws a ui/Row) */}
        {c.rules.map((r) => (
          <PermissionRow key={r.id} r={r} onTake={() => onTake(r.id)} />
        ))}
      </Group>
    </View>
  );
}

export interface CommandCardProps {
  spec: Spec;
  onClose(): void;
  /** A press outside the card; the owner leaves the composer out of it. */
  onPressOutside(target: unknown): void;
  /** A line in the title bar's notice slot, with Undo where the act can be undone. */
  notify(text: string, undo?: () => void): void;
  /** Settings, at the account that was pressed (or the page of accounts). */
  onSettings(ref?: string): void;
  /** "Connect an AI". */
  onConnect(): void;
}

/** The card, anchored above the composer: zero height in the layout, floating up over the foot of the transcript, exactly the composer's width. */
export function CommandCard(p: CommandCardProps): ReactElement {
  return (
    <View testID="command-card-anchor" style={st.anchor} pointerEvents="box-none">
      <View style={st.float} pointerEvents="box-none">
        <View style={st.card}>
          {p.spec.kind === "usage" ? <UsageCard_ {...p} spec={p.spec} /> : <PermissionsCard_ {...p} spec={p.spec} />}
        </View>
      </View>
    </View>
  );
}

function UsageCard_({
  spec,
  onClose,
  onPressOutside,
  onSettings,
  onConnect,
}: CommandCardProps & { spec: Extract<Spec, { kind: "usage" }> }): ReactElement {
  const load = useCardLoad(spec.read);
  return (
    <Dialog title="Usage" anchor="composer" testID="command-card" onClose={onClose} onPressOutside={onPressOutside}>
      <Loadable
        load={load}
        what="usage"
        isEmpty={(c) => c.accounts.length === 0}
        empty={{ title: "No AI connected yet", action: { label: "Connect an AI", onPress: onConnect } }}
        loading={
          <View style={st.loading}>
            <Quiet />
          </View>
        }
      >
        {(c) => <UsageBody c={c} onSettings={onSettings} />}
      </Loadable>
    </Dialog>
  );
}

function PermissionsCard_({
  spec,
  onClose,
  onPressOutside,
  notify,
}: CommandCardProps & { spec: Extract<Spec, { kind: "permissions" }> }): ReactElement {
  const [again, setAgain] = useState(0);
  const load = useCardLoad(spec.read, again);
  // one take-back at a time: a second press before the answer is ignored
  const busy = useRef(false);
  const take = (id: string): void => {
    if (busy.current) return;
    busy.current = true;
    void spec
      .takeBack(id)
      .then(
        (n) => {
          notify(n.text, n.undo ? () => void n.undo!().then(() => setAgain((x) => x + 1)) : undefined);
          setAgain((x) => x + 1);
        },
        () => notify("Could not take that back."),
      )
      .finally(() => {
        busy.current = false;
      });
  };
  return (
    <Dialog
      title="Permissions"
      anchor="composer"
      testID="command-card"
      onClose={onClose}
      onPressOutside={onPressOutside}
    >
      <Loadable
        load={load}
        what="permissions"
        isEmpty={(c) => c.rules.length === 0}
        empty={{ title: "Nothing goes without asking" }}
      >
        {(c) => <PermissionsBody c={c} onTake={take} />}
      </Loadable>
    </Dialog>
  );
}

const st = StyleSheet.create({
  anchor: { height: 0, position: "relative", zIndex: 31, overflow: "visible" },
  float: { position: "absolute", left: 0, right: 0, bottom: 6, alignItems: "center", paddingHorizontal: 24 },
  card: { width: "100%", maxWidth: COLUMN },
  body: { paddingBottom: 6, gap: 14 },
  loading: { height: 300, alignItems: "center", justifyContent: "center" },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
  val: { fontSize: 13, color: "var(--ink)" as string },
  trail: { flexDirection: "row", alignItems: "center", gap: 10 },
  chev: { fontSize: 16, color: "var(--ink-4)" as string },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  track: { height: 6, borderRadius: 3, backgroundColor: "var(--sel)" as string, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  limits: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 22,
    paddingHorizontal: 8,
    paddingBottom: 8,
    marginTop: -4,
  },
  limit: { flexDirection: "row", alignItems: "center", gap: 8 },
  pct: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string, minWidth: 30 },
  models: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2, paddingHorizontal: 8, paddingBottom: 10 },
  model: { fontSize: 12.5, color: "var(--ink-3)" as string },
  modelNow: { color: "var(--ink)" as string, fontWeight: "500" },
  figs: { flexDirection: "row", gap: 24, paddingVertical: 6 },
  fig: { flex: 1, gap: 2, minWidth: 0 },
  figTurns: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  tri: { flexDirection: "row", gap: 18, marginTop: 6 },
  pair: { gap: 1 },
  pairK: { fontSize: 11.5, color: "var(--ink-3)" as string },
  hinted: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
  pairV: { fontSize: 13, color: "var(--ink)" as string },
  foot: { paddingBottom: 8 },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
  takeBtn: { height: 28, paddingHorizontal: 10, borderRadius: 8, justifyContent: "center" },
  take: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
