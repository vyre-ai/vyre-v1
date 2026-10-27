// The step panel: opens beside the canvas when a card is selected. A name, the account the step was given, the step's own fields (one text field per input, in words), the AI step's key
// and backup, what happens when the step fails, and the problems the check found for this step. Every change goes through `onChange` as a new definition, so Undo and Save see it like any other edit.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { AskVyre } from "../ask/AskVyre.tsx";
import type { AskBundle } from "../ask/bundle.ts";
import { accountDefaultInput, accountMenu, applyAccount } from "../connect/accounts.ts";
import type { AccountOption } from "../connect/accounts.ts";
import { DataShelf, MappingFix, SectionRow, commitTyped, nodeIdSet } from "../builder/marks.tsx";
import { StepTest } from "../builder/StepTest.tsx";
import { isPreviewKey, PREVIEW_NOTE } from "../catalog/model.ts";
import { presenceOf } from "../values/typed.ts";
import { Glyph } from "./icons.tsx";
import { ERROR_MODES, keyChoices, kindOfKey, setBranch, setTriggerConfig, titleOfKey, updateStep, triggerMeta } from "./model.ts";
import type { DefNode, DefTrigger, Definition, Issue, KeyChoice } from "./model.ts";
import type { KeysStatus } from "./data.tsx";
import { IconButton, pointer, s as ps, webOnly } from "./parts.tsx";

const humanize = (k: string): string => k.replace(/([A-Z])/g, " $1").replace(/[_.]+/g, " ").replace(/^./, (x) => x.toUpperCase());
type Ai = NonNullable<DefNode["ai"]>;
function withKey(ai: DefNode["ai"], field: "keyId" | "backupKeyId", id: string | undefined): Ai {
  const next: Ai = { ...(ai ?? {}) };
  if (id) next[field] = id; else delete next[field];
  return next;
}
const show = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function Inspector({ def, node, trigger, triggerIndex, issues, keys, onChange, onClose, onDelete, testID = "inspector", embedded = false, section = "configure", onSection, samples = {}, version = 0, onStoreSample, onAsk, keysStatus, accounts = [], inputSchema, lastPicks }: {
  def: Definition;
  node: DefNode | null;
  trigger: DefTrigger | null;
  triggerIndex: number | null;
  issues: readonly Issue[];
  keys: readonly KeyChoice[];
  onChange(next: Definition): void;
  onClose(): void;
  onDelete(): void;
  testID?: string;
  embedded?: boolean;
  section?: "configure" | "data" | "test";
  onSection?(next: "configure" | "data" | "test"): void;
  samples?: Readonly<Record<string, unknown>>;
  version?: number;
  onStoreSample?(nodeId: string, output: unknown): void;
  onAsk?(bundle: AskBundle): void;
  keysStatus?: KeysStatus;
  /** Accounts the parent already loaded. Empty shows "No accounts yet" and does not invent one. */
  accounts?: readonly AccountOption[];
  /** Catalog input schema for this step. Omit when the catalog has not loaded. */
  inputSchema?: unknown;
  /** Last explicit pick for this person, keyed by app. Omit when the parent has none. */
  lastPicks?: Readonly<Record<string, string>>;
}): ReactElement {
  const { element, show: openMenu } = useMenu();
  const [advanced, setAdvanced] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const wroteDefault = useRef("");
  useEffect(() => {
    if (!node) return;
    const next = accountDefaultInput({
      input: node.input ?? {},
      nodes: def.nodes.filter((item) => item.id !== node.id).map((item) => ({ input: item.input ?? {} })),
      accounts,
      ...(inputSchema !== undefined ? { schema: inputSchema } : {}),
      ...(lastPicks ? { last: lastPicks } : {}),
    });
    if (!next) return;
    const mark = `${node.id}:${JSON.stringify(next)}`;
    if (wroteDefault.current === mark) return;
    wroteDefault.current = mark;
    onChange(updateStep(def, node.id, { input: next }));
  }, [node, def, accounts, inputSchema, lastPicks, onChange]);
  const prior = def.nodes.filter((item) => node ? def.nodes.indexOf(item) < def.nodes.indexOf(node) : true).map((item) => ({ id: item.id, title: item.title ?? titleOfKey(item.key), output: samples[item.id] })).filter((item) => item.output !== undefined);
  const errorEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (!node) return out;
    for (const m of ERROR_MODES) {
      out.push({
        label: m.label, checked: (node.onError?.mode ?? "fail") === m.mode,
        onSelect: () => onChange(updateStep(def, node.id, { onError: {
          mode: m.mode,
          ...(m.mode === "retry" ? { max: node.onError?.max ?? 3 } : {}),
          ...(m.mode === "route" && node.onError?.route ? { route: node.onError.route } : {}),
          ...(m.mode === "route" && node.onError?.codes?.length ? { codes: [...node.onError.codes] } : {}),
          ...(m.mode === "substitute" && node.onError?.output !== undefined ? { output: node.onError.output } : {}),
        } })),
      });
    }
    return out;
  };
  const routeEntries = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (!node) return out;
    for (const n of def.nodes) if (n.id !== node.id) out.push({ label: n.title ?? titleOfKey(n.key), onSelect: () => onChange(updateStep(def, node.id, { onError: { mode: "route", route: n.id, ...(node.onError?.codes?.length ? { codes: [...node.onError.codes] } : {}) } })) });
    return out;
  };
  const mine = issues.filter((i) => (node ? i.nodeId === node.id : i.nodeId === "trigger"));
  const keyName = (id: string | undefined): string => (id ? (keys.find((k) => k.id === id)?.name ?? id) : "Choose a key");
  const pick = (x: number, y: number, set: (id: string | undefined) => void, none: string): void => {
    const items: MenuEntry[] = [];
    for (const k of keyChoices(keys, none, set)) {
      items.push({ label: k.label, onSelect: k.run });
      if (items.length === 1) items.push({ separator: true });
    }
    openMenu(items, x, y, "other");
  };
  if (!node) {
    const meta = trigger ? triggerMeta(trigger.key, trigger.config) : null;
    const configFields: ReactElement[] = [];
    if (trigger && triggerIndex !== null) {
      for (const [k, v] of Object.entries(trigger.config ?? {})) {
        if (k === "label") continue;
        configFields.push(<Field key={k} label={humanize(k)} value={show(v)} onCommit={(t) => {
          const presence = presenceOf(true, v);
          const nextPresence = presence === "null" && t === "" ? "null" : presence === "empty" && t === "" ? "empty" : "value";
          onChange(setTriggerConfig(def, triggerIndex, k, commitTyped(v, t, nextPresence)));
        }} />);
      }
    }
    return (
      <View style={embedded ? [i.pane, i.embedded] : i.pane} testID={testID} accessibilityLabel="Trigger settings">
        <Head title={meta?.title ?? "Trigger"} sub="Trigger" onClose={onClose} />
        <ScrollView contentContainerStyle={i.body}>
          <SectionRow section={section} onSection={(next) => onSection?.(next)} />
          {section === "data" ? <DataShelf triggerSample={samples["trigger"]} steps={prior} /> : null}
          {section === "test" ? <Text style={i.hint}>Pick a step to test it.</Text> : null}
          {section === "configure" ? (
            <>
              {trigger && isPreviewKey(trigger.key, "trigger") ? <Text style={i.hint}>{PREVIEW_NOTE}</Text> : null}
              {trigger ? <Text style={i.hint}>{`This is trigger ${(triggerIndex ?? 0) + 1} of ${def.triggers.length}. Any one of them starts a run.`}</Text> : <Text style={i.hint}>Every trigger is listed on the card. Any one starts a run.</Text>}
              {configFields}
              <Problems list={mine} />
            </>
          ) : null}
        </ScrollView>
        {element}
      </View>
    );
  }
  const kind = kindOfKey(node.key);
  const accountPick = accountMenu({
    input: node.input ?? {},
    nodes: def.nodes.filter((item) => item.id !== node.id).map((item) => ({ input: item.input ?? {} })),
    accounts,
    ...(inputSchema !== undefined ? { schema: inputSchema } : {}),
    ...(lastPicks ? { last: lastPicks } : {}),
  });
  const inputKeys = Object.keys(node.input ?? {});
  const fields: ReactElement[] = [];
  const branches = node.branches ?? [];
  for (let n = 0; n < branches.length; n++) {
    const b = branches[n]!;
    if (kind === "paths") {
      fields.push(
        <Field
          key={`${node.id}-p${n}`} label={b.when === undefined ? "Otherwise" : `Path ${n + 1}, if`} value={b.when ?? ""} mono readOnly={b.when === undefined} placeholder="lead.phone is not empty" testID={`field-path-${n}`}
          onCommit={(t) => onChange(updateStep(def, node.id, { branches: setBranch(node, n, { when: t }) }))}
        />,
      );
    } else if (kind === "parallel") {
      fields.push(<Field key={`${node.id}-l${n}`} label={`Lane ${n + 1} name`} value={b.label} testID={`field-lane-${n}`} onCommit={(t) => onChange(updateStep(def, node.id, { branches: setBranch(node, n, { label: t }) }))} />);
    }
  }
  for (const k of inputKeys) {
    if (accountPick && (k === "connectionId" || k === "mailboxId" || (accountPick.field === "connectionId" && k === "connector"))) continue;
    fields.push(<Field key={`${node.id}-${k}`} label={humanize(k)} value={show(node.input[k])} testID={`field-${k}`} onCommit={(t) => {
      const cur = node.input[k];
      const presence = presenceOf(true, cur);
      const nextPresence = presence === "null" && t === "" ? "null" : presence === "empty" && t === "" ? "empty" : "value";
      const next = commitTyped(cur, t, nextPresence);
      const input = { ...node.input };
      if (next === undefined) delete input[k];
      else input[k] = next;
      onChange(updateStep(def, node.id, { input }));
    }} />);
  }
  return (
    <View style={embedded ? [i.pane, i.embedded] : i.pane} testID={testID} accessibilityLabel={`${node.title ?? titleOfKey(node.key)} settings`}>
      <Head title={node.title ?? titleOfKey(node.key)} sub={titleOfKey(node.key)} onClose={onClose} />
      <ScrollView contentContainerStyle={i.body} keyboardShouldPersistTaps="handled">
        <SectionRow section={section} onSection={(next) => onSection?.(next)} />
        {section === "data" ? <DataShelf triggerSample={samples["trigger"]} steps={prior} /> : null}
        {section === "test" ? <StepTest stepKey={node.key} nodeId={node.id} input={node.input ?? {}} version={version} onUseOutput={(output) => onStoreSample?.(node.id, output)} /> : null}
        {section === "configure" ? (
          <>
        {isPreviewKey(node.key) ? <Text style={i.hint}>{PREVIEW_NOTE}</Text> : null}
        <Pressable accessibilityRole="button" testID="toggle-advanced" onPress={() => setAdvanced((on) => !on)} style={pointer}><Text style={i.hint}>{advanced ? "Basic" : "Advanced"}</Text></Pressable>
        <Field label="Name" value={node.title ?? ""} placeholder={titleOfKey(node.key)} testID="field-title" onCommit={(t) => onChange(updateStep(def, node.id, { title: t }))} />
        {accountPick ? (
          <Choice
            label="Account"
            value={accountPick.value}
            testID="choose-account"
            onOpen={(x, y) => {
              const entries: MenuEntry[] = [];
              for (const item of accountPick.items) {
                const onSelect = (): void => {
                  if (!item.account) return;
                  onChange(updateStep(def, node.id, { input: applyAccount(node.input ?? {}, accountPick.field, item.account) }));
                };
                entries.push(item.checked ? { label: item.label, checked: true, onSelect } : { label: item.label, onSelect });
              }
              openMenu(entries, x, y, "other");
            }}
          />
        ) : null}
        {advanced ? (
          <Field label="Input" value={JSON.stringify(node.input ?? {}, null, 2)} testID="field-input-json" onCommit={(t) => {
            try {
              const parsed: unknown = JSON.parse(t);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setJsonError("That is not valid JSON."); return; }
              setJsonError(null);
              onChange(updateStep(def, node.id, { input: parsed as Record<string, unknown> }));
            } catch { setJsonError("That is not valid JSON."); }
          }} />
        ) : fields}
        {jsonError ? <Text style={i.hint}>{jsonError}</Text> : null}
        {inputKeys.length === 0 && kind === "plain" && !advanced && !accountPick ? <Text style={i.hint}>Nothing is set on this step yet. Add what it needs in the fields the check names below.</Text> : null}
        {kind === "ai" ? (
          <View style={i.group}>
            <Text style={i.groupHead}>Key</Text>
            {keysStatus === "empty" || keysStatus === "unavailable" ? <Text style={i.hint}>No keys yet</Text> : (
              <>
                <Choice label="Runs on" value={keyName(node.ai?.keyId)} testID="choose-key" onOpen={(x, y) => pick(x, y, (id) => onChange(updateStep(def, node.id, { ai: withKey(node.ai, "keyId", id) })), "No key")} />
                <Choice label="Backup" value={keyName(node.ai?.backupKeyId).replace("Choose a key", "No backup")} testID="choose-backup" onOpen={(x, y) => pick(x, y, (id) => onChange(updateStep(def, node.id, { ai: withKey(node.ai, "backupKeyId", id) })), "No backup")} />
                <Text style={i.hint}>A lost key falls back to the backup, then the run waits in your Needs you. It never fails silently.</Text>
              </>
            )}
          </View>
        ) : null}
        <View style={i.group}>
          <Text style={i.groupHead}>If this step fails</Text>
          <Choice
            label="Then"
            value={ERROR_MODES.find((m) => m.mode === (node.onError?.mode ?? "fail"))?.label ?? "Stop the run"}
            testID="choose-error"
            onOpen={(x, y) => openMenu(errorEntries(), x, y, "other")}
          />
          {node.onError?.mode === "retry" ? <Field label="Tries" value={String(node.onError.max ?? 3)} testID="field-retries" onCommit={(t) => onChange(updateStep(def, node.id, { onError: { mode: "retry", max: Math.max(1, Math.min(10, Number.parseInt(t, 10) || 3)) } }))} /> : null}
          {node.onError?.mode === "substitute" ? (
            <Field
              label="Result" testID="field-substitute" value={node.onError.output === undefined ? "" : JSON.stringify(node.onError.output)} placeholder="{\"ok\":false}"
              onCommit={(t) => {
                const trimmed = t.trim();
                if (!trimmed) { onChange(updateStep(def, node.id, { onError: { mode: "substitute" } })); return; }
                let output: unknown = t;
                try { output = JSON.parse(t); } catch { output = t; }
                onChange(updateStep(def, node.id, { onError: { mode: "substitute", output } }));
              }}
            />
          ) : null}
          {node.onError?.mode === "route" ? (
            <>
              <Choice
                label="Go to" value={def.nodes.find((n) => n.id === node.onError?.route)?.title ?? (node.onError.route ? titleOfKey(def.nodes.find((n) => n.id === node.onError?.route)?.key ?? "") : "Choose a step")} testID="choose-route"
                onOpen={(x, y) => openMenu(routeEntries(), x, y, "other")}
              />
              <Field
                label="Only these errors" testID="field-error-codes" value={(node.onError.codes ?? []).join(", ")} placeholder="Any error"
                onCommit={(t) => {
                  const codes = t.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
                  const route = node.onError?.route;
                  onChange(updateStep(def, node.id, { onError: { mode: "route", ...(route ? { route } : {}), ...(codes.length > 0 ? { codes } : {}) } }));
                }}
              />
            </>
          ) : null}
        </View>
        <MappingFix nodeIds={nodeIdSet(def)} value={node.input} />
        <Problems list={mine} />
        {mine.some((item) => item.severity === "error") ? <AskVyre bundle={{ resource: "automation", nodeId: node.id, stepKey: node.key, definitionVersion: version, message: mine.find((item) => item.severity === "error")?.message ?? "" }} {...(onAsk ? { onOpen: onAsk } : {})} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Delete this step" testID="delete-step" onPress={onDelete} style={[i.del, pointer]}>
          <Glyph name="x" size={13} color="var(--danger)" />
          <Text style={i.delText}>Delete this step</Text>
        </Pressable>
          </>
        ) : null}
      </ScrollView>
      {element}
    </View>
  );
}

function Head({ title, sub, onClose }: { title: string; sub: string; onClose(): void }): ReactElement {
  return (
    <View style={i.head}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={i.title}>{title}</Text>
        <Text numberOfLines={1} style={i.sub}>{sub}</Text>
      </View>
      <IconButton icon="x" label="Close the step panel" onPress={onClose} testID="close-inspector" />
    </View>
  );
}

function Problems({ list }: { list: readonly Issue[] }): ReactElement | null {
  if (list.length === 0) return null;
  const rows: ReactElement[] = [];
  list.forEach((p, n) => rows.push(
    <View key={`${p.message}-${n}`} style={i.problem}>
      <Glyph name="warn" size={13} color={p.severity === "error" ? "var(--danger)" : "var(--warn)"} />
      <Text style={i.problemText}>{p.message}</Text>
    </View>,
  ));
  return (
    <View style={i.group} testID="step-problems" accessibilityRole="alert">
      <Text style={i.groupHead}>{list.some((x) => x.severity === "error") ? "To fix" : "To check"}</Text>
      {rows}
    </View>
  );
}

/** A labelled text field. The value commits on blur and on Enter; Escape puts the old value back. */
function Field({ label, value, onCommit, placeholder, mono = false, readOnly = false, testID }: { label: string; value: string; onCommit(v: string): void; placeholder?: string; mono?: boolean; readOnly?: boolean; testID?: string }): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const done = (): void => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); };
  return (
    <View style={i.field}>
      <Text style={i.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={shown}
        editable={!readOnly}
        placeholder={placeholder}
        placeholderTextColor="var(--ink-4)"
        onChangeText={setDraft}
        onBlur={done}
        onSubmitEditing={done}
        {...webOnly({ onKeyDown: (e: { key?: string }) => { if (e.key === "Escape") setDraft(null); } })}
        style={[i.input, mono && { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }, readOnly && { opacity: 0.6 }]}
      />
    </View>
  );
}

function Choice({ label, value, onOpen, testID }: { label: string; value: string; onOpen(x: number, y: number): void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <View style={i.field}>
      <Text style={i.label}>{label}</Text>
      <Pressable
        accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} testID={testID}
        onPress={(e) => { const ev = e as unknown as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }; const r = ev.currentTarget?.getBoundingClientRect?.(); onOpen(r?.left ?? ev.nativeEvent?.pageX ?? 0, (r?.bottom ?? ev.nativeEvent?.pageY ?? 0) + 4); }}
        onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
        style={[i.choice, over && { backgroundColor: "var(--hover)" as string }, pointer]}
      >
        <Text numberOfLines={1} style={i.choiceText}>{value}</Text>
        <Glyph name="chevD" size={12} color="var(--ink-3)" />
      </Pressable>
    </View>
  );
}

void ps;

const i = StyleSheet.create({
  pane: { width: 300, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  embedded: { width: "100%" as unknown as number, flex: 1, borderLeftWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 52, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { padding: 14, gap: 12 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  input: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 9, fontSize: 13, color: "var(--ink)" as string },
  group: { gap: 8, paddingTop: 6 },
  groupHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  choice: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  choiceText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  problem: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  problemText: { flex: 1, fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string },
  del: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 9, borderRadius: 7, marginTop: 6 },
  delText: { fontSize: 13, color: "var(--danger)" as string },
});
