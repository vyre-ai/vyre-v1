// The connection screen is deliberately small: a person names a real Space, then the caller verifies it before credentials appear.
import { View } from "react-native";
import { AppIcon, Bar, Button, ErrorLine, FieldRow, Foot, Group, Panel, Step, TextButton, Title } from "./kit.tsx";
import { normalizeSpaceAddress, welcomeGreeting } from "./logic.ts";

export interface WelcomeProps {
  address: string;
  busy: boolean;
  error: string;
  onAddressChange: (value: string) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
}

export function Welcome({ address, busy, error, onAddressChange, onSignIn, onGetStarted }: WelcomeProps) {
  const valid = !!normalizeSpaceAddress(address);
  const greeting = welcomeGreeting(new Date().getHours());
  return (
    <Panel
      center
      bar={<Bar hideBack cont={<Button testID="resolve-space" label={busy ? "Verifying…" : "Sign in"} disabled={!valid || busy} onPress={onSignIn} />} />}
    >
      <Step id="welcome">
        <AppIcon kind="space" letter="V" />
        <Title title="Welcome back" sub={`${greeting}. Connect a Space to sign in or get started.`} />
        <Group>
          <FieldRow testID="space-address" label="Space address" value={address} onChange={onAddressChange} placeholder="northwind.example" autoComplete="url" onSubmit={onSignIn} />
        </Group>
        {error ? <ErrorLine testID="space-error">{error}</ErrorLine> : null}
        <View style={{ alignItems: "center" }}>
          <Foot centre top={20}>New to this Space?</Foot>
          <TextButton testID="get-started" label="Get started" onPress={onGetStarted} disabled={!valid || busy} />
        </View>
      </Step>
    </Panel>
  );
}
