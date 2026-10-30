// The step panel: opens beside the canvas when a card is selected. A name, the account the step was given, the step's own fields (one text field per input, in words; the HTTP request, Run code
// and AI steps have forms of their own in steps/), what happens when the step fails, and the problems the check found for this step. Every change goes through `onChange` as a new definition, so Undo and Save see it like any other edit.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { AskVyre } from "../ask/AskVyre.tsx";
import type { AskBundle } from "../ask/bundle.ts";
import { installFocusRing } from "../a11y.ts";
import { accountFixedLine, BUILDER_MODES, VAL_LABEL } from "../chrome.ts";
import type { BuilderMode } from "../chrome.ts";
import { accountDefaultInput, accountMenu, applyAccount } from "../connect/accounts.ts";
import type { AccountOption } from "../connect/accounts.ts";
import { fieldsFromSchema, asFixture } from "../builder/fields.ts";
import { MessageComposer } from "../builder/MessageComposer.tsx";
import { DataShelf, MappingFix, SectionRow, advancedInputEdit, basicFieldEdit, commitTyped, nodeIdSet } from "../builder/marks.tsx";
import { Choice, Field, MapTargetContext } from "./fields.tsx";
import type { MapTarget } from "./fields.tsx";
import { frameFor } from "./frame.ts";
import type { StudioLayout } from "./frame.ts";
import { RunStepIo } from "../builder/RunStepIo.tsx";
import { StepTest } from "../builder/StepTest.tsx";
import { CONNECT_LIMIT } from "../connect/trust-view.ts";
import { presenceOf } from "../values/typed.ts";
import { Glyph } from "./icons.tsx";
import { ERROR_MODES, groupOfKey, iconOfKey, kindOfKey, setBranch, setTriggerConfig, subtitleOf, titleOfKey, updateStep, triggerMeta } from "./model.ts";
import type { IconKey } from "./model.ts";
import type { DefNode, DefTrigger, Definition, Issue, KeyChoice } from "./model.ts";
import { LiveStepForm } from "./steps/LiveStepForm.tsx";
import type { KeysStatus } from "./data.tsx";
import { SendApproval, sendsOutward } from "./AskBeforeSending.tsx";
import { IconButton, pointer, s as ps, webOnly } from "./parts.tsx";

const humanize = (k: string): string => k.replace(/([A-Z])/g, " $1").replace(/[_.]+/g, " ").replace(/^./, (x) => x.toUpperCase());
const show = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function Inspector({ def, node, trigger, triggerIndex, issues, keys, onChange, onClose, onDelete, testID = "inspector", embedded = false, layout, initialAdvanced = false, mode = "basic", onMode, section = "configure", onSection, samples = {}, version = 0, onStoreSample, onAsk, keysStatus, accounts = [], inputSchema, lastPicks, kind: automationKind = "personal", runId, runLog }: {
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
  /** Desktop keeps the 300px side column. Compact stacks the panel at full width. */
  layout?: StudioLayout;
  /** Open on Advanced so a test can show the JSON editor. The toggle still switches. */
  initialAdvanced?: boolean;
  /** When the builder header owns Basic and Advanced, this panel does not draw a second segment. */
  mode?: BuilderMode;
  onMode?(next: BuilderMode): void;
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
  /** Personal or Space: an AI step runs on its owner's own account in the first and on a key shared with the Space in the second. */
  kind?: "personal" | "space";
  /** The run being shown on the canvas. Its log for this step is on the Test tab. */
  runId?: string;
  /** The log of that step already read, for a screen that paints before the read answers. */
  runLog?: unknown;
}): ReactElement {
  const { element, show: openMenu } = useMenu();
  const [mapTarget, setMapTarget] = useState<MapTarget | null>(null);
  const ordered = layout ? frameFor(layout).ordered : false;
  useEffect(() => { installFocusRing(); }, []);
  const headerMode = onMode !== undefined;
  const [localAdvanced, setLocalAdvanced] = useState(initialAdvanced);
  const advanced = headerMode ? mode === "advanced" : localAdvanced;
  const setAdvanced = (next: boolean): void => {
    if (headerMode) onMode?.(next ? "advanced" : "basic");
    else setLocalAdvanced(next);
  };
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
      <View style={paneStyle(embedded, layout)} testID={testID} accessibilityLabel="Trigger settings" {...webOnly({ dataSet: { vyreFocus: "1" } })}>
        <Head title={meta?.title ?? "Trigger"} sub="Trigger" icon={meta?.icon ?? "bolt"} onClose={onClose} />
        <ScrollView contentContainerStyle={i.body}>
          <SectionRow section={section} ordered={ordered} onSection={(next) => onSection?.(next)} />
          {section === "data" ? <DataShelf triggerSample={samples["trigger"]} steps={prior} target={mapTarget} onPick={(_id, _expression, next) => { mapTarget?.commit(next); setMapTarget(null); }} /> : null}
          {section === "test" ? <Text style={i.hint}>Pick a step to test it.</Text> : null}
          {section === "configure" ? (
            <>
              <Text testID="plain-language" style={i.hint}>{trigger ? `This is trigger ${(triggerIndex ?? 0) + 1} of ${def.triggers.length}. Any one of them starts a run.` : "Every trigger is listed on the card. Any one starts a run."}</Text>
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
  const live = kind === "http" || kind === "code" || kind === "ai";
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
  const composer = node.key === "send_email" || node.key === "send_sms";
  const fixedAccount = accountFixedLine(accountPick?.value);
  const hidden = new Set(node.key === "send_email"
    ? ["subject", "body", "to", "cc", "fileIds", "message"]
    : node.key === "send_sms"
      ? ["body", "to", "message", "mediaFileIds"]
      : []);
  const skipAccount = (name: string): boolean => !!accountPick && (name === "connectionId" || name === "mailboxId" || name === "numberId" || (accountPick.field === "connectionId" && name === "connector"));
  const skipField = (name: string): boolean => skipAccount(name) || (composer && hidden.has(name));
  const writeInput = (name: string, next: unknown): void => {
    const input = { ...node.input };
    if (next === undefined) delete input[name];
    else input[name] = next;
    onChange(updateStep(def, node.id, { input }));
  };
  const schemaFields = fieldsFromSchema(inputSchema, node.input ?? {});
  const covered = new Set(schemaFields.map((field) => field.name));
  for (const field of schemaFields) {
    if (skipField(field.name)) continue;
    const current = node.input[field.name];
    const label = `${humanize(field.name)}${field.presence === "value" ? "" : ` (${field.presence})`}`;
    if (field.enumValues.length > 0 && field.enumValues.length <= 8) {
      fields.push(
        <Choice
          key={`${node.id}-${field.name}`}
          label={label}
          value={typeof current === "string" && current.length > 0 ? current : "Choose"}
          testID={`field-${field.name}`}
          onOpen={(x, y) => openMenu(field.enumValues.map((item) => ({
            label: item,
            checked: current === item,
            onSelect: () => writeInput(field.name, item),
          })), x, y, "other")}
        />,
      );
      continue;
    }
    fields.push(<Field key={`${node.id}-${field.name}`} label={label} value={show(current)} placeholder={field.enumValues.length > 0 ? field.enumValues.join(", ") : field.required ? "Required" : "Optional"} testID={`field-${field.name}`} onCommit={(t) => {
      onChange(updateStep(def, node.id, { input: basicFieldEdit(node.input ?? {}, field.name, t) }));
    }} />);
  }
  for (const k of inputKeys) {
    if (covered.has(k) || skipField(k)) continue;
    fields.push(<Field key={`${node.id}-${k}`} label={humanize(k)} value={show(node.input[k])} testID={`field-${k}`} onCommit={(t) => {
      onChange(updateStep(def, node.id, { input: basicFieldEdit(node.input ?? {}, k, t) }));
    }} />);
  }
  return (
    <MapTargetContext.Provider value={{ set: setMapTarget }}>
    <View style={paneStyle(embedded, layout)} testID={testID} accessibilityLabel={`${node.title ?? titleOfKey(node.key)} settings`} {...webOnly({ dataSet: { vyreFocus: "1" } })}>
      <Head title={node.title ?? titleOfKey(node.key)} sub={groupOfKey(node.key)} icon={iconOfKey(node.key)} onClose={onClose} />
      <ScrollView contentContainerStyle={i.body} keyboardShouldPersistTaps="handled">
        <SectionRow section={section} ordered={ordered} onSection={(next) => onSection?.(next)} />
        {section === "data" ? <DataShelf triggerSample={samples["trigger"]} steps={prior} target={mapTarget} onPick={(_id, _expression, next) => { mapTarget?.commit(next); setMapTarget(null); }} /> : null}
        {section === "test" && runId ? <RunStepIo runId={runId} stepId={node.id} {...(runLog !== undefined ? { ready: runLog } : {})} /> : null}
        {section === "test" ? <StepTest stepKey={node.key} nodeId={node.id} input={node.input ?? {}} version={version} samples={samples} onUseOutput={(output) => onStoreSample?.(node.id, asFixture(version, node.key, output))} /> : null}
        {section === "configure" ? (
          <>
        {node.key === "connector_request" ? <Text style={i.hint}>{`${CONNECT_LIMIT} The request runs a named action on the connection.`}</Text> : null}
        <Text testID="plain-language" style={i.hint}>{subtitleOf(node, { key: (id) => keys.find((k) => k.id === id)?.name ?? id })}</Text>
        {headerMode ? null : (
          <View accessibilityLabel="Builder mode" testID="inspector-mode" style={i.seg}>
            {/* ui-rows-lint: not a list (Basic and Advanced toggle) */}
            {BUILDER_MODES.map((label) => {
              const on = (label === "Advanced") === advanced;
              return (
                <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} testID={label === "Advanced" ? "toggle-advanced" : "toggle-basic"} onPress={() => setAdvanced(label === "Advanced")} style={[i.segBtn, on && i.segBtnOn, pointer]}>
                  <Text style={[i.segText, on && i.segTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
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
        {fixedAccount ? <Text testID="account-fixed" style={i.hint}>{fixedAccount}</Text> : null}
        {live ? <LiveStepForm def={def} node={node} onChange={onChange} openMenu={openMenu} kind={automationKind} keys={keys} /> : null}
        {composer ? <MessageComposer stepKey={node.key} nodeId={node.id} input={node.input ?? {}} samples={samples} onInput={(input) => onChange(updateStep(def, node.id, { input }))} /> : null}
        {live ? null : fields}
        {advanced ? (
          <Field label={VAL_LABEL} value={JSON.stringify(node.input ?? {}, null, 2)} testID="field-input-json" onCommit={(t) => {
            const edited = advancedInputEdit(t);
            if (!edited.ok) { setJsonError(edited.message); return; }
            setJsonError(null);
            onChange(updateStep(def, node.id, { input: edited.input }));
          }} />
        ) : null}
        {jsonError ? <Text style={i.hint}>{jsonError}</Text> : null}
        {inputKeys.length === 0 && kind === "plain" && !advanced && !accountPick ? <Text style={i.hint}>Nothing is set on this step yet. Add what it needs in the fields the check names below.</Text> : null}
        {sendsOutward(node.key) && !(node.key === "http_request" && (node.input?.["method"] === undefined || node.input["method"] === "GET" || node.input["method"] === "HEAD")) ? <SendApproval on={node.askBeforeSending === true} onSet={(next) => onChange(updateStep(def, node.id, { askBeforeSending: next }))} /> : null}
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
              label="Result" testID="field-substitute" value={node.onError.output === undefined ? "" : JSON.stringify(node.onError.output)} placeholder={'{"ok":false}'}
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
    </MapTargetContext.Provider>
  );
}

function Head({ title, sub, icon, onClose }: { title: string; sub: string; icon: IconKey; onClose(): void }): ReactElement {
  return (
    <View style={i.head}>
      <View style={i.tile}><Glyph name={icon} size={16} color="var(--ink-2)" /></View>
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

void ps;

function paneStyle(embedded: boolean, layout?: StudioLayout) {
  const frame = layout ? frameFor(layout) : null;
  return [i.pane, (embedded || frame?.compact) ? i.embedded : null, frame ? { width: frame.inspectorWidth } : null];
}

const i = StyleSheet.create({
  pane: { width: 300, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  embedded: { width: "100%" as unknown as number, flex: 1, borderLeftWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, height: 52, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  tile: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  seg: { flexDirection: "row", gap: 2, alignSelf: "flex-start", padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  segBtn: { paddingHorizontal: 10, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segBtnOn: { backgroundColor: "var(--win)" as string },
  segText: { fontSize: 12, color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "600" },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 11.5, color: "var(--ink-3)" as string },
  body: { padding: 14, gap: 12 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  field: { gap: 4 },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  input: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, paddingHorizontal: 9, fontSize: 13, color: "var(--ink)" as string },
  group: { gap: 8, paddingTop: 6 },
  groupHead: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  choice: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)" as string, backgroundColor: "var(--field)" as string, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  choiceText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  problem: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  problemText: { flex: 1, fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string },
  del: { flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 9, borderRadius: 7, marginTop: 6 },
  delText: { fontSize: 13, color: "var(--danger)" as string },
});
