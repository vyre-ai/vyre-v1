// Mount for P-UI_05: the shared faces and brand icons as the Vault and the chat sidebar draw them. ?screen=vault lists the Northwind Vault items with their brand tiles;
// the default lists the Northwind people and agents with their faces. Both use the shared Row with a leading slot.
import type { ReactNode } from "react";
import { View } from "react-native";
import { AppIcon } from "../../../ui/src/AppIcon/index.tsx";
import { Avatar } from "../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../ui/src/Row/index.tsx";
import type { AvatarKind } from "../../../ui/src/Avatar/index.tsx";

export const title = "Faces and brand icons";

const PEOPLE: readonly (readonly [string, AvatarKind, string])[] = [
  ["Maya Chen", "person", "Admin"], ["Omar Haddad", "person", "Member"], ["Lena Ortiz", "person", "Member"], ["Sam Patel", "person", "Member"],
  ["Assistant", "agent", "Agent"], ["Scheduler", "agent", "Agent"], ["Proofer", "agent", "Agent"], ["Intake", "agent", "Agent"], ["Billing", "agent", "Agent"], ["Research", "agent", "Agent"],
  ["Admins", "group", "Group, 2 people"], ["Invoice reminders", "automation", "Automation"],
];
const VAULT: readonly (readonly [string, string, string])[] = [
  ["claude", "Claude", "Claude Max"], ["openai", "OpenAI key", "OPENAI_API_KEY, OPENAI_ORG_ID"], ["opencode", "OpenCode Go key", "OPENCODE_API_KEY"], ["ghl", "GoHighLevel", "GHL_PIT, GHL_LOCATION_ID"],
  ["twilio", "Twilio, Support line", "TWILIO_ACCOUNT_SID"], ["stripe", "Stripe", "STRIPE_SECRET_KEY"], ["google", "Google Workspace", "ops@northwind.example"], ["card", "Company card", "Visa"],
  ["gcp", "Google service account", "CLIENT_EMAIL"], ["db", "Postgres, Northwind prod", "DATABASE_URL"], ["github", "GitHub token", "GITHUB_TOKEN"], ["notion", "Notion", "irfad@northwind.example"],
];

export default function Mount(): ReactNode {
  const vault = ((globalThis as { location?: { search?: string } }).location?.search ?? "").includes("screen=vault");
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string, padding: 12, maxWidth: 420 }}>
      {vault
        ? VAULT.map(([brand, name, note]) => <Row key={brand} id={brand} title={name} note={note} leading={<View style={{ marginRight: 10 }}><AppIcon brand={brand} name={name} size={28} /></View>} />)
        : PEOPLE.map(([name, kind, note]) => <Row key={name} id={name} title={name} note={note} leading={<View style={{ marginRight: 10 }}><Avatar name={name} kind={kind} size={28} /></View>} />)}
    </View>
  );
}
