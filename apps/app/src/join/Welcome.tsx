// Sign in, first step: name the Space. Credentials appear only once the caller has verified it, so a typed address can never collect a password. A bare name means <name>.vyre.run.
import { Bar, Button, ErrorLine, Field, Group, Links, Panel, Step, TextButton, Title } from "./kit.tsx";
import { normalizeSpaceAddress } from "./logic.ts";

export interface WelcomeProps {
  address: string;
  busy: boolean;
  error: string;
  onAddressChange: (value: string) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
  onBack?: (() => void) | undefined;
}

export function Welcome({ address, busy, error, onAddressChange, onSignIn, onGetStarted, onBack }: WelcomeProps) {
  const valid = !!normalizeSpaceAddress(address);
  const disabled = !valid || busy;
  const go = (): void => { if (!disabled) onSignIn(); };
  return (
    <Panel
      below={<Links><TextButton testID="get-started" label="New here?" disabled={busy} onPress={onGetStarted} /></Links>}
      bar={<Bar {...(onBack ? { onBack } : {})} cont={<Button testID="resolve-space" label={busy ? "Finding your Space" : "Continue"} busy={busy} disabled={!valid} onPress={go} />} />}
    >
      <Step id="welcome">
        <Title title="Sign in" />
        <Group>
          <Field testID="space-address" label="Space" value={address} onChange={onAddressChange} onSubmit={go} placeholder="your-space.vyre.run" autoComplete="url" autoFocus error={!!error} />
        </Group>
        <ErrorLine testID="space-error">{error}</ErrorLine>
      </Step>
    </Panel>
  );
}
