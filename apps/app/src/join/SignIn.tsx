// join/SignIn: for people who already have an account (spec 3.13). Username and password at the Space's address, then the second factor when the
// Space asks for one. Single sign-on providers and GitHub (once the Space is named and the account is linked) sit under "Or continue with".
// No passkey row: passkeys are not in v1.
import { Text } from "react-native";
import type { Dispatch } from "react";
import { Bar, Button, Caption, ErrorLine, FieldRow, Foot, Group, Panel, Row, Step, Title, useJoin } from "./kit.tsx";
import { cleanUsername, signInValid } from "./logic.ts";
import type { Action, FlowState, JoinInvite } from "./logic.ts";

export interface SignInProps {
  invite: Pick<JoinInvite, "space" | "host" | "sso" | "github">;
  state: FlowState;
  dispatch: Dispatch<Action>;
  busy?: boolean;
  onSubmit?: () => void;
  onSso?: (provider: string) => void;
  onGithub?: () => void;
  onRecoveryCode?: () => void;
}


export function SignIn({ invite, state, dispatch, busy, onSubmit, onSso, onGithub, onRecoveryCode }: SignInProps) {
  const { p } = useJoin();
  const totp = state.si === "totp";
  const go = () => (onSubmit ? onSubmit() : dispatch({ t: "next" }));
  const bar = (
    <Bar
      onBack={() => dispatch({ t: "back" })}
      cont={<Button testID="next" label={totp ? "Sign in" : "Continue"} disabled={!signInValid(state) || !!busy} onPress={go} />}
    />
  );
  return (
    <Panel center bar={bar}>
      {totp ? (
        <Step id="totp" dir={state.dir}>

          <Title title="Enter the code" sub={`Open your authenticator app and enter the 6 digit code for ${invite.space}.`} />
          <Group>
            <FieldRow testID="si-code" label="Code" value={state.siCode} onChange={(v) => dispatch({ t: "set", patch: { siCode: v.replace(/\D/g, "").slice(0, 6) } })} placeholder="000000" keyboard="numeric" maxLength={6} autoComplete="one-time-code" onSubmit={go} spaced />
          </Group>
          {state.error ? <ErrorLine testID="join-error">{state.error}</ErrorLine> : null}
          <Foot><Text accessibilityRole="link" testID="recovery-code-link" onPress={onRecoveryCode} style={{ color: p.blue }}>Use a recovery code</Text> instead.</Foot>
        </Step>
      ) : (
        <Step id="sign-in" dir={state.dir}>

          <Title title={`Sign in to ${invite.space}`} />
          <Group>
            <FieldRow testID="si-user" label="Username" value={state.siUser} onChange={(v) => dispatch({ t: "set", patch: { siUser: cleanUsername(v) } })} placeholder="Your username" autoComplete="username" onSubmit={go} stacked />
            <FieldRow testID="si-password" label="Password" value={state.siPw} onChange={(v) => dispatch({ t: "set", patch: { siPw: v } })} placeholder="Required" secure revealable visibilityTestID="si-password-visibility" autoComplete="current-password" onSubmit={go} stacked />
          </Group>
          {state.error ? <ErrorLine testID="join-error">{state.error}</ErrorLine> : null}
          {onRecoveryCode ? <Foot><Text accessibilityRole="link" testID="signin-help" onPress={onRecoveryCode} style={{ color: p.blue }}>Need help signing in?</Text></Foot> : null}
          {invite.sso.length || invite.github ? (
            <>
              {invite.sso.length ? <><Caption>Single sign-on</Caption><Group top={0} testID="sign-in-sso">{invite.sso.map((n) => <Row kind="action" key={n} testID={`sso-${n.toLowerCase()}`} label={n} note="OpenID Connect" onPress={() => onSso?.(n)} />)}</Group></> : null}
              {invite.github ? <><Caption>GitHub</Caption><Group top={0} testID="sign-in-github"><Row kind="action" testID="github" label="GitHub" note="Linked account" onPress={onGithub} /></Group></> : null}
            </>
          ) : null}
        </Step>
      )}
    </Panel>
  );
}
