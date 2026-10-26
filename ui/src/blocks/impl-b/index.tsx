// Native chat blocks, part 2 (spec native, 2.17 and 4.8; ARCH 6.8 and 7.2): memory_saved, vault_used, access_request, secret_input, model_switch, helper, diff_card.
// Each card is a view over `Block.data` and talks to the app only through `BlockHost`: a button calls `host.invoke(capability, input)` with the ids the
// block carries (logic.ts BLOCK_SPECS_B, checked against generated/registry.json by the tests). Every card has a right-click menu (long press on a phone),
// is reachable by keyboard and paints the quiet hover; colours are skin tokens, so a skin switch repaints with no re-render.
// secret_input is the one card that holds a secret: the typed value lives in that card's state only, goes to vault.item.put when saved and is cleared after.

import { createElement, useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import type { Block } from "../../kit/types.ts";
import { LockedState } from "../../LockedState/index.tsx";
import type { AskInvoke } from "../../LockedState/index.tsx";
import { menuTrigger, useMenu } from "../../Menu/index.tsx";
import type { MenuEntry } from "../../Menu/index.tsx";
import {
  ACCESS_LEVELS,
  BLOCK_SPECS_B,
  EFFORTS,
  PART_TWO_TYPES,
  PROPOSED_LINE,
  SECRET_NOTE,
  SECRET_SAVED_LINE,
  SET_MODEL_CAPABILITY,
  canPropose,
  canSaveSecret,
  changeCount,
  diffKindWord,
  fieldLabel,
  helperStatusWord,
  helperTone,
  helperTrail,
  levelWord,
  memoryHead,
  modelChoices,
  modelLabel,
  openTabB,
  promoteTarget,
  requestLine,
  requestStateLine,
  requestView,
  runActionB,
  secretFields,
  switchTitle,
  valueText,
  vaultLine,
  vaultWhere,
} from "./logic.ts";
import type { AccessLevel, BlockHostB, PartTwoType } from "./logic.ts";
import { accessRequestData, diffCardData, helperData, memorySavedData, modelSwitchData, secretInputData, vaultUsedData } from "./data.ts";

export * from "./logic.ts";
export * from "./data.ts";

export interface BlockViewPropsB<T = unknown> {
  block: Block<T>;
  host: BlockHostB;
}

/** Capabilities of this part that require an idempotencyKey in their input (checked against the registry by the tests). */
export const IDEMPOTENT_CAPS_B: ReadonlySet<string> = new Set(["vault.item.put"]);

let keyCounter = 0;

/** A fresh key for one press. A repeat press is a new action; the kernel de-duplicates a replay of the same key. */
export function newIdempotencyKeyB(block: Block, action: string): string {
  keyCounter += 1;
  return `idem_${block.id}_${action}_${keyCounter}`;
}

/** What one press sends beyond the block's own ids: an idempotency key when the capability asks for one. */
export function extraForB(type: PartTwoType, action: string, block: Block, more: Record<string, unknown> = {}): Record<string, unknown> {
  const spec = BLOCK_SPECS_B[type].actions.find((a) => a.key === action);
  const key = spec !== undefined && IDEMPOTENT_CAPS_B.has(spec.cap) ? { idempotencyKey: newIdempotencyKeyB(block, action) } : {};
  return { ...key, ...more };
}

/** One press: calls the capability the action declares, with the ids from the block data. Resolves false for an unknown action. */
export function performB(host: BlockHostB, type: PartTwoType, action: string, block: Block, more: Record<string, unknown> = {}): Promise<boolean> {
  return runActionB(host, type, action, block.data, extraForB(type, action, block, more));
}

/* ---------- small parts ---------- */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const RING = { boxShadow: "inset 0 0 0 1px var(--line-2)" } as unknown as ViewStyle;
const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

function copyText(text: string): void {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  void nav?.clipboard?.writeText?.(text);
}

type IconName = "key" | "memory" | "bolt" | "helper" | "diff" | "access" | "chev";

const ICON_PATHS: Readonly<Record<IconName, string>> = {
  key: '<circle cx="5.500" cy="10.500" r="2.800"/><path d="M7.600 8.600L13 3.200M11 5.200l1.800 1.800"/>',
  memory: '<path d="M4.500 2.500h7v11L8 10.800 4.500 13.500z"/>',
  bolt: '<path d="M9 1.800L3.800 9h3.600l-.6 5.200L12.200 7H8.600z"/>',
  helper: '<circle cx="4.500" cy="3.500" r="1.600"/><circle cx="4.500" cy="12.500" r="1.600"/><circle cx="11.500" cy="6.500" r="1.600"/><path d="M4.500 5.100v5.800M11.500 8.100c0 2.400-3.500 2-7 3"/>',
  diff: '<path d="M3 5h6M6 2v6M8 12h6"/>',
  access: '<rect x="3.500" y="7" width="9" height="6.500" rx="1.600"/><path d="M5.500 7V5.200a2.500 2.500 0 015 0V7"/>',
  chev: '<path d="M4 6l4 4 4-4"/>',
};

function Icon({ name, size = 14 }: { name: IconName; size?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const markup = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
  return createElement("span", { style: { display: "inline-flex", color: "var(--ink-3)", flex: "none" }, dangerouslySetInnerHTML: { __html: markup } });
}

function Btn({ id, label, onPress, primary = false, quiet = false, danger = false, disabled = false, menu = false }: { id: string; label: string; onPress: (e: unknown) => void; primary?: boolean; quiet?: boolean; danger?: boolean; disabled?: boolean; menu?: boolean }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...webProps(menu ? { "aria-haspopup": "menu" } : {})}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={id}
      style={({ hovered }: { hovered?: boolean }) => [styles.btn, primary && styles.btnPrimary, quiet && styles.btnQuiet, hovered === true && !primary && HOVER, disabled && styles.disabled]}
    >
      <Text style={[styles.btnText, primary && styles.btnTextPrimary, quiet && styles.btnTextQuiet, danger && styles.btnTextDanger]}>{label}</Text>
      {menu ? <Icon name="chev" size={12} /> : null}
    </Pressable>
  );
}

/** Where a menu opened from a button sits: under the button on web, at the press point elsewhere (rule: menus anchor to their button). */
export function anchorOf(event: unknown): { x: number; y: number } {
  const e = event as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } } | undefined;
  const box = e?.currentTarget?.getBoundingClientRect?.();
  if (box !== undefined) return { x: box.left, y: box.bottom + 4 };
  return { x: e?.nativeEvent?.pageX ?? 0, y: e?.nativeEvent?.pageY ?? 0 };
}

function Head({ title, tag, icon, right, onPress, testID }: { title: string; tag?: string | undefined; icon?: IconName; right?: ReactNode; onPress?: (() => void) | undefined; testID: string }): ReactElement {
  const inner = (
    <>
      {icon ? <Icon name={icon} /> : null}
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

/** The card frame: raised surface, quiet ring, right-click or long-press menu. `line` is the one-line variant on the sunk surface. */
function Card({ type, block, testID, menu, line = false, children }: { type: PartTwoType; block: Block; testID: string; menu: () => MenuEntry[]; line?: boolean; children: ReactNode }): ReactElement {
  const { element, show } = useMenu();
  const trigger = useMemo(() => menuTrigger((x, y) => show(menu(), x, y, "context", { label: `${type} block` })), [menu, show, type]);
  return (
    <View testID={testID} accessibilityLabel={`${type} block`} {...webProps({ dataSet: { blockType: type, blockV: String(block.v), traceId: block.traceId } })} {...trigger} style={line ? styles.line : [styles.card, RING]}>
      {children}
      {element}
    </View>
  );
}

/** The menu every card shares: open (when the block has a tab), its own actions, copy trace id. */
function baseMenu(host: BlockHostB, type: PartTwoType, block: Block, actions: { key: string; label: string; danger?: boolean }[], run: (key: string) => void, extra: MenuEntry[] = []): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (BLOCK_SPECS_B[type].opens !== undefined) items.push({ label: "Open beside the chat", onSelect: () => void openTabB(host, type, block.data) });
  for (const a of actions) items.push({ label: a.label, ...(a.danger === true ? { danger: true } : {}), onSelect: () => run(a.key) });
  items.push(...extra);
  if (items.length > 0) items.push({ separator: true });
  items.push({ label: "Copy trace id", onSelect: () => copyText(block.traceId) });
  return items;
}

/* ---------- memory_saved ---------- */

export function MemorySavedBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = memorySavedData(block.data);
  const [proposed, setProposed] = useState(false);
  const showPropose = canPropose(d.layer, d.canPromote, proposed);
  const propose = useCallback(() => {
    const toLayer = promoteTarget(d.layer);
    if (toLayer === null) return;
    setProposed(true);
    void performB(host, "memory_saved", "propose_for_team", block, { toLayer });
  }, [host, block, d.layer]);
  const menu = useCallback(
    () => baseMenu(host, "memory_saved", block, showPropose ? [{ key: "propose_for_team", label: "Propose for team" }] : [], propose, [{ label: "Copy the saved text", onSelect: () => copyText(d.text) }]),
    [host, block, showPropose, propose, d.text],
  );
  const text = proposed ? PROPOSED_LINE : d.text !== "" ? `${memoryHead(d.layer)} · ${d.text}` : memoryHead(d.layer);
  return (
    <Card type="memory_saved" block={block} testID={`blk-memory_saved-${block.id}`} menu={menu} line>
      <Icon name="memory" />
      <Text testID={`blk-memory_saved-${block.id}-text`} style={styles.lineText}>{text}</Text>
      <View style={styles.grow} />
      {showPropose ? <Btn id={`blk-memory_saved-${block.id}-propose_for_team`} label="Propose for team" quiet onPress={propose} /> : null}
    </Card>
  );
}

/* ---------- vault_used ---------- */

export function VaultUsedBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = vaultUsedData(block.data);
  const open = (): void => void openTabB(host, "vault_used", block.data);
  const menu = useCallback(() => baseMenu(host, "vault_used", block, [], () => undefined, [{ label: "Copy the name", onSelect: () => copyText(d.handle) }]), [host, block, d.handle]);
  const where = vaultWhere(d.where);
  const used = vaultLine(d.handle, d.outcome);
  const lead = used.slice(0, used.indexOf(d.handle));
  const tail = used.slice(used.indexOf(d.handle) + d.handle.length);
  return (
    <Card type="vault_used" block={block} testID={`blk-vault_used-${block.id}`} menu={menu} line>
      <Icon name="key" />
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${d.name} in the Vault`} onPress={open} testID={`blk-vault_used-${block.id}-open`} style={({ hovered }: { hovered?: boolean }) => [styles.linePress, hovered === true && HOVER]}>
        <Text style={styles.lineText}>
          {lead}
          <Text style={styles.lineMono}>{d.handle}</Text>
          {tail}
          {where !== "" ? ` · ${where}` : ""}
        </Text>
      </Pressable>
    </Card>
  );
}

/* ---------- access_request ---------- */

export function AccessRequestBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = accessRequestData(block.data);
  const who = host.nameOf?.(d.requester) ?? "Someone";
  const [state, setState] = useState(d.state);
  const [level, setLevel] = useState<AccessLevel>(d.level);
  const { element: levelMenu, show: showLevel } = useMenu();
  const view = requestView(host.viewerId, d.requester);
  const run = useCallback(
    (key: string) => {
      setState(key === "approve" ? "granted" : "declined");
      void performB(host, "access_request", key, block, key === "approve" ? { level } : {});
    },
    [host, block, level],
  );
  const menu = useCallback(
    () => baseMenu(host, "access_request", block, state === "waiting" && view === "approver" ? [{ key: "approve", label: "Approve" }, { key: "decline", label: "Decline", danger: true }] : [], run),
    [host, block, state, view, run],
  );
  if (view === "requester") {
    const ask: AskInvoke = (cap, input) => host.invoke(cap, input as unknown as Record<string, unknown>);
    return (
      <Card type="access_request" block={block} testID={`blk-access_request-${block.id}`} menu={menu}>
        <LockedState
          resourceType={d.resourceType}
          resourceId={d.resourceId}
          title={d.resourceTitle}
          reason="no_grant"
          level={d.level}
          status={state}
          canRequest={state === "declined"}
          note={d.note}
          density="compact"
          invoke={ask}
          testID={`blk-access_request-${block.id}-locked`}
        />
      </Card>
    );
  }
  const levelEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const l of ACCESS_LEVELS) out.push({ label: levelWord(l), checked: l === level, onSelect: () => setLevel(l) });
    return out;
  };
  return (
    <Card type="access_request" block={block} testID={`blk-access_request-${block.id}`} menu={menu}>
      <Head testID={`blk-access_request-${block.id}`} icon="access" title={requestLine(who, level, d.resourceTitle)} />
      {d.note !== "" ? <Text testID={`blk-access_request-${block.id}-note`} style={styles.sub}>{`“${d.note}”`}</Text> : null}
      {state === "waiting" ? (
        <View style={styles.acts}>
          <Btn
            id={`blk-access_request-${block.id}-level`}
            label={`Give ${levelWord(level)}`}
            menu
            quiet
            onPress={(e) => {
              const at = anchorOf(e);
              showLevel(levelEntries(), at.x, at.y, "context", { label: "Access level" });
            }}
          />
          <View style={styles.grow} />
          <Btn id={`blk-access_request-${block.id}-approve`} label="Approve" primary onPress={() => run("approve")} />
          <Btn id={`blk-access_request-${block.id}-decline`} label="Decline" onPress={() => run("decline")} />
        </View>
      ) : (
        <StatusLine tone={state === "granted" ? "ok" : "plain"} testID={`blk-access_request-${block.id}-state`} text={requestStateLine(state, level)} />
      )}
      {levelMenu}
    </Card>
  );
}

/* ---------- secret_input ---------- */

export function SecretInputBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = secretInputData(block.data);
  // The typed values live here and nowhere else: not in the block, not in the transcript, not in a log.
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"typing" | "saving" | "saved" | "failed">("typing");
  const ready = canSaveSecret(d.fields, values) && phase !== "saving";
  const save = useCallback(async () => {
    if (!canSaveSecret(d.fields, values)) return;
    setPhase("saving");
    try {
      await performB(host, "secret_input", "save", block, { fields: secretFields(d.fields, values) });
      setValues({});
      setPhase("saved");
    } catch {
      setPhase("failed");
    }
  }, [host, block, d.fields, values]);
  const menu = useCallback(() => baseMenu(host, "secret_input", block, [], () => undefined), [host, block]);
  const inputs: ReactNode[] = [];
  if (phase !== "saved") {
    for (const key of d.fields) {
      inputs.push(
        <View key={key} style={styles.secretField}>
          <Text style={styles.fieldKey}>{fieldLabel(key)}</Text>
          <TextInput
            accessibilityLabel={`${fieldLabel(key)} for ${d.name}`}
            placeholder="Paste the value"
            placeholderTextColor="var(--ink-4)"
            secureTextEntry
            autoComplete="off"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            value={values[key] ?? ""}
            onChangeText={(v) => setValues((cur) => ({ ...cur, [key]: v }))}
            onSubmitEditing={() => void save()}
            testID={`blk-secret_input-${block.id}-field-${key}`}
            style={[styles.input, styles.secretInput]}
            {...webProps({ dataSet: { lpignore: "true", "1pIgnore": "true" } })}
          />
        </View>,
      );
    }
  }
  return (
    <Card type="secret_input" block={block} testID={`blk-secret_input-${block.id}`} menu={menu}>
      <Head testID={`blk-secret_input-${block.id}`} icon="key" title={`Add ${d.name} to the Vault`} tag={d.kind.replace(/_/g, " ")} />
      <Text style={styles.sub}>{d.hint !== "" ? `${SECRET_NOTE} ${d.hint}` : SECRET_NOTE}</Text>
      {inputs}
      {phase === "saved" ? (
        <StatusLine tone="ok" testID={`blk-secret_input-${block.id}-state`} text={SECRET_SAVED_LINE} />
      ) : (
        <View style={styles.acts}>
          {phase === "failed" ? <Text testID={`blk-secret_input-${block.id}-error`} style={[styles.sub, styles.bad, styles.grow]}>Could not save. Check the value and try again.</Text> : <View style={styles.grow} />}
          <Btn id={`blk-secret_input-${block.id}-save`} label={phase === "saving" ? "Saving" : "Save to Vault"} primary disabled={!ready} onPress={() => void save()} />
        </View>
      )}
    </Card>
  );
}

/* ---------- model_switch ---------- */

export function ModelSwitchBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = modelSwitchData(block.data);
  const [model, setModel] = useState(d.to.model);
  const [effort, setEffort] = useState(d.to.effort ?? "");
  const { element, show } = useMenu();
  const choose = useCallback(
    (nextModel: string, nextEffort: string) => {
      setModel(nextModel);
      setEffort(nextEffort);
      void host.invoke(SET_MODEL_CAPABILITY, {
        threadId: d.threadId,
        agentId: d.agentId,
        provider: d.to.provider,
        model: nextModel,
        ...(nextEffort !== "" ? { effort: nextEffort } : {}),
      });
    },
    [host, d.threadId, d.agentId, d.to.provider],
  );
  const menu = useCallback(() => baseMenu(host, "model_switch", block, [], () => undefined), [host, block]);
  const modelEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const m of modelChoices(d.from, { ...d.to, model })) out.push({ label: m, checked: m === model, onSelect: () => choose(m, effort) });
    return out;
  };
  const effortEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    for (const e of EFFORTS) out.push({ label: e, checked: e === effort, onSelect: () => choose(model, e) });
    return out;
  };
  const line = d.reason !== "" ? d.reason : `Using ${modelLabel(d.to)} instead of ${modelLabel(d.from)}`;
  return (
    <Card type="model_switch" block={block} testID={`blk-model_switch-${block.id}`} menu={menu}>
      <Head testID={`blk-model_switch-${block.id}`} icon="bolt" title={switchTitle(d.scope)} />
      <Text testID={`blk-model_switch-${block.id}-reason`} style={styles.sub}>{line}</Text>
      <View style={styles.acts}>
        <Btn
          id={`blk-model_switch-${block.id}-model`}
          label={`Model: ${model}`}
          menu
          onPress={(e) => {
            const at = anchorOf(e);
            show(modelEntries(), at.x, at.y, "context", { label: "Model" });
          }}
        />
        <Btn
          id={`blk-model_switch-${block.id}-effort`}
          label={`Effort: ${effort !== "" ? effort : "Default"}`}
          menu
          onPress={(e) => {
            const at = anchorOf(e);
            show(effortEntries(), at.x, at.y, "context", { label: "Effort" });
          }}
        />
      </View>
      {element}
    </Card>
  );
}

/* ---------- helper ---------- */

export function HelperBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = helperData(block.data);
  const [stopped, setStopped] = useState(false);
  const status = stopped && d.status === "running" ? "stopped" : d.status;
  const run = useCallback(
    (key: string) => {
      if (key === "stop") setStopped(true);
      void performB(host, "helper", key, block);
    },
    [host, block],
  );
  const menu = useCallback(() => baseMenu(host, "helper", block, status === "running" ? [{ key: "stop", label: "Stop", danger: true }] : [], run), [host, block, status, run]);
  const open = (): void => void openTabB(host, "helper", block.data);
  const trail = d.path.length > 1 ? helperTrail(d.path) : "";
  const who = host.nameOf?.(d.agentId);
  const meta = [who ?? "", d.model].filter((x) => x !== "").join(" · ");
  return (
    <Card type="helper" block={block} testID={`blk-helper-${block.id}`} menu={menu}>
      <Head testID={`blk-helper-${block.id}`} icon="helper" title={d.title} tag={helperStatusWord(status)} onPress={open} />
      {trail !== "" ? <Text numberOfLines={1} testID={`blk-helper-${block.id}-trail`} style={styles.sub}>{trail}</Text> : null}
      <View style={styles.acts}>
        <Text style={[styles.sub, styles.grow]}>{meta}</Text>
        <Btn id={`blk-helper-${block.id}-open`} label="Open" quiet onPress={open} />
        {status === "running" ? <Btn id={`blk-helper-${block.id}-stop`} label="Stop" onPress={() => run("stop")} /> : null}
      </View>
      {status === "failed" || status === "stopped" ? <StatusLine tone={helperTone(status)} testID={`blk-helper-${block.id}-state`} text={status === "failed" ? "This helper failed." : "This helper was stopped."} /> : null}
    </Card>
  );
}

/* ---------- diff_card ---------- */

const MAX_CHANGES = 6;

export function DiffCardBlock({ block, host }: BlockViewPropsB): ReactElement {
  const d = diffCardData(block.data);
  const [done, setDone] = useState<null | "applied" | "rejected">(null);
  const run = useCallback(
    (key: string) => {
      setDone(key === "apply" ? "applied" : "rejected");
      void performB(host, "diff_card", key, block);
    },
    [host, block],
  );
  const menu = useCallback(() => baseMenu(host, "diff_card", block, done === null ? [{ key: "apply", label: "Apply" }, { key: "reject", label: "Reject", danger: true }] : [], run), [host, block, done, run]);
  const lines: ReactNode[] = [];
  for (const [i, c] of d.changes.slice(0, MAX_CHANGES).entries()) {
    lines.push(
      <View key={`${c.path}-${i}`} style={styles.change}>
        <Text numberOfLines={1} style={styles.changePath}>{c.path}</Text>
        <Text numberOfLines={1} style={[styles.changeVal, styles.bad, styles.struck]}>{valueText(c.before)}</Text>
        <Text numberOfLines={1} style={[styles.changeVal, styles.ok]}>{valueText(c.after)}</Text>
      </View>,
    );
  }
  const more = d.changes.length - MAX_CHANGES;
  return (
    <Card type="diff_card" block={block} testID={`blk-diff_card-${block.id}`} menu={menu}>
      <Head testID={`blk-diff_card-${block.id}`} icon="diff" title={d.title} tag={diffKindWord(d.kind)} />
      <Text style={styles.sub}>{[changeCount(d.changes.length), d.affects].filter((x) => x !== "").join(" · ")}</Text>
      <View testID={`blk-diff_card-${block.id}-changes`} style={styles.changes}>
        {lines}
        {more > 0 ? <Text style={styles.sub}>{`and ${more} more`}</Text> : null}
      </View>
      {done === null ? (
        <View style={styles.acts}>
          <Btn id={`blk-diff_card-${block.id}-apply`} label="Apply" primary onPress={() => run("apply")} />
          <Btn id={`blk-diff_card-${block.id}-reject`} label="Reject" quiet danger onPress={() => run("reject")} />
        </View>
      ) : (
        <StatusLine tone={done === "applied" ? "ok" : "plain"} testID={`blk-diff_card-${block.id}-state`} text={done === "applied" ? "Applied" : "Rejected"} />
      )}
    </Card>
  );
}

/* ---------- registry of this part ---------- */

/** The component for each part-two type. The block registry (part 3) mounts these under type@v. */
export const BLOCK_COMPONENTS_B: Readonly<Record<PartTwoType, (props: BlockViewPropsB) => ReactElement>> = {
  memory_saved: MemorySavedBlock,
  vault_used: VaultUsedBlock,
  access_request: AccessRequestBlock,
  secret_input: SecretInputBlock,
  model_switch: ModelSwitchBlock,
  helper: HelperBlock,
  diff_card: DiffCardBlock,
};

export function isPartTwoType(type: string): type is PartTwoType {
  return (PART_TWO_TYPES as readonly string[]).includes(type);
}

/** Renders one block of this part, or null for a type that belongs to another part. */
export function BlockViewB({ block, host }: BlockViewPropsB): ReactElement | null {
  if (!isPartTwoType(block.type)) return null;
  const View_ = BLOCK_COMPONENTS_B[block.type];
  return <View_ block={block} host={host} />;
}

/* ---------- styles ---------- */

const HOVER = { backgroundColor: "var(--hover)" };

const styles = StyleSheet.create({
  card: { marginVertical: 8, borderRadius: 12, backgroundColor: "var(--raised)" as string, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 560, width: "100%" },
  line: { marginVertical: 8, borderRadius: 12, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 560, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 9, rowGap: 4 },
  lineText: { color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  lineMono: { color: "var(--ink)" as string, fontFamily: MONO, fontWeight: "500" },
  linePress: { flexShrink: 1, borderRadius: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  headPress: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 6 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  headTitle: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 19, fontWeight: "600", flexShrink: 1 },
  tag: { height: 19, paddingHorizontal: 7, borderRadius: 99, overflow: "hidden", backgroundColor: "var(--accent-wash)" as string, color: "var(--accent)" as string, fontSize: 11, lineHeight: 19, fontWeight: "600" },
  sub: { color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18 },
  grow: { flex: 1, minWidth: 0 },
  acts: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 8 },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 8, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
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
  struck: { textDecorationLine: "line-through" },
  input: { flex: 1, minWidth: 0, height: 28, borderRadius: 8, paddingHorizontal: 10, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13 },
  secretField: { marginTop: 6, gap: 3 },
  secretInput: { flex: 0, width: "100%" },
  fieldKey: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
  changes: { marginTop: 6, gap: 3 },
  change: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 10, rowGap: 0 },
  changePath: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 12.5, lineHeight: 19, flexShrink: 1 },
  changeVal: { fontFamily: MONO, fontSize: 12.5, lineHeight: 19, flexShrink: 1 },
});
