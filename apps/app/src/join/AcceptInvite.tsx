// join/AcceptInvite: the invite landing, the three account steps, the setup run and the finish (spec 3.13, ARCH 7.13).
// Landing: Open in Vyre, Download Vyre, Continue in the browser, and Sign in for people who already have an account.
// Steps: welcome with name and photo, the sign-in (username, password, strength), this device (name, trust, recovery code), then ConnectAI.
// The page is presentational: the stage machine lives in logic.ts and JoinFlow.tsx owns the timers and the calls.
import { createElement } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import type { Dispatch, ReactNode } from "react";
import { ConnectAI } from "./ConnectAI.tsx";
import {
  AppIcon, Bar, Button, Caption, Check, ErrorLine, FieldRow, Foot, Group, LetterTile, Meter, Panel, Progress, Row, Sheet, Step, Switch, TextButton, Title, CheckBox,
  baseText, useJoin,
} from "./kit.tsx";
import { MONO } from "./palette.ts";
import { RUN_STEPS, initials, meter, strength, suggestions, usernameOk, valid, cleanUsername } from "./logic.ts";
import type { Action, FlowState, JoinInvite, Rules } from "./logic.ts";

export interface AcceptInviteProps {
  invite: JoinInvite;
  state: FlowState;
  dispatch: Dispatch<Action>;
  rules: Rules;
  expired?: boolean;
  onOpenApp?: () => void;
  onDownload?: () => void;
  onPickPhoto?: () => void;
  onCopyCode?: (code: string) => void;
  onSaveCode?: (code: string) => void;
  newCode: () => string;
  onEmail?: (to: string) => void;
  onOpen?: () => void;
}

const STEPS = 4;

// ---- landing and expired

function Landing({ invite, onOpenApp, onDownload, dispatch, state }: Pick<AcceptInviteProps, "invite" | "onOpenApp" | "onDownload" | "dispatch" | "state">) {
  const { p } = useJoin();
  return (
    <Step id="accept" dir={state.dir}>
      <AppIcon kind="space" letter={invite.space} />
      <Title title={`Join ${invite.space}`} sub={`${invite.by} invited you to join as a ${invite.role}.`} />
      <Group>
        <Row kind="action" testID="open-app" label="Open in Vyre" note="Installed" onPress={() => { onOpenApp?.(); dispatch({ t: "web" }); }} />
        <Row kind="action" testID="download" label="Download Vyre" note={state.note === "dl" ? "Downloading…" : "Mac, Windows, Linux"} onPress={() => { onDownload?.(); dispatch({ t: "set", patch: { note: "dl" } }); }} />
        <Row kind="action" testID="web" label="Continue in the browser" onPress={() => dispatch({ t: "web" })} />
      </Group>
      <Foot>The app keeps your files on this computer. The browser works anywhere, with less offline.</Foot>
      <Text style={[baseText(p), { fontSize: 13, lineHeight: 18, color: p.tx2, textAlign: "center", marginTop: 20, marginHorizontal: 16 }]}>
        Already have an account? <Text accessibilityRole="link" testID="have-account" onPress={() => dispatch({ t: "signin" })} style={{ color: p.blue }}>Sign in</Text>
      </Text>
    </Step>
  );
}

function Expired({ invite, onEmail }: Pick<AcceptInviteProps, "invite" | "onEmail">) {
  const { p } = useJoin();
  const first = invite.by.split(" ")[0] ?? invite.by;
  return (
    <Step id="expired">
      <AppIcon kind="clock" />
      <Title title="This invite has expired" sub={`Ask ${invite.by} for a new one.`} />
      <View style={{ alignItems: "center", marginTop: 24 }}>
        <Button large testID="email-inviter" label={`Email ${first}`} onPress={() => invite.email && onEmail?.(invite.email)} />
        {invite.email ? <Text selectable style={[baseText(p), { marginTop: 14, fontSize: 13, color: p.tx2 }]}>{invite.email}</Text> : null}
      </View>
    </Step>
  );
}

// ---- steps

function Photo({ state, onPick }: { state: FlowState; onPick?: () => void }) {
  const { p } = useJoin();
  return (
    <View style={{ alignItems: "center", marginTop: 24 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Change photo" testID="photo" onPress={onPick} style={{ width: 72, height: 72, borderRadius: 36 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#8E8E95", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "600", letterSpacing: 0.3 }}>{initials(state)}</Text>
        </View>
        <View style={{ position: "absolute", right: -4, bottom: -4, width: 26, height: 26, borderRadius: 13, backgroundColor: p.cam, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.panel }}>
          {Platform.OS === "web"
            ? createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, "data-icon": "camera", fill: "none", stroke: p.tx, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" },
              createElement("path", { d: "M2 5.6A1.4 1.4 0 013.4 4.2h1.1l.7-1.2h5.6l.7 1.2h1.1A1.4 1.4 0 0114 5.6v6A1.4 1.4 0 0112.6 13H3.4A1.4 1.4 0 012 11.6z" }),
              createElement("circle", { cx: 8, cy: 8.6, r: 2.3 }))
            : <Text style={{ color: p.tx, fontSize: 11 }}>+</Text>}
        </View>
      </Pressable>
    </View>
  );
}

function Welcome({ invite, state, dispatch, onPickPhoto, rules }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "onPickPhoto" | "rules">) {
  const set = (patch: Partial<FlowState>) => dispatch({ t: "set", patch });
  const next = () => dispatch({ t: "next" });
  void rules;
  return (
    <Step id="welcome" dir={state.dir}>
      <AppIcon kind="space" letter={invite.space} />
      <Title title={`Welcome to ${invite.space}`} sub={`${invite.by} invited you to join.`} />
      <Photo state={state} onPick={onPickPhoto} />
      <Group>
        <FieldRow testID="first" label="First name" value={state.first} onChange={(v) => set({ first: v })} placeholder="Required" onSubmit={next} autoComplete="given-name" />
        <FieldRow testID="last" label="Last name" value={state.last} onChange={(v) => set({ last: v })} placeholder="Required" onSubmit={next} autoComplete="family-name" />
      </Group>
      {invite.starting && (invite.starting.agents.length || invite.starting.projects.length) ? (
        <>
          <Caption>You'll start with</Caption>
          <Group top={0} testID="starting">
            {invite.starting.agents.length ? <Starting label="Agents" names={invite.starting.agents} agents /> : null}
            {invite.starting.projects.length ? <Starting label="Projects" names={invite.starting.projects} /> : null}
          </Group>
        </>
      ) : null}
    </Step>
  );
}

function Starting({ label, names, agents, divider }: { label: string; names: string[]; agents?: boolean; divider?: boolean }) {
  const { p } = useJoin();
  const stack: ReactNode[] = [];
  for (const [i, n] of names.slice(0, 4).entries()) {
    stack.push(<View key={n} style={{ marginLeft: i === 0 ? 0 : -4 }}>{agents ? <LetterTile name={n} size={24} /> : <FolderTile />}</View>);
  }
  return (
    <Row label={label} small divider={divider} testID={`starting-${label.toLowerCase()}`}>
      <Text numberOfLines={1} style={[baseText(p), { flex: 1, minWidth: 0, fontSize: 13, color: p.tx2 }]}>{names.join(", ")}</Text>
      <View style={{ flexDirection: "row", paddingLeft: 8 }}>{stack}</View>
    </Row>
  );
}
function FolderTile() {
  const { p } = useJoin();
  return <View accessible={false} style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: "#8E8E93", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.grp }}><View style={{ width: 11, height: 8, borderRadius: 2, borderWidth: 1.5, borderColor: "#fff" }} /></View>;
}

function Username({ state, invite, ok, onChange, onSubmit }: { state: FlowState; invite: JoinInvite; ok: boolean; onChange: (v: string) => void; onSubmit: () => void }) {
  const { p } = useJoin();
  const width = Math.max(24, Math.min(190, state.user.length * 8.6 + 6));
  return (
    <Row label="Username" divider={false}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
        <Text style={[baseText(p), { color: p.tx2 }]}>@</Text>
        <TextInput
          testID="username" accessibilityLabel="Username" value={state.user} onChangeText={(v) => onChange(cleanUsername(v))} placeholder="name" placeholderTextColor={p.tx2}
          autoCapitalize="none" autoCorrect={false} spellCheck={false} onSubmitEditing={onSubmit}
          style={[baseText(p), { width, padding: 0, color: p.tx, height: "100%" as unknown as number, outlineStyle: "none" } as object]}
        />
        <Text style={[baseText(p), { color: p.tx2 }]}>{`.${invite.host}`}</Text>
        {ok ? <View testID="username-ok" style={{ marginLeft: 8 }}><Check color={p.green} /></View> : null}
      </View>
    </Row>
  );
}

function SignInStep({ invite, state, dispatch, rules }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "rules">) {
  const { p } = useJoin();
  const set = (patch: Partial<FlowState>) => dispatch({ t: "set", patch });
  const next = () => dispatch({ t: "next" });
  const u = state.user;
  const ok = usernameOk(u) && !rules.isTaken(u);
  const taken = !!u && rules.isTaken(u);
  const mism = !!state.pw2 && state.pw2 !== state.pw;
  const sugg = taken ? suggestions(state.first, state.last, u, (x) => !rules.isTaken(x)) : [];
  const tries: ReactNode[] = [];
  for (const x of sugg) tries.push(<TextButton key={x} small label={x} testID={`suggest-${x}`} onPress={() => set({ user: x })} />);
  return (
    <Step id="signin-details" dir={state.dir}>
      <AppIcon kind="person" />
      <Title title="Your sign-in" />
      <Group>
        <Username state={state} invite={invite} ok={ok} onChange={(v) => set({ user: v })} onSubmit={next} />
        <FieldRow testID="password" label="Password" value={state.pw} onChange={(v) => set({ pw: v })} placeholder="Required" secure autoComplete="new-password" onSubmit={next} />
        <FieldRow testID="confirm" label="Confirm" value={state.pw2} onChange={(v) => set({ pw2: v })} placeholder="Required" secure autoComplete="new-password" onSubmit={next} />
      </Group>
      {u && !ok ? <ErrorLine testID="username-error">{taken ? `@${u} is taken.` : "Use 3 to 24 letters or digits, starting with a letter."}</ErrorLine> : mism ? <ErrorLine testID="mismatch">The passwords do not match.</ErrorLine> : null}
      {sugg.length ? (
        <View testID="suggestions" style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8, marginHorizontal: 16, alignItems: "center" }}>
          <Text style={[baseText(p), { fontSize: 13, color: p.tx2 }]}>Try</Text>
          {tries}
        </View>
      ) : null}
      <Meter level={meter(strength(state.pw))} />
      <Foot>Vyre never sees your password. If you forget it, an admin can reset it, but your private items are lost unless you keep a recovery code. You are offered one on the device step.</Foot>
    </Step>
  );
}

function DeviceStep({ state, dispatch, newCode }: Pick<AcceptInviteProps, "state" | "dispatch" | "newCode">) {
  const { p } = useJoin();
  const set = (patch: Partial<FlowState>) => dispatch({ t: "set", patch });
  return (
    <Step id="device" dir={state.dir}>
      <AppIcon kind="laptop" />
      <Title title="Set up this device" />
      <Group>
        <FieldRow testID="device" label="Device name" value={state.device} onChange={(v) => set({ device: v })} onSubmit={() => dispatch({ t: "next" })} />
        <Row>
          <Text style={[baseText(p), { flex: 1 }]}>Trust this device</Text>
          <Switch testID="trust" label="Trust this device" on={state.trust} onChange={(v) => set({ trust: v })} />
        </Row>
      </Group>
      <Group>
        <Row testID="recovery-row">
          <Text style={[baseText(p), { flex: 1 }]}>Recovery code</Text>
          {state.rec ? <Text style={[baseText(p), { color: p.tx2 }]}>{state.saved ? "Saved" : "Created"}</Text> : null}
          <TextButton testID="recovery" label={state.rec ? "View…" : "Create…"} onPress={() => dispatch({ t: "recovery_open", code: newCode() })} />
        </Row>
      </Group>
    </Step>
  );
}

function RecoverySheet({ invite, state, dispatch, onCopyCode, onSaveCode }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "onCopyCode" | "onSaveCode">) {
  const { p } = useJoin();
  void invite;
  return (
    <Sheet label="Recovery code" onDismiss={() => dispatch({ t: "recovery_close" })}>
      <Text accessibilityRole="header" style={[baseText(p), { textAlign: "center", fontSize: 17, lineHeight: 22, fontWeight: "600" }]}>Your recovery code</Text>
      <Text selectable testID="recovery-code" style={[baseText(p), { marginTop: 18, textAlign: "center", fontFamily: MONO, fontSize: 20, lineHeight: 28, fontWeight: "500", letterSpacing: 1.2 }]}>{state.code}</Text>
      <View style={{ marginTop: 18, backgroundColor: p.grp, borderRadius: 10 }}>
        <Row><View style={{ flex: 1, alignItems: "center" }}><TextButton testID="copy-code" label="Copy" onPress={() => onCopyCode?.(state.code)} /></View></Row>
        <Row divider><View style={{ flex: 1, alignItems: "center" }}><TextButton testID="save-code" label="Save…" onPress={() => onSaveCode?.(state.code)} /></View></Row>
      </View>
      <CheckBox testID="saved" checked={state.saved} label="I saved it" onChange={(v) => dispatch({ t: "set", patch: { saved: v } })} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 20 }}>
        <TextButton testID="cancel-code" label="Cancel" onPress={() => dispatch({ t: "recovery_close" })} />
        <Button testID="done-code" label="Done" disabled={!state.saved} onPress={() => dispatch({ t: "recovery_done" })} />
      </View>
    </Sheet>
  );
}

function RunStep({ invite, state }: Pick<AcceptInviteProps, "invite" | "state">) {
  const { p } = useJoin();
  const steps = RUN_STEPS(invite.space);
  const done = state.stage === "done";
  const n = done ? steps.length : state.run;
  return (
    <Step id={done ? "done" : "run"}>
      <AppIcon kind="space" letter={invite.space} />
      <Title title={done ? "You're all set" : `Setting up ${invite.space}`} sub={done ? `Welcome, ${state.first.trim()}.${state.ai === "none" ? " Your assistant is locked until you connect an AI account." : ""}` : undefined} />
      {done ? null : (
        <>
          <Progress pct={Math.max(4, Math.round(((n + 0.4) / steps.length) * 100))} />
          <Text accessibilityLiveRegion="polite" testID="run-current" style={[baseText(p), { marginTop: 14, textAlign: "center", color: p.tx2, minHeight: 21 }]}>{`${steps[Math.min(n, steps.length - 1)]}…`}</Text>
        </>
      )}
    </Step>
  );
}

// ---- the page

export function AcceptInvite(props: AcceptInviteProps) {
  const { invite, state, dispatch, rules, expired } = props;
  if (expired) return <Panel center><Expired invite={invite} onEmail={props.onEmail} /></Panel>;
  if (state.stage === "accept") return <Panel center><Landing invite={invite} onOpenApp={props.onOpenApp} onDownload={props.onDownload} dispatch={dispatch} state={state} /></Panel>;

  const running = state.stage === "run";
  const done = state.stage === "done";
  const last = running || done;
  const ok = valid(state, rules);
  const cont = last
    ? (done ? <Button testID="open-space" label={`Open ${invite.space}`} onPress={props.onOpen} /> : <View />)
    : <Button testID="next" label="Continue" disabled={!ok} onPress={() => dispatch({ t: "next" })} />;
  const bar = <Bar hideBack={last || state.step === 0} onBack={() => dispatch({ t: "back" })} step={last ? STEPS : state.step} steps={STEPS} cont={cont} centre={done} />;

  let body;
  if (last) body = <RunStep invite={invite} state={state} />;
  else if (state.step === 0) body = <Welcome invite={invite} state={state} dispatch={dispatch} onPickPhoto={props.onPickPhoto} rules={rules} />;
  else if (state.step === 1) body = <SignInStep invite={invite} state={state} dispatch={dispatch} rules={rules} />;
  else if (state.step === 2) body = <DeviceStep state={state} dispatch={dispatch} newCode={props.newCode} />;
  else {
    body = (
      <Step id="connect-ai" dir={state.dir}>
        <ConnectAI
          invite={invite} ai={state.ai} apiKey={state.key} note={state.note} error={state.error}
          onPick={(ai) => dispatch({ t: "pick_ai", ai })} onKey={(v) => dispatch({ t: "set", patch: { key: v } })} onSubscribe={() => dispatch({ t: "set", patch: { note: "subok" } })}
        />
      </Step>
    );
  }
  return (
    <>
      <Panel center={last} bar={bar}>{body}</Panel>
      {state.sheet ? <RecoverySheet invite={invite} state={state} dispatch={dispatch} onCopyCode={props.onCopyCode} onSaveCode={props.onSaveCode} /> : null}
    </>
  );
}

