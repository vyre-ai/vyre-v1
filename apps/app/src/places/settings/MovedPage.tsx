// "Connected" and "Email and calendar" left Settings: app connections live in Vault, and adding an inbox or a calendar is Inbox's "Add an account". The old pages are a line saying so and one button.
import type { ReactElement } from "react";
import { useSettingsData } from "./data.tsx";
import { Glyph, Section, SettingsRow, SmallButton } from "./ui.tsx";

export function MovedPage({ kind }: { kind: "vault" | "inbox" }): ReactElement {
  const data = useSettingsData();
  const vault = kind === "vault";
  return (
    <Section testID={`moved-${kind}`}>
      <SettingsRow
        id={`moved.${kind}`} first lead={<Glyph name={vault ? "key" : "mail"} size={16} />}
        label={vault ? "Your app connections are in Vault" : "Add an inbox or a calendar from Inbox"}
        sub={vault ? "Google, GitHub, mail, calendars and the rest sit next to your keys and sign-ins. Agents use them as before." : "Use Add an account at the foot of the Inbox sidebar. Once it is connected, Vault lists it under Connections."}
        control={<SmallButton label={vault ? "Open Vault" : "Add an account"} testID={`moved-${kind}-go`} onPress={() => (vault ? data.nav.openVault() : data.nav.openInbox?.())} />}
      />
    </Section>
  );
}
