// join/SignIn: for people who already have an account (spec 3.13). The Space is known by now, so this is username and password at that Space, then the second factor when the Space asks for one. Single
// sign-on providers and GitHub (once the Space is named and the account is linked) sit under the primary. No passkey row: passkeys are not in v1.
import type { Dispatch } from "react";
import { Bar, Button, Caption, ErrorLine, FieldRow, Group, Links, Panel, Row, Step, TextButton, Title } from "./kit.tsx";
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
  onBack?: () => void;
  unlock?: boolean;
}

export function SignIn({ invite, state, dispatch, busy, onSubmit, onSso, onGithub, onRecoveryCode, onBack, unlock }: SignInProps) {
  const totp = state.si === "totp";
  const go = (): void => { if (onSubmit) onSubmit(); else dispatch({ t: "next" }); };
  const label = busy ? "Signing in" : unlock ? "Unlock" : "Sign in";
  const bar = <Bar onBack={() => { if (!totp && onBack) onBack(); else dispatch({ t: "back" }); }} cont={<Button testID="next" label={label} busy={!!busy} disabled={!signInValid(state)} onPress={go} />} />;
  const help = onRecoveryCode ? <Links><TextButton testID={totp ? "recovery-code-link" : "signin-help"} label={totp ? "Use a recovery code" : "Forgot password"} onPress={onRecoveryCode} /></Links> : undefined;
  const others = !totp && (invite.sso.length || invite.github) ? (
    <>
      <Caption>Or continue with</Caption>
      {invite.sso.length ? <Group top={0} testID="sign-in-sso">{invite.sso.map((n) => <Row kind="action" key={n} testID={`sso-${n.toLowerCase()}`} label={n} onPress={() => onSso?.(n)} />)}</Group> : null}
      {invite.github ? <Group top={invite.sso.length ? 8 : 0} testID="sign-in-github"><Row kind="action" testID="github" label="GitHub" onPress={onGithub} /></Group> : null}
    </>
  ) : null;
  return (
    <Panel space={invite.space} bar={bar} below={<>{help}{others}</>}>
      {totp ? (
        <Step id="totp">
          <Title title="Enter the code" />
          <Group>
            <FieldRow testID="si-code" label="6 digit code" value={state.siCode} onChange={(v) => dispatch({ t: "set", patch: { siCode: v.replace(/\D/g, "").slice(0, 6), error: "" } })} placeholder="000000" keyboard="numeric" maxLength={6} autoComplete="one-time-code" onSubmit={go} error={!!state.error} />
          </Group>
          <ErrorLine testID="join-error">{state.error}</ErrorLine>
        </Step>
      ) : (
        <Step id="sign-in">
          <Title title={unlock ? "Unlock Vyre" : `Sign in to ${invite.space}`} sub={unlock ? "Sign in again" : invite.host} />
          <Group>
            <FieldRow testID="si-user" label="Username" value={state.siUser} onChange={(v) => dispatch({ t: "set", patch: { siUser: cleanUsername(v), error: "" } })} autoComplete="username" onSubmit={go} disabled={!!busy} />
            <FieldRow testID="si-password" label="Password" value={state.siPw} onChange={(v) => dispatch({ t: "set", patch: { siPw: v, error: "" } })} secure visibilityTestID="si-password-visibility" autoComplete="current-password" onSubmit={go} disabled={!!busy} error={!!state.error} />
          </Group>
          <ErrorLine testID="join-error">{state.error}</ErrorLine>
        </Step>
      )}
    </Panel>
  );
}

