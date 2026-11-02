// The onboarding screen, as the owner approved it in the v1 prototype: a step rail with an icon per step, one short line from the Assistant, one framed card that is the thing to do,
// and a preview that is a Space filling in (a ring, a tile per step). Icons and motion do the talking; there are no paragraphs. It serves a Personal Space, a Team Space owner and a member, with
// the scripted Assistant (no AI yet) or the live one, on the Mac, Windows, web and phone (journey table D): the phone is one column with a progress bar and the card in a bottom sheet.
// Every step can be skipped; Finish later leaves, and the Home checklist reopens it. Colours are skin tokens, so light and dark both work.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { Mark } from "../join/kit.tsx";
import { injectCss } from "../../../../ui/src/theme/css.ts";
import type { CardKind, FlowKind, Progress, StepDef, StepState } from "./flow.ts";
import { countsOn, detectDevice, nextOn, resumeOn, stateOn, visibleSteps } from "./device.ts";
import type { Device } from "./device.ts";
import { LOCK, saidFor } from "./said.ts";
import { scriptFor } from "./script.ts";
import { importedNote, rememberedImported } from "./sessions-model.ts";
import { Glyph, StepTile } from "./StepGlyph.tsx";
import { stepLook } from "./stepStyle.ts";

export interface ChatLine { id: string; from: "assistant" | "you"; text: string }
export interface CardContext {
  step: StepDef; flow: FlowKind; done(): void; later(): void; device: Device;
  /** a card that saves on Continue hands over its save (true = saved, move on) while it has something to save; null takes it back */
  gate(save: (() => Promise<boolean>) | null): void;
}

export interface OnboardingScreenProps {
  flow: FlowKind;
  spaceName: string;
  progress: Progress;
  /** the step on show; defaults to where the person left off */
  stepKey?: string | null;
  /** an AI account is connected, so the Assistant is live and `lines` come from the chat */
  live?: boolean;
  /** the live Assistant's lines for this step; ignored while the scripted words are used */
  lines?: readonly ChatLine[];
  /** the live conversation, shown under the card once an AI account is connected */
  liveChat?: ReactNode;
  /** the device this runs on; found from the page when not given */
  device?: Device;
  onStep(key: string, state: StepState): void;
  onOpenStep?(key: string): void;
  onClose?(): void;
  /** The summary links to Chats when sessions were imported. */
  onOpenChats?(): void;
  /** the real card for a step; the default is a quiet placeholder so the screen renders without any backend */
  renderCard?(card: CardKind, ctx: CardContext): ReactNode;
  /** the right pane for a step; defaults to the scripted description */
  renderPreview?(card: CardKind, ctx: CardContext): ReactNode;
}

const BREAK = 900;
const COLUMN = 640;
const web = Platform.OS === "web";

// the one motion of the entry screens: a soft fade between steps. Rules go through the sheet, so a page that drops injected style text still gets them.
function ensureCss(): void {
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-onboard-motion",
    "@keyframes vyre-ob-in{from{opacity:0}to{opacity:1}}"
    + "[data-vyre-ob]{animation:vyre-ob-in 140ms ease both}"
    + "@media (prefers-reduced-motion: reduce){[data-vyre-ob]{animation:none!important;transition:none!important}}");
}
const fade = web ? { dataSet: { vyreOb: "1" } } : {};

/** The last step of the flow on this device: skipping it ends the walk, even when an earlier step was put off. */
const isLast0 = (flow: FlowKind, key: string, device: Device): boolean => { const st = visibleSteps(flow, device); return st[st.length - 1]?.key === key; };

/** "Set up N of M" counts a step as handled when it is done or skipped, so the number matches the rail. */
const counted = (flow: FlowKind, progress: Progress, device: Device): { done: number; later: number; total: number } => { const c = countsOn(flow, progress, device); return { ...c, done: c.done + c.later }; };

function ProgressBar({ done, total }: { done: number; total: number }): ReactElement {
  return <View style={s.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}><View style={[s.barFill, { width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` as `${number}%` }]} /></View>;
}

/** The segmented bar on a narrow screen: one segment per step, green when done, the step on show in its colour. */
function Segs({ steps, progress, current, device }: { steps: readonly StepDef[]; progress: Progress; current: string | null; device: Device }): ReactElement {
  const segs: ReactElement[] = [];
  for (const st of steps) {
    const state = stateOn(progress, st, device);
    segs.push(<View key={st.key} style={[s.seg, state === "done" && s.segDone, state === "later" && s.segLater, st.key === current && s.segOn]} />);
  }
  return <View style={s.segs}>{segs}</View>;
}

function Rail({ flow, steps, progress, current, device, onOpen }: { flow: FlowKind; steps: readonly StepDef[]; progress: Progress; current: string | null; device: Device; onOpen(key: string): void }): ReactElement {
  const c = counted(flow, progress, device);
  const rows: ReactElement[] = [];
  for (const st of steps) {
    const state = stateOn(progress, st, device);
    const on = st.key === current;
    const sub = state === "later" ? "Skipped" : on ? st.line : "";
    rows.push(
      <Pressable
        key={st.key} testID={`row-step-${st.key}`} accessibilityRole="button" accessibilityLabel={`${st.title}${state === "done" ? ", done" : state === "later" ? ", skipped" : ""}`} accessibilityState={{ selected: on }}
        onPress={() => onOpen(st.key)} style={({ hovered }: { hovered?: boolean }) => [s.step, on && s.stepOn, hovered === true && !on && s.stepOver]}
      >
        <View testID={`mark-${state}`}>
          <StepTile flow={flow} k={st.key} size={24} state={state === "done" ? "done" : on ? "open" : "dim"} />
        </View>
        <View style={s.stepText}>
          <Text style={[s.stepTitle, !on && state !== "done" && s.stepTitleQuiet, on && s.stepTitleOn]}>{st.title}</Text>
          {sub ? <Text style={s.stepSub}>{sub}</Text> : null}
        </View>
      </Pressable>,
    );
  }
  return (
    <View testID="onboarding-rail" style={s.rail}>
      <View style={s.railHeadRow}>
        <Mark size={28} />
        <Text style={s.railHead} accessibilityRole="header">{`Set up  ${c.done} of ${c.total}`}</Text>
      </View>
      <ProgressBar done={c.done} total={c.total} />
      <View style={s.steps}>{rows}</View>
    </View>
  );
}

/** The Assistant's line: its face, then one short sentence. */
function Said({ lines }: { lines: readonly ChatLine[] }): ReactElement {
  const out: ReactElement[] = [];
  for (const l of lines) out.push(<View key={l.id} testID={`line-${l.id}`} style={s.sayRow}><Text style={s.saidText}>{l.text}</Text></View>);
  return (
    <View testID="assistant-said" style={s.group}>
      <Avatar name="Assistant" kind="agent" size={28} />
      <View style={s.groupText}>{out}</View>
    </View>
  );
}

/** The Space filling in: a ring around the app icon, a tile per step that turns to a check as it is done, then what the step on show does. */
function Preview({ flow, steps, progress, current, device, spaceName, body, onOpen }: { flow: FlowKind; steps: readonly StepDef[]; progress: Progress; current: string | null; device: Device; spaceName: string; body: ReactNode; onOpen(key: string): void }): ReactElement {
  const c = counted(flow, progress, device), R = 46, C = 2 * Math.PI * R, off = C * (1 - (c.total === 0 ? 0 : c.done / c.total));
  const tiles: ReactElement[] = [];
  for (const st of steps) {
    const state = stateOn(progress, st, device), on = st.key === current;
    tiles.push(
      <Pressable key={st.key} accessibilityRole="button" accessibilityLabel={st.title} onPress={() => onOpen(st.key)} style={[s.tile, on && s.tileOn, state === "later" && s.tileLater]}>
        <StepTile flow={flow} k={st.key} size={40} state={state === "done" ? "done" : on ? "open" : "dim"} />
      </Pressable>,
    );
  }
  const ring = web ? createElement("svg", { viewBox: "0 0 108 108", width: 108, height: 108, style: { position: "absolute", left: 0, top: 0 } },
    createElement("circle", { cx: 54, cy: 54, r: R, fill: "none", stroke: "var(--line-2)", strokeWidth: 4 }),
    createElement("circle", { cx: 54, cy: 54, r: R, fill: "none", stroke: "var(--accent)", strokeWidth: 4, strokeLinecap: "round", strokeDasharray: C, strokeDashoffset: off, transform: "rotate(-90 54 54)", style: { transition: "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)" } })) : null;
  return (
    <ScrollView testID="onboarding-preview" style={s.preview} contentContainerStyle={s.previewIn}>
      <View style={s.hero}>
        <View style={s.ringBox}>{ring}<Mark size={56} /></View>
        <Text style={s.heroName}>{spaceName}</Text>
        <View style={s.tiles}>{tiles}</View>
      </View>
      {body ? <View style={s.pCard}>{body}</View> : null}
    </ScrollView>
  );
}

/** The summary: every step as a compact row, a Set up on the ones left, and Go to Home always in view. */
function Finished({ flow, steps, progress, device, onOpen, onHome, onChats, two }: { flow: FlowKind; steps: readonly StepDef[]; progress: Progress; device: Device; onOpen(key: string): void; onHome?: () => void; onChats?: () => void; two: boolean }): ReactElement {
  const left = steps.filter((st) => stateOn(progress, st, device) !== "done").length;
  const rows: ReactElement[] = [];
  steps.forEach((st) => {
    const state = stateOn(progress, st, device);
    rows.push(
      <View key={st.key} testID={`done-row-${st.key}`} style={[s.gr, two && s.grHalf, state === "later" && s.grLater]}>
        <StepTile flow={flow} k={st.key} size={36} state={state === "done" ? "done" : state === "later" ? "dim" : "dim"} />
        <View style={s.stepText}><Text style={s.grTitle} numberOfLines={1}>{st.title}</Text>{state === "later" ? <Text style={s.stepSub}>Skipped</Text> : null}{st.card === "import_sessions" && state === "done" && rememberedImported() > 0 ? <Text testID="done-imported" style={s.stepSub}>{importedNote(rememberedImported())}</Text> : null}</View>
        {st.card === "import_sessions" && state === "done" && rememberedImported() > 0 && onChats ? <Pressable testID="done-open-chats" accessibilityRole="link" onPress={onChats} style={s.setUp}><Text style={s.setUpText}>Open Chats</Text></Pressable> : null}
        {state !== "done" ? <Pressable testID={`done-set-${st.key}`} accessibilityRole="button" onPress={() => onOpen(st.key)} style={s.setUp}><Text style={s.setUpText}>Set up</Text></Pressable> : null}
      </View>,
    );
  });
  return (
    <View testID="onboarding-finished" style={s.endWrap}>
      <ScrollView style={s.flex} contentContainerStyle={s.endIn}>
        <Mark size={40} />
        <Text style={s.endTitle} accessibilityRole="header">You are set up</Text>
        <Text style={s.endLead}>{left > 0 ? `${left} left for later` : "All done"}</Text>
        <View style={s.grid}>{rows}</View>
      </ScrollView>
      <View style={s.endFoot}>{onHome ? <Pressable testID="onboarding-close" accessibilityRole="button" onPress={onHome} style={s.primaryLg}><Text style={s.primaryText}>Go to Home</Text></Pressable> : null}</View>
    </View>
  );
}

export function OnboardingScreen(p: OnboardingScreenProps): ReactElement {
  const width = useWindowDimensions().width;
  const device: Device = p.device ?? detectDevice(width);
  const phone = device === "phone";
  const narrow = !phone && width > 0 && width < BREAK;
  const steps = visibleSteps(p.flow, device);
  const [shown, setShown] = useState<string | null>(p.stepKey ?? null);
  // the summary shows when every step is done, or when the last one was finished or skipped
  const [ended, setEnded] = useState(p.stepKey === "summary");
  const wanted = p.stepKey === "summary" ? shown : p.stepKey ?? shown;
  const current = wanted !== null && steps.some((x) => x.key === wanted) ? wanted : resumeOn(p.flow, p.progress, device);
  const open = (key: string): void => { setEnded(false); setShown(key); p.onOpenStep?.(key); };
  const def = steps.find((x) => x.key === current);
  const finished = ended || current === null || def === undefined;
  const words = def ? scriptFor(def.card, p.flow) : null;
  const c = counted(p.flow, p.progress, device);
  useEffect(ensureCss, []);
  // Esc leaves to the app, the same as the X and Finish later; progress is kept
  const leave = p.onClose;
  useEffect(() => {
    if (!web || !leave) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") leave(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [leave]);
  const gateRef = useRef<(() => Promise<boolean>) | null>(null);
  const [armed, setArmed] = useState(false);
  const ctx: CardContext | null = def ? {
    step: def, flow: p.flow, device,
    gate: (save) => { gateRef.current = save; setArmed((was) => (was === (save !== null) ? was : save !== null)); },
    done: () => { p.onStep(def.key, "done"); const n = nextOn(p.flow, { ...p.progress, [def.key]: "done" }, def.key, device); if (n) open(n); else setEnded(true); },
    later: () => { p.onStep(def.key, "later"); const n = nextOn(p.flow, { ...p.progress, [def.key]: "later" }, def.key, device); if (n && !isLast0(p.flow, def.key, device)) open(n); else setEnded(true); },
  } : null;
  // Continue moves on once the step is done; on the last step it reads Done
  const at = def ? steps.findIndex((x) => x.key === def.key) : -1;
  const isLast = at === steps.length - 1;
  const isDone = def ? stateOn(p.progress, def, device) === "done" : false;
  const [saving, setSaving] = useState(false);
  const canNext = isDone || (armed && !saving);
  const next = (): void => {
    if (!def) return;
    if (!isDone) {
      const save = gateRef.current;
      if (!save || saving) return;
      setSaving(true);
      void save().then((ok) => { setSaving(false); if (ok && ctx) ctx.done(); }, () => setSaving(false));
      return;
    }
    if (isLast) { setEnded(true); return; }
    open(steps[at + 1]!.key);
  };
  // Skip on a step already done only moves on; on any other it marks the step skipped
  const skip = (): void => { if (!def || !ctx) return; if (!isDone) { ctx.later(); return; } if (isLast) setEnded(true); else open(steps[at + 1]!.key); };
  const said = def ? saidFor(def.card, null) : "";
  const lines: ChatLine[] = def ? [{ id: `${def.key}-0`, from: "assistant", text: said === "" ? words!.lines[0] ?? "" : said }] : [];
  const chat = p.live && p.lines ? [...lines, ...p.lines] : lines;
  const card = def && ctx ? (p.renderCard ? p.renderCard(def.card, ctx) : <Text style={s.dim}>{def.title}</Text>) : null;
  const previewBody = def && ctx ? (p.renderPreview ? p.renderPreview(def.card, ctx) : null) : null;
  const lock = def ? LOCK[def.card] : undefined;
  const head = def ? (
    <View style={s.head} key={def.key} {...fade}>
      <StepTile flow={p.flow} k={def.key} size={40} />
      <Text style={[s.title, phone && s.titlePhone]} accessibilityRole="header">{def.title}</Text>
      {lock ? <View accessible accessibilityLabel={lock} {...(web ? ({ title: lock } as object) : {})} style={s.lock}><Glyph paths={["M3.500 7h9v6.500h-9z", "M5.500 7V5a2.500 2.500 0 015 0v2"]} size={14} color="var(--ink-4)" /></View> : null}
    </View>
  ) : null;
  const footBtns = def && ctx ? (
    <>
      <Pressable testID="step-later" accessibilityRole="button" onPress={skip} style={({ hovered }: { hovered?: boolean }) => [s.ghost, phone && s.btnTall, hovered === true && s.ghostOver]}><Text style={s.ghostText}>Skip</Text></Pressable>
      <Pressable testID="step-next" accessibilityRole="button" accessibilityState={{ disabled: !canNext }} disabled={!canNext} onPress={next} style={({ hovered }: { hovered?: boolean }) => [s.primary, phone && s.btnTall, phone && s.flexBtn, !canNext && s.off, hovered === true && canNext && s.primaryOver]}><Text style={s.primaryText}>{isLast ? "Done" : "Continue"}</Text></Pressable>
    </>
  ) : null;
  const laterBtn = p.onClose && !finished ? <Pressable testID="onboarding-close" accessibilityRole="link" onPress={p.onClose} style={({ hovered }: { hovered?: boolean }) => [s.later, hovered === true && s.laterOver]}><Text style={s.finishLater}>Finish later</Text></Pressable> : null;
  const closeBtn = p.onClose ? <Pressable testID="onboarding-x" accessibilityRole="button" accessibilityLabel="Close" onPress={p.onClose} style={({ hovered }: { hovered?: boolean }) => [s.x, hovered === true && s.laterOver]}><Text style={s.xText}>{"\u00d7"}</Text></Pressable> : null;
  const top = narrow || phone ? (
    <View style={s.narrowHead}>
      <View style={s.railHeadRow}><Mark size={28} /><Text style={s.railHead} testID="onboarding-progress">{`Set up  ${c.done} of ${c.total}`}</Text></View>
      <Segs steps={steps} progress={p.progress} current={current} device={device} />
    </View>
  ) : <Rail flow={p.flow} steps={steps} progress={p.progress} current={current} device={device} onOpen={open} />;

  if (finished) {
    return (
      <View style={[s.ground, (narrow || phone) && s.groundFlush]}>
        <View testID="onboarding" style={[s.page, (narrow || phone) && s.pageNarrow]}>
          {closeBtn}
          <View testID="onboarding-chat" style={s.chat}><Finished flow={p.flow} steps={steps} progress={p.progress} device={device} onOpen={open} two={!phone && width >= 640} {...(p.onClose ? { onHome: p.onClose } : {})} {...(p.onOpenChats ? { onChats: p.onOpenChats } : {})} /></View>
        </View>
      </View>
    );
  }
  const body = (
    <>
      {head}
      <Said lines={chat} />
    </>
  );
  return (
    <View style={[s.ground, (narrow || phone) && s.groundFlush]}>
    <View testID="onboarding" style={[s.page, (narrow || phone) && s.pageNarrow]}>
      {closeBtn}
      {top}
      <View testID="onboarding-chat" style={s.chat}>
        {p.live && p.liveChat ? (
          <View style={[s.flex, s.body, s.liveCol]}>
            {body}
            {card ? <View testID="onboarding-card" style={s.card}>{card}</View> : null}
            <View testID="onboarding-live" style={s.live}>{p.liveChat}</View>
          </View>
        ) : phone ? (
          <>
            <ScrollView style={s.flex} contentContainerStyle={[s.body, s.bodyPhone]}>
              {body}
              {previewBody ? <View style={s.pCard}>{previewBody}</View> : null}
            </ScrollView>
            <View style={s.sheet} {...fade}>
              <View style={s.grab} />
              <ScrollView style={s.sheetScroll}><View testID="onboarding-card" style={s.sheetCard}>{card}</View></ScrollView>
              <View style={s.sheetFoot}>{laterBtn}<View style={s.flex} />{footBtns}</View>
            </View>
          </>
        ) : (
          <>
            <ScrollView style={s.flex} contentContainerStyle={s.body}>
              {body}
              {card ? <View key={def?.key} testID="onboarding-card" style={s.card} {...fade}>{card}</View> : null}
            </ScrollView>
            <View style={s.footer}><View style={s.actions}>{laterBtn}<View style={s.flex} />{footBtns}</View></View>
          </>
        )}
      </View>
      {narrow || phone ? null : <Preview flow={p.flow} steps={steps} progress={p.progress} current={current} device={device} spaceName={p.spaceName} body={previewBody} onOpen={open} />}
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  ground: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", backgroundColor: "var(--rail)" as string },
  groundFlush: { padding: 0 },
  page: { flex: 1, width: "100%", maxWidth: 1080, maxHeight: 720, flexDirection: "row", backgroundColor: "var(--win)" as string, borderRadius: 20, overflow: "hidden", boxShadow: "var(--sh-pop)" } as object,
  pageNarrow: { flexDirection: "column", maxWidth: "100%", maxHeight: "100%", borderRadius: 0 } as object,
  flex: { flex: 1, minWidth: 0, minHeight: 0 },
  rail: { width: 264, paddingTop: 20, paddingBottom: 20, paddingHorizontal: 12, borderRightWidth: 1, borderRightColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  railHeadRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, marginBottom: 12 },
  railHead: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  bar: { height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string, marginHorizontal: 8, marginBottom: 14, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: "var(--accent)" as string },
  steps: { gap: 2 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8, paddingHorizontal: 8, minHeight: 40, borderRadius: 8 },
  stepOn: { backgroundColor: "var(--sel)" as string },
  stepOver: { backgroundColor: "var(--hover)" as string },
  stepText: { flex: 1, minWidth: 0, gap: 1, justifyContent: "center" },
  stepTitle: { fontSize: 13, lineHeight: 20, fontWeight: "500", color: "var(--ink)" as string },
  stepTitleQuiet: { color: "var(--ink-2)" as string },
  stepTitleOn: { fontWeight: "600" },
  stepSub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  narrowHead: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  segs: { flexDirection: "row", gap: 4, paddingBottom: 14 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "var(--line-2)" as string },
  segOn: { backgroundColor: "var(--accent)" as string },
  segDone: { backgroundColor: "var(--ok)" as string },
  segLater: { backgroundColor: "var(--ink-4)" as string },
  chat: { flex: 1, minWidth: 0, minHeight: 0 },
  body: { width: "100%", maxWidth: COLUMN, alignSelf: "center", paddingTop: 44, paddingHorizontal: 32, paddingBottom: 32, gap: 20 },
  bodyPhone: { paddingTop: 24, paddingHorizontal: 20, paddingBottom: 380 },
  head: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: { flexShrink: 1, fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string },
  titlePhone: { fontSize: 22, lineHeight: 28 },
  lock: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  group: { flexDirection: "row", gap: 12, alignItems: "center" },
  groupText: { flex: 1, minWidth: 0 },
  sayRow: { minHeight: 24, justifyContent: "center" },
  saidText: { fontSize: 16, lineHeight: 24, color: "var(--ink-2)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string, lineHeight: 18 },
  liveCol: { flex: 1 },
  live: { flex: 1, minHeight: 240, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  card: { gap: 14 },
  footer: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  actions: { width: "100%", maxWidth: COLUMN, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 32 },
  x: { position: "absolute", top: 8, right: 8, zIndex: 5, width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  xText: { fontSize: 22, lineHeight: 24, color: "var(--ink-2)" as string },
  later: { height: 44, paddingHorizontal: 10, marginLeft: -10, borderRadius: 8, justifyContent: "center" },
  laterOver: { backgroundColor: "var(--hover)" as string },
  finishLater: { fontSize: 13, fontWeight: "500", color: "var(--ink-3)" as string },
  ghost: { height: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, alignItems: "center", justifyContent: "center" },
  ghostOver: { backgroundColor: "var(--hover)" as string },
  ghostText: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  primary: { height: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryLg: { height: 44, paddingHorizontal: 26, borderRadius: 10, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryOver: { opacity: 0.9 },
  primaryText: { fontSize: 15, fontWeight: "600", color: "var(--accent-ink)" as string },
  off: { opacity: 0.4 },
  btnTall: { height: 44, borderRadius: 12 },
  flexBtn: { flex: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "68%", backgroundColor: "var(--raised)" as string, borderTopLeftRadius: 22, borderTopRightRadius: 22, boxShadow: "0 -1px 0 var(--line-2), 0 -24px 60px -24px rgba(0,0,0,.4)" } as object,
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: "var(--line-2)" as string, alignSelf: "center", marginTop: 8 },
  sheetScroll: { flexGrow: 0 },
  sheetCard: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 14 },
  sheetFoot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  preview: { width: 320, flexGrow: 0, flexShrink: 0, flexBasis: 320, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--side)" as string },
  previewIn: { paddingTop: 20, paddingBottom: 28, paddingHorizontal: 20, gap: 22 },
  hero: { alignItems: "center", gap: 14, paddingTop: 24, paddingBottom: 20, paddingHorizontal: 16 },
  ringBox: { width: 108, height: 108, alignItems: "center", justifyContent: "center" },
  heroName: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  tiles: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, maxWidth: 264 },
  tile: { borderRadius: 12 },
  tileOn: { boxShadow: "0 0 0 2px var(--accent), 0 0 0 5px var(--accent-wash)" } as object,
  tileLater: { opacity: 0.6 },
  pCard: { padding: 14, borderRadius: 12, backgroundColor: "var(--win)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  endWrap: { flex: 1, backgroundColor: "var(--win)" as string },
  endIn: { width: "100%", maxWidth: 680, alignSelf: "center", alignItems: "center", paddingTop: 40, paddingHorizontal: 24, paddingBottom: 28 },
  endTitle: { marginTop: 18, fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string },
  endLead: { marginTop: 4, fontSize: 15, color: "var(--ink-3)" as string },
  grid: { marginTop: 24, width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gr: { width: "100%", flexDirection: "row", alignItems: "center", gap: 12, padding: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string },
  grHalf: { width: "48.8%" },
  grLater: { borderStyle: "dashed" },
  grTitle: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  setUp: { height: 26, paddingHorizontal: 12, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string, justifyContent: "center" },
  setUpText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  endFoot: { alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
});

