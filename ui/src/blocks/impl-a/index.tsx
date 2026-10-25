// Native chat blocks, part 1 (spec native, 3.2; ARCH 6.8): terminal, changeset, question, plan, deploy, mount, record_card.
// Each card is a view over `Block.data` and talks to the app only through `BlockHost`: a button calls `host.invoke(capability, input)`
// with the ids the block carries (logic.ts BLOCK_SPECS_A, checked against generated/registry.json by the tests), and "open" calls
// `host.open(tab, input)`. Every card has a right-click menu (long press on a phone), is reachable by keyboard, and paints the quiet
// hover; colours are skin tokens, so a skin switch repaints with no re-render.

import { useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import type { Block } from "../../kit/types.ts";
import { menuTrigger, useMenu } from "../../Menu/index.tsx";
import { Row } from "../../Row/index.tsx";
import type { MenuEntry } from "../../Menu/index.tsx";
import {
  BLOCK_SPECS_A,
  PART_ONE_TYPES,
  buildAnswer,
  answerLine,
  canAnswer,
  changesetOpen,
  changesetTitle,
  checksLine,
  deployActions,
  deployLine,
  durationLabel,
  exitLabel,
  lagLine,
  mountTitle,
  openTab,
  planEdits,
  planProgress,
  planTitle,
  planWaiting,
  runAction,
  safeUrl,
  starTerminal,
  STEP_MARK,
  tailLines,
  terminalActions,
  terminalTitle,
  togglePick,
  visibleFields,
} from "./logic.ts";
import type { BlockHost, PartOneType, PlanStepData } from "./logic.ts";
import { changesetData, deployData, mountData, planData, questionData, recordCardData, terminalData } from "./data.ts";

export * from "./logic.ts";
export * from "./data.ts";

export interface BlockViewProps<T = unknown> {
  block: Block<T>;
  host: BlockHost;
}

/** Capabilities of this part that require an idempotencyKey in their input (checked against the registry by the tests). */
export const IDEMPOTENT_CAPS: ReadonlySet<string> = new Set(["changesets.approve", "sites.promote", "sites.rollback", "mounts.sync_now"]);

let keyCounter = 0;

/** A fresh key for one press. A repeat press is a new action; the kernel de-duplicates a replay of the same key. */
export function newIdempotencyKey(block: Block, action: string): string {
  keyCounter += 1;
  return `idem_${block.id}_${action}_${keyCounter}`;
}

/** What one press sends beyond the block's own ids: an idempotency key when the capability asks for one. */
export function extraFor(type: PartOneType, action: string, block: Block, more: Record<string, unknown> = {}): Record<string, unknown> {
  const spec = BLOCK_SPECS_A[type].actions.find((a) => a.key === action);
  const key = spec !== undefined && IDEMPOTENT_CAPS.has(spec.cap) ? { idempotencyKey: newIdempotencyKey(block, action) } : {};
  return { ...key, ...more };
}

/** One press: calls the capability the action declares, with the ids from the block data. Resolves false for an unknown action. */
export function perform(host: BlockHost, type: PartOneType, action: string, block: Block, more: Record<string, unknown> = {}): Promise<boolean> {
  return runAction(host, type, action, block.data, extraFor(type, action, block, more));
}

/* ---------- small parts ---------- */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RING = { boxShadow: "inset 0 0 0 1px var(--line-2)" } as unknown as ViewStyle;
const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

function copyText(text: string): void {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  void nav?.clipboard?.writeText?.(text);
}

function Btn({ id, label, onPress, primary = false, quiet = false, danger = false, disabled = false, pressed }: { id: string; label: string; onPress: () => void; primary?: boolean; quiet?: boolean; danger?: boolean; disabled?: boolean; pressed?: boolean }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(pressed === undefined ? {} : { selected: pressed }) }}
      disabled={disabled}
      onPress={onPress}
      testID={id}
      style={({ hovered }: { hovered?: boolean }) => [styles.btn, primary && styles.btnPrimary, quiet && styles.btnQuiet, hovered === true && !primary && HOVER, disabled && styles.disabled]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary, quiet && styles.btnTextQuiet, danger && styles.btnTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function Head({ title, tag, right, onPress, testID }: { title: string; tag?: string | undefined; right?: ReactNode; onPress?: (() => void) | undefined; testID: string }): ReactElement {
  const inner = (
    <>
      <Text numberOfLines={1} style={styles.headTitle}>{title}</Text>
      {tag ? <Text style={styles.tag}>{tag}</Text> : null}
    </>
  );
  return (
    <View style={styles.head}>
      {onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} testID={`${testID}-title`} style={({ hovered }: { hovered?: boolean }) => [styles.headPress, hovered === true && HOVER]}>
          {inner}
        </Pressable>
      ) : (
        <View style={styles.headPress}>{inner}</View>
      )}
      {right ? <View style={styles.headRight}>{right}</View> : null}
    </View>
  );
}

function StatusLine({ tone, text, testID }: { tone: "ok" | "bad" | "plain"; text: string; testID: string }): ReactElement {
  return <Text testID={testID} style={[styles.status, tone === "ok" && styles.ok, tone === "bad" && styles.bad]}>{text}</Text>;
}

/** The card frame: raised surface, quiet ring, right-click or long-press menu. */
function Card({ type, block, testID, menu, children }: { type: PartOneType; block: Block; testID: string; menu: () => MenuEntry[]; children: ReactNode }): ReactElement {
  const { element, show } = useMenu();
  const trigger = useMemo(() => menuTrigger((x, y) => show(menu(), x, y, "context", { label: `${type} block` })), [menu, show, type]);
  return (
    <View testID={testID} accessibilityLabel={`${type} block`} {...webProps({ dataSet: { blockType: type, blockV: String(block.v), traceId: block.traceId } })} {...trigger} style={[styles.card, RING]}>
      {children}
      {element}
    </View>
  );
}

/** The menu every card shares: open (when the block has a tab), its own actions, copy trace id. */
function baseMenu(host: BlockHost, type: PartOneType, block: Block, actions: { key: string; label: string; danger?: boolean }[], run: (key: string) => void, extra: MenuEntry[] = []): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (BLOCK_SPECS_A[type].opens !== undefined) items.push({ label: "Open beside the chat", onSelect: () => void openTab(host, type, block.data) });
  for (const a of actions) items.push({ label: a.label, ...(a.danger === true ? { danger: true } : {}), onSelect: () => run(a.key) });
  items.push(...extra);
  if (items.length > 0) items.push({ separator: true });
  items.push({ label: "Copy trace id", onSelect: () => copyText(block.traceId) });
  return items;
}

/* ---------- terminal ---------- */

export function TerminalBlock({ block, host }: BlockViewProps): ReactElement {
  const d = terminalData(block.data);
  const [starred, setStarred] = useState(d.starred);
  const acts = terminalActions(d.state);
  const run = useCallback((key: string) => void perform(host, "terminal", key, block), [host, block]);
  const toggleStar = useCallback(() => {
    const next = !starred;
    setStarred(next);
    void starTerminal(host, d.terminalId, next);
  }, [host, d.terminalId, starred]);
  const menu = useCallback(
    () =>
      baseMenu(
        host,
        "terminal",
        block,
        [...(acts.interrupt ? [{ key: "interrupt", label: "Interrupt" }] : []), ...(acts.close ? [{ key: "close", label: "Close terminal" }] : [])],
        run,
        [{ label: starred ? "Remove the star" : "Star this terminal", onSelect: toggleStar }],
      ),
    [host, block, acts.interrupt, acts.close, run, starred, toggleStar],
  );
  const shown = d.commands.slice(-3);
  const lines = tailLines(d.tail);
  const screen: ReactNode[] = [];
  for (const [i, c] of shown.entries()) screen.push(<Text key={`c${c.startedAt}-${i}`} style={styles.termDim}>{`$ ${c.command}`}</Text>);
  for (const [i, line] of lines.entries()) screen.push(<Text key={`l${i}`} style={styles.termLine}>{line === "" ? " " : line}</Text>);
  const totalMs = d.commands.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  return (
    <Card type="terminal" block={block} testID={`blk-terminal-${block.id}`} menu={menu}>
      <Head
        testID={`blk-terminal-${block.id}`}
        title={d.title}
        onPress={() => void openTab(host, "terminal", block.data)}
        right={
          <>
            <Btn id={`blk-terminal-${block.id}-open`} label="Open as tab" quiet onPress={() => void openTab(host, "terminal", block.data)} />
            <Btn id={`blk-terminal-${block.id}-star`} label={starred ? "Starred" : "Star"} pressed={starred} onPress={toggleStar} />
          </>
        }
      />
      <Text style={styles.sub}>{terminalTitle(d.commands.length, d.hostTitle)}{totalMs > 0 ? ` · ${durationLabel(totalMs)}` : ""}</Text>
      <View testID={`blk-terminal-${block.id}-screen`} style={styles.term}>
        {screen}
      </View>
      <View style={styles.acts}>
        <Text testID={`blk-terminal-${block.id}-exit`} style={[styles.sub, styles.grow]}>{d.state === "running" ? "Running" : d.state === "idle" && d.exitCode === null ? "Idle" : exitLabel(d.exitCode)}</Text>
        {acts.interrupt ? <Btn id={`blk-terminal-${block.id}-interrupt`} label="Interrupt" onPress={() => run("interrupt")} /> : null}
        {acts.close ? <Btn id={`blk-terminal-${block.id}-close`} label="Close" onPress={() => run("close")} /> : null}
      </View>
    </Card>
  );
}

/* ---------- changeset ---------- */

export function ChangesetBlock({ block, host }: BlockViewProps): ReactElement {
  const d = changesetData(block.data);
  const [done, setDone] = useState<null | "approved" | "changes" | "discarded">(null);
  const open = changesetOpen(d.state) && done === null;
  const run = useCallback(
    (key: string) => {
      setDone(key === "approve" ? "approved" : key === "discard" ? "discarded" : "changes");
      void perform(host, "changeset", key, block);
    },
    [host, block],
  );
  const menu = useCallback(
    () => baseMenu(host, "changeset", block, open ? [{ key: "approve", label: "Approve and commit" }, { key: "request_changes", label: "Request changes" }, { key: "discard", label: "Discard", danger: true }] : [], run),
    [host, block, open, run],
  );
  const closedWord = done === "approved" ? "Approved and committed" : done === "discarded" ? "Discarded" : done === "changes" ? "Changes requested" : d.state.charAt(0).toUpperCase() + d.state.slice(1);
  return (
    <Card type="changeset" block={block} testID={`blk-changeset-${block.id}`} menu={menu}>
      <Head testID={`blk-changeset-${block.id}`} title={changesetTitle(d.fileCount, d.folderName)} onPress={() => void openTab(host, "changeset", block.data)} />
      <View style={styles.acts}>
        <Text testID={`blk-changeset-${block.id}-counts`} style={styles.counts}>
          <Text style={styles.ok}>{`+${d.added}`}</Text>
          {"  "}
          <Text style={styles.bad}>{`−${d.removed}`}</Text>
        </Text>
        <View style={styles.grow} />
        <Btn id={`blk-changeset-${block.id}-review`} label="Review changes" primary={open} onPress={() => void openTab(host, "changeset", block.data)} />
      </View>
      {open ? (
        <View style={styles.acts}>
          <Btn id={`blk-changeset-${block.id}-approve`} label="Approve and commit" onPress={() => run("approve")} />
          <Btn id={`blk-changeset-${block.id}-request_changes`} label="Request changes" onPress={() => run("request_changes")} />
          <Btn id={`blk-changeset-${block.id}-discard`} label="Discard" quiet danger onPress={() => run("discard")} />
        </View>
      ) : (
        <StatusLine tone={done === "discarded" ? "plain" : "ok"} testID={`blk-changeset-${block.id}-state`} text={closedWord} />
      )}
    </Card>
  );
}

/* ---------- question ---------- */

export function QuestionBlock({ block, host }: BlockViewProps): ReactElement {
  const d = questionData(block.data);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<unknown>(d.answer);
  const answered = sent !== undefined && sent !== null;
  const submit = useCallback(
    (keys: readonly string[], typed: string) => {
      const answer = buildAnswer(d.mode, keys, typed);
      setSent(answer);
      void perform(host, "question", "answer", block, { answer });
    },
    [host, block, d.mode],
  );
  const choose = (key: string): void => {
    if (d.mode === "single") submit([key], "");
    else setPicked((p) => togglePick(d.mode, p, key));
  };
  const menu = useCallback(() => baseMenu(host, "question", block, [], () => undefined), [host, block]);
  const optionRows: ReactNode[] = [];
  for (const o of d.options) {
    const on = picked.includes(o.key);
    optionRows.push(
      <Row
        key={o.key}
        id={`blk-question-${block.id}-opt-${o.key}`}
        title={o.label}
        {...(o.detail !== undefined ? { note: o.detail } : {})}
        selected={on}
        leading={<Text style={styles.optMark}>{d.mode === "multi" ? (on ? "☑" : "☐") : on ? "●" : "○"}</Text>}
        onPress={() => choose(o.key)}
      />,
    );
  }
  return (
    <Card type="question" block={block} testID={`blk-question-${block.id}`} menu={menu}>
      <Head testID={`blk-question-${block.id}`} title={d.prompt} />
      {answered ? (
        <StatusLine tone="ok" testID={`blk-question-${block.id}-answered`} text={`${d.answeredBy !== "" ? `${d.answeredBy} answered` : "You answered"}: ${answerLine(d.options, sent)}`} />
      ) : (
        <>
          {d.mode !== "free" ? (
            <View accessibilityRole="radiogroup" style={styles.opts}>
              {optionRows}
            </View>
          ) : null}
          {d.mode === "free" || d.allowOther ? (
            <View style={styles.free}>
              <TextInput
                accessibilityLabel={d.mode === "free" ? "Your answer" : "Your own answer"}
                placeholder={d.mode === "free" ? "Write your answer" : "Or write your own answer"}
                placeholderTextColor="var(--ink-4)"
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => {
                  if (canAnswer(d.mode, picked, text)) submit(picked, text);
                }}
                testID={`blk-question-${block.id}-text`}
                style={styles.input}
              />
              <Btn id={`blk-question-${block.id}-answer`} label="Answer" primary disabled={!canAnswer(d.mode, picked, text)} onPress={() => submit(picked, text)} />
            </View>
          ) : d.mode === "multi" ? (
            <View style={styles.acts}>
              <Btn id={`blk-question-${block.id}-answer`} label="Answer" primary disabled={!canAnswer(d.mode, picked, "")} onPress={() => submit(picked, "")} />
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/* ---------- plan ---------- */

export function PlanBlock({ block, host }: BlockViewProps): ReactElement {
  const d = planData(block.data);
  const [state, setState] = useState(d.state);
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const waiting = planWaiting(state);
  const approve = useCallback(() => {
    const edits = planEdits(d.steps, texts, removed);
    setState("approved");
    setEditing(false);
    void perform(host, "plan", "approve", block, edits.length > 0 ? { edits } : {});
  }, [host, block, d.steps, texts, removed]);
  const reject = useCallback(() => {
    setState("rejected");
    setEditing(false);
    void perform(host, "plan", "reject", block);
  }, [host, block]);
  const run = useCallback((key: string) => (key === "approve" ? approve() : reject()), [approve, reject]);
  const menu = useCallback(
    () => baseMenu(host, "plan", block, waiting ? [{ key: "approve", label: "Approve" }, { key: "reject", label: "Reject", danger: true }] : [], run),
    [host, block, waiting, run],
  );
  const toggleRemoved = (id: string): void =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const steps: PlanStepData[] = d.steps;
  const stepRows: ReactNode[] = [];
  for (const [i, s] of steps.entries()) {
    const gone = removed.has(s.stepId);
    stepRows.push(
            <View key={s.stepId} style={styles.step} testID={`blk-plan-${block.id}-step-${i}`}>
              <Text style={styles.stepMark}>{waiting ? `${i + 1}.` : STEP_MARK[s.state]}</Text>
              {editing && waiting ? (
                <>
                  <TextInput
                    accessibilityLabel={`Step ${i + 1}`}
                    value={texts[s.stepId] ?? s.text}
                    onChangeText={(t) => setTexts((prev) => ({ ...prev, [s.stepId]: t }))}
                    testID={`blk-plan-${block.id}-edit-${i}`}
                    style={[styles.input, styles.grow, gone && styles.struck]}
                  />
                  <Btn id={`blk-plan-${block.id}-remove-${i}`} label={gone ? "Keep" : "Remove"} quiet onPress={() => toggleRemoved(s.stepId)} />
                </>
              ) : (
                <View style={styles.grow}>
                  <Text style={[styles.stepText, s.state === "skipped" && styles.struck]}>{s.text}</Text>
                  {s.detail ? <Text style={styles.sub}>{s.detail}</Text> : null}
                </View>
              )}
            </View>
    );
  }
  return (
    <Card type="plan" block={block} testID={`blk-plan-${block.id}`} menu={menu}>
      <Head testID={`blk-plan-${block.id}`} title={planTitle(d.title, steps.length)} tag={waiting ? "Plan mode on" : undefined} onPress={d.hasDoc ? () => void openTab(host, "plan", block.data) : undefined} />
      <View style={styles.steps}>
        {stepRows}
      </View>
      {waiting ? (
        <View style={styles.acts}>
          <Btn id={`blk-plan-${block.id}-approve`} label={editing ? "Approve with edits" : "Approve"} primary onPress={approve} />
          <Btn id={`blk-plan-${block.id}-edit`} label={editing ? "Cancel" : "Edit"} onPress={() => { setEditing((e) => !e); setTexts({}); setRemoved(new Set()); }} />
          <Btn id={`blk-plan-${block.id}-reject`} label="Reject" quiet danger onPress={reject} />
        </View>
      ) : state === "approved" ? (
        <StatusLine tone="ok" testID={`blk-plan-${block.id}-state`} text={`Approved · plan mode is off · ${planProgress(steps)}`} />
      ) : state === "rejected" ? (
        <StatusLine tone="bad" testID={`blk-plan-${block.id}-state`} text="Rejected · tell it what to change" />
      ) : (
        <StatusLine tone="ok" testID={`blk-plan-${block.id}-state`} text={`Done · ${planProgress(steps)}`} />
      )}
    </Card>
  );
}

/* ---------- deploy ---------- */

export function DeployBlock({ block, host }: BlockViewProps): ReactElement {
  const d = deployData(block.data);
  const acts = deployActions(d.state, d.canPromote, d.env);
  const link = safeUrl(d.url);
  const run = useCallback((key: string) => void perform(host, "deploy", key, block), [host, block]);
  const follow = useCallback((): void => {
    if (link !== null) host.openUrl?.(link);
  }, [host, link]);
  const menu = useCallback(
    () =>
      baseMenu(
        host,
        "deploy",
        block,
        [...(acts.promote ? [{ key: "promote", label: "Promote" }] : []), ...(acts.rollback ? [{ key: "rollback", label: "Roll back", danger: true }] : [])],
        run,
        link !== null ? [{ label: "Open the preview link", onSelect: follow }, { label: "Copy link", onSelect: () => copyText(link) }] : [],
      ),
    [host, block, acts.promote, acts.rollback, link, run, follow],
  );
  const dot = d.state === "ready" ? "var(--ok)" : d.state === "failed" ? "var(--danger)" : d.state === "stopped" ? "var(--ink-4)" : "var(--warn)";
  const checks = checksLine(d.checks);
  const failedChecks: ReactNode[] = [];
  for (const c of d.checks) if (!c.ok) failedChecks.push(<Text key={c.name} style={[styles.sub, styles.bad]}>{`${c.name} failed`}</Text>);
  return (
    <Card type="deploy" block={block} testID={`blk-deploy-${block.id}`} menu={menu}>
      <Head testID={`blk-deploy-${block.id}`} title={deployLine(d.env, d.state)} onPress={() => void openTab(host, "deploy", block.data)} />
      <View style={styles.dep}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.sub}>{d.state === "ready" ? "Live" : d.state === "building" ? "Building" : d.state === "queued" ? "Waiting to build" : d.state === "failed" ? "Failed" : "Stopped"}{checks !== "" ? ` · ${checks}` : ""}</Text>
      </View>
      {d.checks.some((c) => !c.ok) ? (
        <View style={styles.steps}>
          {failedChecks}
        </View>
      ) : null}
      <View style={styles.acts}>
        {link !== null ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${link}`} onPress={follow} testID={`blk-deploy-${block.id}-link`} style={styles.grow}>
            <Text numberOfLines={1} style={styles.link}>{link.replace(/^https?:\/\//i, "")}</Text>
          </Pressable>
        ) : (
          <View style={styles.grow} />
        )}
        {link !== null ? <Btn id={`blk-deploy-${block.id}-preview`} label="Open preview" onPress={follow} /> : null}
        {acts.promote ? <Btn id={`blk-deploy-${block.id}-promote`} label="Promote" primary onPress={() => run("promote")} /> : null}
        {acts.rollback ? <Btn id={`blk-deploy-${block.id}-rollback`} label="Roll back" quiet danger onPress={() => run("rollback")} /> : null}
      </View>
    </Card>
  );
}

/* ---------- mount ---------- */

export function MountBlock({ block, host }: BlockViewProps): ReactElement {
  const d = mountData(block.data);
  const [syncing, setSyncing] = useState(false);
  const run = useCallback(
    (key: string) => {
      setSyncing(true);
      void Promise.resolve(perform(host, "mount", key, block)).finally(() => setSyncing(false));
    },
    [host, block],
  );
  const menu = useCallback(() => baseMenu(host, "mount", block, [{ key: "sync", label: "Sync now" }], run), [host, block, run]);
  const lag = lagLine(d.lagSeconds);
  return (
    <Card type="mount" block={block} testID={`blk-mount-${block.id}`} menu={menu}>
      <Head testID={`blk-mount-${block.id}`} title={mountTitle(d.name, d.provider)} onPress={() => void openTab(host, "mount", block.data)} right={<Btn id={`blk-mount-${block.id}-open`} label="Open in Files" quiet onPress={() => void openTab(host, "mount", block.data)} />} />
      <View style={styles.acts}>
        <Text testID={`blk-mount-${block.id}-lag`} style={[styles.sub, styles.grow]}>{[d.state, lag].filter((x) => x !== "").join(" · ")}</Text>
        <Btn id={`blk-mount-${block.id}-sync`} label={syncing ? "Syncing" : "Sync now"} disabled={syncing} onPress={() => run("sync")} />
      </View>
    </Card>
  );
}

/* ---------- record card ---------- */

export function RecordCardBlock({ block, host }: BlockViewProps): ReactElement {
  const d = recordCardData(block.data);
  const fields = visibleFields(d.fields, 4);
  const fieldViews: ReactNode[] = [];
  for (const f of fields) {
    fieldViews.push(
      <View key={f.key} style={styles.field}>
        <Text numberOfLines={1} style={styles.fieldKey}>{f.title}</Text>
        <Text numberOfLines={1} style={styles.fieldVal}>{f.text}</Text>
      </View>,
    );
  }
  const go = (): void => void openTab(host, "record_card", block.data);
  const menu = useCallback(() => baseMenu(host, "record_card", block, [], () => undefined), [host, block]);
  const { element, show } = useMenu();
  const trigger = useMemo(() => menuTrigger((x, y) => show(menu(), x, y, "context", { label: "record block" })), [menu, show]);
  return (
    <View testID={`blk-record_card-${block.id}`} {...webProps({ dataSet: { blockType: "record_card", blockV: String(block.v), traceId: block.traceId } })} style={[styles.card, RING, styles.cardFlush]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${d.title}`}
        onPress={go}
        testID={`blk-record_card-${block.id}-open`}
        {...trigger}
        style={({ hovered }: { hovered?: boolean }) => [styles.recPress, hovered === true && HOVER]}
      >
        <View style={styles.head}>
          <Text numberOfLines={1} style={[styles.headTitle, styles.grow]}>{d.title}</Text>
          {d.type ? <Text style={styles.tag}>{d.type}</Text> : null}
          {d.status ? <Text style={styles.sub}>{d.status}</Text> : null}
        </View>
        {d.summary ? <Text numberOfLines={2} style={styles.sub}>{d.summary}</Text> : null}
        {fields.length > 0 ? (
          <View style={styles.fields}>
            {fieldViews}
          </View>
        ) : null}
      </Pressable>
      {element}
    </View>
  );
}

/* ---------- registry of this part ---------- */

/** The component for each part-one type. The block registry (part 3) mounts these under type@v. */
export const BLOCK_COMPONENTS_A: Readonly<Record<PartOneType, (props: BlockViewProps) => ReactElement>> = {
  terminal: TerminalBlock,
  changeset: ChangesetBlock,
  question: QuestionBlock,
  plan: PlanBlock,
  deploy: DeployBlock,
  mount: MountBlock,
  record_card: RecordCardBlock,
};

export function isPartOneType(type: string): type is PartOneType {
  return (PART_ONE_TYPES as readonly string[]).includes(type);
}

/** Renders one block of this part, or null for a type that belongs to another part. */
export function BlockViewA({ block, host }: BlockViewProps): ReactElement | null {
  if (!isPartOneType(block.type)) return null;
  const View_ = BLOCK_COMPONENTS_A[block.type];
  return <View_ block={block} host={host} />;
}

/* ---------- styles ---------- */

const HOVER = { backgroundColor: "var(--hover)" };
const SELECTED = { backgroundColor: "var(--sel)" };

const textBase: TextStyle = { color: "var(--ink)" as string, fontSize: 13, lineHeight: 19 };

const styles = StyleSheet.create({
  card: { marginVertical: 8, borderRadius: 12, backgroundColor: "var(--raised)" as string, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 560, width: "100%" },
  cardFlush: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  headPress: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 6 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  headTitle: { ...textBase, fontWeight: "600", flexShrink: 1 },
  tag: { height: 19, paddingHorizontal: 7, borderRadius: 99, overflow: "hidden", backgroundColor: "var(--accent-wash)" as string, color: "var(--accent)" as string, fontSize: 11, lineHeight: 19, fontWeight: "600" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18 },
  grow: { flex: 1, minWidth: 0 },
  acts: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 8 },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnQuiet: { backgroundColor: "transparent" },
  btnText: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
  btnTextQuiet: { color: "var(--accent)" as string },
  btnTextDanger: { color: "var(--danger)" as string },
  disabled: { opacity: 0.45 },
  status: { marginTop: 6, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  ok: { color: "var(--ok)" as string },
  bad: { color: "var(--danger)" as string },
  counts: { fontFamily: MONO, fontSize: 12, lineHeight: 18 },
  term: { marginTop: 6, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 8, backgroundColor: "#16161A" },
  termDim: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: "#8A8A92" },
  termLine: { fontFamily: MONO, fontSize: 12, lineHeight: 18, color: "#D8D8DE" },
  opts: { marginHorizontal: -6, gap: 2 },
  opt: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 8 },
  optMark: { color: "var(--ink-3)" as string, fontSize: 13, lineHeight: 19, width: 16 },
  optLabel: { ...textBase },
  free: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  input: { flex: 1, minWidth: 0, height: 28, borderRadius: 8, paddingHorizontal: 10, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13 },
  steps: { gap: 3, marginBottom: 2 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  stepMark: { width: 18, color: "var(--ink-3)" as string, fontSize: 13, lineHeight: 19, textAlign: "right" },
  stepText: { ...textBase },
  struck: { textDecorationLine: "line-through", color: "var(--ink-3)" as string },
  dep: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 99 },
  link: { color: "var(--accent)" as string, fontFamily: MONO, fontSize: 12.5, lineHeight: 18 },
  recPress: { paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  fields: { flexDirection: "row", flexWrap: "wrap", columnGap: 18, rowGap: 4, marginTop: 4 },
  field: { minWidth: 110, maxWidth: 220 },
  fieldKey: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
  fieldVal: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 18 },
});
