// join/AcceptInvite: the invite landing, the three account steps, the setup run and the finish (spec 3.13, ARCH 7.13).
// Landing: Open in Vyre, Download Vyre, Continue in the browser, and Sign in for people who already have an account.
// Steps: welcome with name and photo, the sign-in (username, password, strength), this device (name, trust, recovery code), then ConnectAI.
// The page is presentational: the stage machine lives in logic.ts and JoinFlow.tsx owns the timers and the calls.
import { createElement } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { Dispatch, ReactNode } from "react";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { ConnectAI } from "./ConnectAI.tsx";
import {
  Bar, Button, Caption, Check, CodeShown, ErrorLine, FieldRow, Foot, Group, AgentFace, Links, Meter, Panel, Row, Sheet, Step, Switch, TextButton, Title, CheckBox, Working,
  baseText, useJoin,
} from "./kit.tsx";
import { PASSWORD_MIN, RUN_STEPS, meter, strength, suggestions, usernameOk, valid, cleanUsername } from "./logic.ts";
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

function Landing({ invite, state }: Pick<AcceptInviteProps, "invite" | "state">) {
  const { p } = useJoin();
  return (
    <Step id="accept" dir={state.dir}>
      <Title title={`Join ${invite.space}`} sub={invite.by ? `${invite.by} invited you` : undefined} />
      {invite.role ? <Text style={[baseText(p), { marginTop: 2, fontSize: 13, lineHeight: 18, color: p.ink3, textAlign: "center" }]}>{invite.role}</Text> : null}
    </Step>
  );
}

function Expired({ invite, onEmail }: Pick<AcceptInviteProps, "invite" | "onEmail">) {
  const first = invite.by.split(" ")[0] ?? invite.by;
  return (
    <Step id="expired">
      <Title title="This invite expired" sub={invite.by ? `Ask ${first} for a new one` : "Ask for a new one"} />
      {invite.email ? <View style={{ flexGrow: 1, justifyContent: "flex-end", marginTop: 22 }}><Button testID="email-inviter" label={`Email ${first}`} onPress={() => invite.email && onEmail?.(invite.email)} /><Foot top={8} testID="invite-email">{invite.email}</Foot></View> : null}
    </Step>
  );
}

// ---- steps

function Photo({ state, onPick }: { state: FlowState; onPick?: (() => void) | undefined }) {
  const { p } = useJoin();
  return (
    <View style={{ alignItems: "center", marginTop: 18 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Change photo" testID="photo" onPress={onPick} style={{ width: 64, height: 64, borderRadius: 32 }}>
        <Avatar name={`${state.first} ${state.last}`.trim() || "You"} kind="person" size={64} />
        <View style={{ position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: p.field, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.sheet }}>
          {Platform.OS === "web"
            ? createElement("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": true, "data-icon": "camera", fill: "none", stroke: p.ink2, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" },
              createElement("path", { d: "M2 5.600A1.400 1.400 0 013.400 4.200h1.100l.7-1.200h5.600l.7 1.200h1.100A1.400 1.400 0 0114 5.600v6A1.400 1.400 0 0112.600 13H3.400A1.400 1.400 0 012 11.600z" }),
              createElement("circle", { cx: 8, cy: 8.6, r: 2.3 }))
            : <Text style={{ color: p.ink2, fontSize: 11 }}>+</Text>}
        </View>
      </Pressable>
    </View>
  );
}

function Welcome({ invite, state, dispatch, onPickPhoto }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "onPickPhoto">) {
  const set = (patch: Partial<FlowState>) => dispatch({ t: "set", patch });
  const next = () => dispatch({ t: "next" });
  return (
    <Step id="welcome" dir={state.dir}>
      <Title title={`Welcome to ${invite.space}`} />
      <Photo state={state} onPick={onPickPhoto} />
      <Group top={16}>
        <FieldRow testID="first" label="First name" value={state.first} onChange={(v) => set({ first: v })} onSubmit={next} autoComplete="given-name" />
        <FieldRow testID="last" label="Last name" value={state.last} onChange={(v) => set({ last: v })} onSubmit={next} autoComplete="family-name" />
      </Group>
      {invite.starting && (invite.starting.agents.length || invite.starting.projects.length) ? (
        <>
          <Caption>You start with</Caption>
          <Group top={0} testID="starting">
            {invite.starting.agents.length ? <Starting label="Agents" names={invite.starting.agents} agents /> : null}
            {invite.starting.projects.length ? <Starting label="Projects" names={invite.starting.projects} /> : null}
          </Group>
        </>
      ) : null}
    </Step>
  );
}

function Starting({ label, names, agents }: { label: string; names: string[]; agents?: boolean; divider?: boolean }) {
  const { p } = useJoin();
  const stack: ReactNode[] = [];
  for (const [i, n] of names.slice(0, 4).entries()) {
    stack.push(<View key={n} style={{ marginLeft: i === 0 ? 0 : -4 }}>{agents ? <AgentFace name={n} size={24} /> : <FolderTile />}</View>);
  }
  return (
    <Row label={label} small testID={`starting-${label.toLowerCase()}`}>
      <Text numberOfLines={1} style={[baseText(p), { flex: 1, minWidth: 0, fontSize: 13, color: p.ink3 }]}>{names.join(", ")}</Text>
      <View style={{ flexDirection: "row", paddingLeft: 8 }}>{stack}</View>
    </Row>
  );
}
function FolderTile() {
  const { p } = useJoin();
  return <View accessible={false} style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: p.field, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.sheet }}><View style={{ width: 11, height: 8, borderRadius: 2, borderWidth: 1.5, borderColor: p.ink3 }} /></View>;
}

function SignInStep({ state, dispatch, rules }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "rules">) {
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
  const short = !!state.pw && state.pw.length < PASSWORD_MIN;
  const line = u && !ok ? (taken ? (sugg.length ? `@${u} is taken.` : `@${u} is taken. Choose a different username.`) : "Use 3 to 24 letters or digits, starting with a letter.") : short ? "Use at least 8 characters." : mism ? "The passwords do not match." : state.error;
  return (
    <Step id="signin-details" dir={state.dir}>
      <Title title="Your account" />
      <Group>
        <FieldRow testID="username" label="Username" value={state.user} onChange={(v) => set({ user: cleanUsername(v) })} autoComplete="username" onSubmit={next} error={!!u && !ok} trailing={ok ? <View testID="username-ok" style={{ paddingHorizontal: 6 }}><Check size={15} color={p.ok} /></View> : null} />
        <FieldRow testID="password" label="Password" value={state.pw} onChange={(v) => set({ pw: v })} placeholder="At least 8 characters" secure visibilityTestID="password-visibility" autoComplete="new-password" onSubmit={next} />
        <Meter level={meter(strength(state.pw))} />
        <FieldRow testID="confirm" label="Confirm" value={state.pw2} onChange={(v) => set({ pw2: v })} secure visibilityTestID="confirm-visibility" autoComplete="new-password" onSubmit={next} error={mism} />
      </Group>
      <ErrorLine testID={taken || (u && !ok) ? "username-error" : "mismatch"}>{line}</ErrorLine>
      {sugg.length ? (
        <View testID="suggestions" style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center", justifyContent: "center" }}>
          <Text style={[baseText(p), { fontSize: 12.5, color: p.ink3 }]}>Try</Text>
          {tries}
        </View>
      ) : null}
    </Step>
  );
}

function DeviceStep({ state, dispatch, newCode }: Pick<AcceptInviteProps, "state" | "dispatch" | "newCode">) {
  const { p } = useJoin();
  const set = (patch: Partial<FlowState>) => dispatch({ t: "set", patch });
  return (
    <Step id="device" dir={state.dir}>
      <Title title="This device" />
      <Group>
        <FieldRow testID="device" label="Device name" value={state.device} onChange={(v) => set({ device: v })} onSubmit={() => dispatch({ t: "next" })} />
        <Row>
          <Text style={[baseText(p), { flex: 1, fontSize: 14 }]}>Trust this device</Text>
          <Switch testID="trust" label="Trust this device" on={state.trust} onChange={(v) => set({ trust: v })} />
        </Row>
        <Row testID="recovery-row">
          <Text style={[baseText(p), { flex: 1, fontSize: 14 }]}>Recovery code</Text>
          {state.rec ? <Text style={[baseText(p), { fontSize: 13, color: p.ink3 }]}>{state.saved ? "Saved" : "Created"}</Text> : null}
          <TextButton testID="recovery" label={state.rec ? "View" : "Create"} onPress={() => dispatch({ t: "recovery_open", code: newCode() })} />
        </Row>
      </Group>
    </Step>
  );
}

function RecoverySheet({ state, dispatch, onCopyCode, onSaveCode }: Pick<AcceptInviteProps, "invite" | "state" | "dispatch" | "onCopyCode" | "onSaveCode">) {
  return (
    <Sheet label="Recovery code" onDismiss={() => dispatch({ t: "recovery_close" })}>
      <Title title="Your recovery code" />
      <CodeShown code={state.code} testID="recovery-code" />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}><Button quiet testID="copy-code" label="Copy" onPress={() => onCopyCode?.(state.code)} /></View>
        <View style={{ flex: 1 }}><Button quiet testID="save-code" label="Save" onPress={() => onSaveCode?.(state.code)} /></View>
      </View>
      <CheckBox testID="saved" checked={state.saved} label="I saved it" onChange={(v) => dispatch({ t: "set", patch: { saved: v } })} />
      <View style={{ marginTop: 8 }}><Button testID="done-code" label="Done" disabled={!state.saved} onPress={() => dispatch({ t: "recovery_done" })} /></View>
      <Links><TextButton testID="cancel-code" label="Cancel" onPress={() => dispatch({ t: "recovery_close" })} /></Links>
    </Sheet>
  );
}

function RunStep({ invite, state }: Pick<AcceptInviteProps, "invite" | "state">) {
  const steps = RUN_STEPS(invite.space);
  const done = state.stage === "done";
  const n = done ? steps.length : state.run;
  if (done) return <Step id="done"><Title title="You're all set" sub={`Welcome, ${state.first.trim()}.${state.ai === "none" ? " Your assistant waits until you connect an AI." : ""}`} /></Step>;
  return <Step id="run"><Working title={`Setting up ${invite.space}`} line={steps[Math.min(n, steps.length - 1)]!} lineTestID="run-current" /></Step>;
}

// ---- the page

export function AcceptInvite(props: AcceptInviteProps) {
  const { invite, state, dispatch, rules, expired } = props;
  if (expired) return <Panel space={invite.space}><Expired invite={invite} onEmail={props.onEmail} /></Panel>;
  if (state.stage === "accept") {
    return (
      <Panel
        space={invite.space}
        bar={<Bar cont={<Button testID="web" label={props.onOpenApp ? "Continue in the browser" : "Accept invite"} onPress={() => dispatch({ t: "web" })} />} />}
        below={<>
          {props.onOpenApp ? <View style={{ marginTop: 8 }}><Button quiet testID="open-app" label="Open in Vyre" onPress={props.onOpenApp} /></View> : null}
          <Links>
            {props.onDownload ? <TextButton testID="download" label="Get Vyre" onPress={props.onDownload} /> : null}
            <TextButton testID="have-account" label="I have an account" onPress={() => dispatch({ t: "signin" })} />
          </Links>
        </>}
      >
        <Landing invite={invite} state={state} />
      </Panel>
    );
  }

  const running = state.stage === "run";
  const done = state.stage === "done";
  const last = running || done;
  const ok = valid(state, rules);
  const cont = last
    ? (done ? <Button testID="open-space" label={`Open ${invite.space}`} onPress={props.onOpen} /> : null)
    : <Button testID="next" label="Continue" disabled={!ok} onPress={() => dispatch({ t: "next" })} />;
  const bar = <Bar hideBack={last || state.step === 0} onBack={() => dispatch({ t: "back" })} step={last ? STEPS : state.step} steps={STEPS} cont={cont} centre={done} />;

  let body;
  if (last) body = <RunStep invite={invite} state={state} />;
  else if (state.step === 0) body = <Welcome invite={invite} state={state} dispatch={dispatch} onPickPhoto={props.onPickPhoto} />;
  else if (state.step === 1) body = <SignInStep invite={invite} state={state} dispatch={dispatch} rules={rules} />;
  else if (state.step === 2) body = <DeviceStep state={state} dispatch={dispatch} newCode={props.newCode} />;
  else {
    body = (
      <Step id="connect-ai" dir={state.dir}>
        <ConnectAI
          invite={invite} ai={state.ai} apiKey={state.key} note={state.note} error={state.error} providerKey={state.aiProvider} onProvider={(aiProvider) => dispatch({ t: "set", patch: { aiProvider } })}
          onPick={(ai) => dispatch({ t: "pick_ai", ai })} onKey={(v) => dispatch({ t: "set", patch: { key: v } })} onSubscribe={() => undefined}
        />
      </Step>
    );
  }
  return (
    <>
      <Panel wait={running} {...(state.step === 0 || last ? { space: invite.space } : {})} bar={bar}>{body}</Panel>
      {state.sheet ? <RecoverySheet invite={invite} state={state} dispatch={dispatch} onCopyCode={props.onCopyCode} onSaveCode={props.onSaveCode} /> : null}
    </>
  );
}
