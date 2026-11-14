// ui/ConnectCard: the one card for connecting a service (finding F38, owner 14 Nov 2026: "yes build the connect card, keep Mine"). Design: team/v1/DESIGN-connect-card-2026-11-14.md; picture: team/v1/prototypes/shots-connect.
// It draws a state the server already decided (the container reads it from vault.connect_card.get); it never works one out. Eight states: ask, have, admin, asked, connected, wrong, offline, later. While a try is in flight
// (`work`) the fields lock and a line of steps shows after 300 ms (the container holds that delay): Checked, Connected, Saved.
// Where it is kept is one quiet row, "Kept in Mine", that opens a menu (the container builds it). Every control is a real button reachable by pointer and keyboard. A typed value stays in the field's own state and in the one
// call that submits it. Colours are skin tokens only.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Card, CardActions, CardHead, s as cardStyles } from "../Card/index.tsx";
import type { CardActionSpec } from "../Card/index.tsx";
import { Glyph } from "../Composer/shared.tsx";
import { RADIUS } from "../tokens/radius.ts";

export type ConnectState = "ask" | "have" | "admin" | "asked" | "connected" | "wrong" | "offline" | "later";
export interface ConnectField {
  name: string;
  label: string;
  optional: boolean;
}
/** The steps of a try in flight: `step` is the one in progress, and every step before it is done. A step equal to the length means all are done. */
export interface ConnectWork {
  steps: readonly string[];
  step: number;
  /** false for the first 300 ms: the fields lock and nothing else shows yet */
  visible: boolean;
}

export interface ConnectCardProps {
  id: string;
  state: ConnectState;
  /** "Fathom" */
  service: string;
  /** The app's own page, where its keys are found. */
  site?: string | undefined;
  /** "Dex": who will use it. */
  agent: string;
  fields: readonly ConnectField[];
  values: Readonly<Record<string, string>>;
  onChange(name: string, value: string): void;
  work?: ConnectWork | null;
  /** "Mine", "Marketing": where the key is kept, or will be. */
  keptIn: string;
  /** Opens the Kept in menu from the row that was pressed. */
  onKeptIn?: ((anchor: { x: number; y: number }) => void) | undefined;
  /** Already have one: the saved key's words ("Mine, added 3 Nov"). */
  have?: { name: string; where: string } | undefined;
  /** Needs an admin: their name, and when they were asked ("10:21"). */
  admin?: string | undefined;
  askedAt?: string | undefined;
  /** Connected: what was tested, who can use it, who connected it (an admin did, not you). */
  tested?: string | undefined;
  /** Ask: the host a typed key is tried against, said when the connector is not built in, so Connect is an informed yes. */
  checksWith?: string | undefined;
  /** One line when a typed key was kept but could not be connected ("Your key is saved in Mine. Couldn't connect."). */
  notice?: string | undefined;
  usedBy?: string | undefined;
  connectedBy?: string | undefined;
  open: boolean;
  onToggle(): void;
  /** Wrong key: the field to put the cursor in, once. */
  focusField?: string | undefined;
  on: {
    connect(): void;
    retry(): void;
    notNow(): void;
    askAdmin(): void;
    reopen(): void;
    disconnect(): void;
    useDifferent(): void;
  };
}

const KEY =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="10.5" r="2.7"/><path d="M7.6 8.4L13.5 2.5M11.2 4.8l1.8 1.8"/></svg>';
const TICK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>';
const EYE =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/></svg>';
const CHEV =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5l3 3 3-3"/></svg>';
const CHEV_RIGHT =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4.5l3.500 3.500-3.500 3.500"/></svg>';
const DASH =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="5.500"/><path d="M5.700 8h4.600"/></svg>';
const WARN =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.800"/><path d="M8 5v3.500M8 10.800v.1"/></svg>';

/** The lock-in line of a try: Checked, Connected, Saved, each ticking as the server confirms it. */
function WorkLine({ id, work }: { id: string; work: ConnectWork }): ReactElement {
  return (
    <View
      testID={`${id}-work`}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      style={[st.work, !work.visible && st.workWait]}
    >
      {/* ui-rows-lint: not a list (the three steps of one try, in a line) */}
      {work.steps.map((label, i) => {
        const done = i < work.step;
        const now = i === work.step;
        return (
          <View key={label} style={st.step} testID={`${id}-step-${i}`}>
            {done ? (
              <Glyph icon={TICK} native="✓" size={13} color="var(--ok)" />
            ) : now ? (
              <View
                {...({ dataSet: { cardRing: "" } } as object)}
                style={[cardStyles.ring, { borderColor: "var(--ink-3)" }]}
              />
            ) : (
              <View style={st.stepGap} />
            )}
            <Text style={[st.stepText, (done || now) && { color: "var(--ink-2)" }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SecretField({
  id,
  field,
  value,
  onChange,
  locked,
  error,
  site,
  first,
  autoFocus,
}: {
  id: string;
  field: ConnectField;
  value: string;
  onChange(v: string): void;
  locked: boolean;
  error: string | null;
  site?: string | undefined;
  first: boolean;
  autoFocus: boolean;
}): ReactElement {
  const [shown, setShown] = useState(false);
  const [focus, setFocus] = useState(false);
  const paste = async (): Promise<void> => {
    let text = "";
    try {
      text =
        (await (
          globalThis as { navigator?: { clipboard?: { readText(): Promise<string> } } }
        ).navigator?.clipboard?.readText()) ?? "";
    } catch {
      /* the browser kept the clipboard: the person pastes with the keyboard */
    }
    if (text) onChange(text.trim());
  };
  const bad = error !== null;
  return (
    <View style={st.field}>
      <View style={st.labelRow}>
        <Text style={st.label} nativeID={`${id}-label`}>
          {field.label}
        </Text>
        {field.optional ? <Text style={st.optional}>Optional</Text> : null}
        <View style={{ flex: 1 }} />
        {first && site ? (
          <Text
            accessibilityRole="link"
            testID={`${id}-find`}
            style={st.link}
            {...({ href: site, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } as object)}
          >
            Where to find it
          </Text>
        ) : null}
      </View>
      <View style={[st.inputRow, focus && st.inputFocus, bad && st.inputBad, locked && { opacity: 0.6 }]}>
        <TextInput
          testID={`${id}-input`}
          accessibilityLabel={field.label}
          value={value}
          onChangeText={onChange}
          editable={!locked}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoFocus={autoFocus}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          {...(bad ? { "aria-invalid": true } : {})}
          style={st.input}
        />
        {!value && !locked ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paste ${field.label.toLowerCase()}`}
            testID={`${id}-paste`}
            onPress={() => void paste()}
            style={st.inlineBtn}
          >
            <Text style={st.inlineText}>Paste</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${shown ? "Hide" : "Show"} ${field.label.toLowerCase()}`}
          accessibilityState={{ checked: shown }}
          testID={`${id}-eye`}
          onPress={() => {
            setShown(!shown);
          }}
          style={st.inlineBtn}
        >
          <Glyph icon={shown ? EYE_OFF : EYE} native="o" size={16} color="var(--ink-3)" />
        </Pressable>
      </View>
      <View style={st.under}>
        {bad ? (
          <>
            <Glyph icon={WARN} native="!" size={13} color="var(--danger)" />
            <Text accessibilityRole="alert" style={st.err}>
              {error}
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

export function ConnectCard(p: ConnectCardProps): ReactElement {
  const { id, state, service, on } = p;
  const working = Boolean(p.work);
  const label = `Connect ${service}`;
  const filled = p.fields.every((f) => f.optional || (p.values[f.name] ?? "").trim() !== "");

  if (state === "connected")
    return (
      <View testID={id} accessibilityRole="summary" accessibilityLabel={`${service} is connected`} style={st.fold}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: p.open }}
          accessibilityLabel={`${service}, connected. ${p.open ? "Hide" : "Show"} details`}
          testID={`${id}-row`}
          onPress={p.onToggle}
          style={st.foldRow}
        >
          <Glyph icon={TICK} native="✓" size={14} color="var(--ok)" />
          <Text style={st.foldName}>{service}</Text>
          <Text style={st.foldState}>Connected</Text>
          <View style={{ flex: 1 }} />
          <Text style={st.foldWhere}>{`Kept in ${p.keptIn}`}</Text>
          <Glyph icon={p.open ? CHEV : CHEV_RIGHT} native=">" size={14} color="var(--ink-3)" />
        </Pressable>
        {p.open ? (
          <View style={st.details} testID={`${id}-details`}>
            {p.tested ? <Detail name="Tested" value={p.tested} /> : null}
            {p.usedBy ? <Detail name="Used by" value={p.usedBy} /> : null}
            {p.connectedBy ? <Detail name="Connected by" value={p.connectedBy} /> : null}
            <View style={st.detailActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Disconnect ${service}`}
                testID={`${id}-disconnect`}
                onPress={on.disconnect}
                style={st.disconnect}
              >
                <Text style={st.disconnectText}>Disconnect</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );

  if (state === "later")
    return (
      <View testID={id} accessibilityRole="summary" accessibilityLabel={`${service} is not connected`} style={st.fold}>
        <View style={st.foldRow}>
          <Glyph icon={DASH} native="-" size={14} color="var(--ink-3)" />
          <Text style={[st.foldName, { color: "var(--ink-2)" }]}>{`${service} isn't connected`}</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Connect ${service}`}
            testID={`${id}-reopen`}
            onPress={on.reopen}
            style={st.smallBtn}
          >
            <Text style={st.smallBtnText}>Connect</Text>
          </Pressable>
        </View>
      </View>
    );

  const sub =
    state === "ask" || state === "wrong" || state === "offline" || state === "have"
      ? `${p.agent} will use it for you.`
      : undefined;
  const notNow: CardActionSpec = { label: "Not now", onPress: on.notNow, testID: `${id}-later` };

  return (
    <Card
      kind="input"
      testID={id}
      label={label}
      {...(!working && (state === "ask" || state === "wrong") && filled ? { onEnter: on.connect } : {})}
    >
      <CardHead
        lead={<Glyph icon={KEY} native="k" size={16} color="var(--ink-3)" />}
        title={label}
        {...(sub ? { meta: sub } : {})}
      />
      {state === "ask" || state === "wrong" || state === "offline" ? (
        <View style={st.col}>
          {/* ui-rows-lint: not a list (one secure field for each thing the service needs) */}
          {p.fields.map((f, i) => (
            <SecretField
              key={f.name}
              id={`${id}-${f.name}`}
              field={f}
              value={p.values[f.name] ?? ""}
              onChange={(v) => p.onChange(f.name, v)}
              locked={working || state === "offline"}
              error={state === "wrong" && i === 0 ? `${service} didn't accept this key.` : null}
              site={p.site}
              first={i === 0}
              autoFocus={state === "wrong" && p.focusField === f.name}
            />
          ))}
          {p.notice && !working ? (
            <View style={st.line} testID={`${id}-notice`}>
              <Glyph icon={WARN} native="!" size={14} color="var(--warn)" />
              <Text accessibilityRole="alert" style={st.lineText}>{p.notice}</Text>
            </View>
          ) : null}
          {p.checksWith && !working ? (
            <Text style={st.sub} testID={`${id}-checks`}>{`Checks with ${p.checksWith}`}</Text>
          ) : null}
          <KeptRow id={id} keptIn={p.keptIn} onOpen={working || state === "offline" ? undefined : p.onKeptIn} />
          {working ? (
            <WorkLine id={id} work={p.work!} />
          ) : state === "offline" ? (
            <>
              <View style={st.line} testID={`${id}-offline`}>
                <Glyph icon={WARN} native="!" size={14} color="var(--warn)" />
                <Text accessibilityRole="alert" style={st.lineText}>{`Couldn't reach ${service}.`}</Text>
              </View>
              <CardActions
                primary={{ label: "Retry", onPress: on.retry, testID: `${id}-retry` }}
                secondary={[notNow]}
              />
            </>
          ) : (
            <CardActions
              primary={{ label: "Connect", onPress: on.connect, testID: `${id}-connect` }}
              secondary={[notNow]}
            />
          )}
        </View>
      ) : null}
      {state === "have" ? (
        <View style={st.col}>
          {p.notice && !working ? (
            <View style={st.line} testID={`${id}-notice`}>
              <Glyph icon={WARN} native="!" size={14} color="var(--warn)" />
              <Text accessibilityRole="alert" style={st.lineText}>{p.notice}</Text>
            </View>
          ) : null}
          <View style={st.have} testID={`${id}-have`}>
            <Text style={st.haveName}>{`Use your saved ${service} key`}</Text>
            {p.have ? <Text style={st.haveWhere}>{p.have.where}</Text> : null}
          </View>
          {working ? (
            <WorkLine id={id} work={p.work!} />
          ) : (
            <CardActions
              primary={{ label: "Connect", onPress: on.connect, testID: `${id}-connect` }}
              secondary={[{ label: "Use a different key", onPress: on.useDifferent, testID: `${id}-other` }, notNow]}
            />
          )}
        </View>
      ) : null}
      {state === "admin" ? (
        <View style={st.col}>
          <Text style={st.lineText}>Only admins can connect services in this Space.</Text>
          <CardActions
            primary={{
              label: p.admin ? `Ask ${p.admin}` : "Ask an admin",
              onPress: on.askAdmin,
              testID: `${id}-ask`,
            }}
            secondary={[notNow]}
          />
        </View>
      ) : null}
      {state === "asked" ? (
        <View style={st.col}>
          <Text style={st.lineText} testID={`${id}-asked`}>
            {`Asked ${p.admin ?? "an admin"}`}
            {p.askedAt ? <Text style={st.when}>{`  at ${p.askedAt}`}</Text> : null}
          </Text>
          <Text style={st.sub}>{`This card finishes when ${p.admin ?? "they"} connect${p.admin ? "s" : ""} it.`}</Text>
          <CardActions secondary={[notNow]} />
        </View>
      ) : null}
    </Card>
  );
}

function Detail({ name, value }: { name: string; value: string }): ReactElement {
  return (
    // ui-rows-lint: not a list (the labelled facts of one connected row)
    <View style={st.detail}>
      <Text style={st.detailName}>{name}</Text>
      <Text style={st.detailValue}>{value}</Text>
    </View>
  );
}

/** One quiet row: where the key is kept. A button that opens the menu, or the same words locked while a try runs. */
function KeptRow({
  id,
  keptIn,
  onOpen,
}: {
  id: string;
  keptIn: string;
  onOpen: ((anchor: { x: number; y: number }) => void) | undefined;
}): ReactElement {
  const press = (e: unknown): void => {
    const box = (
      e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } } | null
    )?.currentTarget?.getBoundingClientRect?.();
    onOpen?.({ x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 });
  };
  const words = (
    <>
      <Text style={st.keptLabel}>Kept in</Text>
      <Text style={st.keptValue}>{keptIn}</Text>
      {onOpen ? <Glyph icon={CHEV} native="v" size={14} color="var(--ink-3)" /> : null}
    </>
  );
  return onOpen ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Kept in ${keptIn}`}
      accessibilityHint="Choose where the key is kept"
      aria-haspopup="menu"
      testID={`${id}-kept`}
      onPress={press}
      style={st.kept}
    >
      {words}
    </Pressable>
  ) : (
    <View testID={`${id}-kept`} style={st.kept}>
      {words}
    </View>
  );
}

const st = StyleSheet.create({
  col: { gap: 10 },
  field: { gap: 4 },
  labelRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  label: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  optional: { fontSize: 12, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string, textDecorationLine: "none" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: "var(--field-line)" as string,
    backgroundColor: "var(--field)" as string,
  },
  inputFocus: { borderColor: "var(--accent)" as string },
  inputBad: { borderColor: "var(--danger)" as string },
  input: { flex: 1, minWidth: 0, height: 34, fontSize: 13, color: "var(--ink)" as string },
  inlineBtn: {
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS,
  },
  inlineText: { fontSize: 12.5, color: "var(--accent)" as string },
  under: { minHeight: 16, flexDirection: "row", alignItems: "center", gap: 5 },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  kept: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, alignSelf: "flex-start" },
  keptLabel: { fontSize: 12.5, color: "var(--ink-3)" as string },
  keptValue: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  work: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 32 },
  workWait: { opacity: 0 },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepGap: { width: 13 },
  stepText: { fontSize: 12.5, color: "var(--ink-4)" as string },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineText: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  when: { fontSize: 12.5, color: "var(--ink-3)" as string },
  sub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
  have: { gap: 2, padding: 10, borderRadius: RADIUS, backgroundColor: "var(--sel)" as string },
  haveName: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  haveWhere: { fontSize: 12.5, color: "var(--ink-3)" as string },
  fold: {
    marginTop: 8,
    borderRadius: RADIUS,
    backgroundColor: "var(--side)" as string,
    alignSelf: "stretch",
    maxWidth: 560,
  },
  foldRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 12 },
  foldName: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  foldState: { fontSize: 12.5, color: "var(--ink-3)" as string },
  foldWhere: { fontSize: 12.5, color: "var(--ink-3)" as string },
  details: { gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  detail: { flexDirection: "row", gap: 10 },
  detailName: { width: 96, fontSize: 12.5, color: "var(--ink-3)" as string },
  detailValue: { flex: 1, fontSize: 12.5, color: "var(--ink)" as string },
  detailActions: { flexDirection: "row", marginTop: 4 },
  disconnect: { minHeight: 32, paddingHorizontal: 4, justifyContent: "center" },
  disconnectText: { fontSize: 13, color: "var(--danger)" as string },
  smallBtn: {
    minHeight: 28,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS,
    backgroundColor: "var(--hover)" as string,
  },
  smallBtnText: { fontSize: 12.5, color: "var(--ink)" as string },
});
