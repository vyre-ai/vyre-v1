// join/SignIn: for people who already have an account (spec 3.13). Username and password at the Space's address, then the second factor when the
// Space asks for one. Single sign-on providers and GitHub (once the Space is named and the account is linked) sit under "Or continue with".
// No passkey row: passkeys are not in v1.
import { Text, TextInput, View } from "react-native";
import type { Dispatch } from "react";
import { ActionRow, AppIcon, Bar, Button, Caption, ErrorLine, FieldRow, Foot, Group, Panel, Row, Step, Title, baseText, useJoin } from "./kit.tsx";
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

function Name({ state, host, dispatch, onSubmit }: { state: FlowState; host: string; dispatch: Dispatch<Action>; onSubmit?: () => void }) {
  const { p } = useJoin();
  const width = Math.max(24, Math.min(190, state.siUser.length * 8.6 + 6));
  return (
    <Row label="Username">
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
        <Text style={[baseText(p), { color: p.tx2 }]}>@</Text>
        <TextInput
          testID="si-user" accessibilityLabel="Username" value={state.siUser} onChangeText={(v) => dispatch({ t: "set", patch: { siUser: cleanUsername(v) } })} placeholder="name" placeholderTextColor={p.tx2}
          autoCapitalize="none" autoCorrect={false} spellCheck={false} onSubmitEditing={onSubmit}
          style={[baseText(p), { width, padding: 0, color: p.tx, height: "100%" as unknown as number, outlineStyle: "none" } as object]}
        />
        <Text style={[baseText(p), { color: p.tx2 }]}>{`.${host}`}</Text>
      </View>
    </Row>
  );
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
          <AppIcon kind="lock" />
          <Title title="Enter the code" sub={`Open your authenticator app and enter the 6 digit code for ${invite.space}.`} />
          <Group>
            <FieldRow testID="si-code" label="Code" value={state.siCode} onChange={(v) => dispatch({ t: "set", patch: { siCode: v.replace(/\D/g, "").slice(0, 6) } })} placeholder="000000" keyboard="numeric" maxLength={6} autoComplete="one-time-code" onSubmit={go} spaced />
          </Group>
          {state.error ? <ErrorLine testID="join-error">{state.error}</ErrorLine> : null}
          <Foot><Text accessibilityRole="link" testID="recovery-code-link" onPress={onRecoveryCode} style={{ color: p.blue }}>Use a recovery code</Text> instead.</Foot>
        </Step>
      ) : (
        <Step id="sign-in" dir={state.dir}>
          <AppIcon kind="space" letter={invite.space} />
          <Title title={`Sign in to ${invite.space}`} />
          <Group>
            <Name state={state} host={invite.host} dispatch={dispatch} onSubmit={go} />
            <FieldRow testID="si-password" label="Password" value={state.siPw} onChange={(v) => dispatch({ t: "set", patch: { siPw: v } })} placeholder="Required" secure autoComplete="current-password" onSubmit={go} />
          </Group>
          {state.error ? <ErrorLine testID="join-error">{state.error}</ErrorLine> : null}
          {invite.sso.length || invite.github ? (
            <>
              <Caption>Or continue with</Caption>
              <Group top={0} testID="sign-in-options">
                {invite.sso.map((n) => <ActionRow key={n} testID={`sso-${n.toLowerCase()}`} label={n} note="OpenID Connect" onPress={() => onSso?.(n)} />)}
                {invite.github ? <ActionRow testID="github" label="GitHub" note="Linked account" onPress={onGithub} /> : null}
              </Group>
            </>
          ) : null}
        </Step>
      )}
    </Panel>
  );
}

