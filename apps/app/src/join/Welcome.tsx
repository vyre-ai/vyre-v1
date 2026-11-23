// Sign in, first step: name the Space. Credentials appear only once the caller has verified it, so a typed address can never collect a password. A bare name means <name>.vyre.run, and the
// line under the box says so while it is typed. The one address box: it takes a name, an address, an invite link or a Space link (join/SpaceEntry.tsx uses the same field and rules).
import { View } from "react-native";
import { Bar, Button, ErrorLine, Field, Foot, Group, Links, Panel, Step, TextButton, Title } from "./kit.tsx";
import { bareSpaceName, normalizeSpaceAddress } from "./logic.ts";
import { RECONNECTING } from "./failure.ts";

/** What the one address box shows before anything is typed. */
export const ADDRESS_PLACEHOLDER = "Name, address or invite link";

/** Under the box, in place of the error line while there is none: the address a bare name means. */
export function AddressHint({ value, error, testID }: { value: string; error: string; testID: string }) {
  const named = error ? null : bareSpaceName(value);
  if (!named) return <ErrorLine testID={testID}>{error}</ErrorLine>;
  return (
    <View style={{ minHeight: 20, marginTop: 8 }}>
      <Foot testID="space-hint" top={0} centre={false}>
        {named}
      </Foot>
    </View>
  );
}

export interface WelcomeProps {
  address: string;
  busy: boolean;
  /** The ask got no answer and is being made again, quietly. */
  retrying?: boolean;
  error: string;
  onAddressChange: (value: string) => void;
  onSignIn: () => void;
  onGetStarted: () => void;
  onBack?: (() => void) | undefined;
}

export function Welcome({
  address,
  busy,
  retrying,
  error,
  onAddressChange,
  onSignIn,
  onGetStarted,
  onBack,
}: WelcomeProps) {
  const valid = !!normalizeSpaceAddress(address);
  const disabled = !valid || busy;
  const go = (): void => {
    if (!disabled) onSignIn();
  };
  return (
    <Panel
      below={
        <Links>
          <TextButton testID="get-started" label="New here?" disabled={busy} onPress={onGetStarted} />
        </Links>
      }
      bar={
        <Bar
          {...(onBack ? { onBack } : {})}
          cont={
            <Button
              testID="resolve-space"
              label={busy ? (retrying ? RECONNECTING : "Finding your Space") : "Continue"}
              busy={busy}
              disabled={!valid}
              onPress={go}
            />
          }
        />
      }
    >
      <Step id="welcome">
        <Title title="Sign in" />
        <Group>
          <Field
            testID="space-address"
            label="Space"
            value={address}
            onChange={onAddressChange}
            onSubmit={go}
            placeholder={ADDRESS_PLACEHOLDER}
            autoComplete="url"
            autoFocus
            error={!!error}
          />
        </Group>
        <AddressHint testID="space-error" value={address} error={error} />
      </Step>
    </Panel>
  );
}
