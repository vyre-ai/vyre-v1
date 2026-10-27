// join/ConnectAI: the last account step (spec 3.13, 4.14). The assistant needs an AI account to answer. Three ways in, or not now.
// The person's own subscription, their own key (kept in the vault, never shown again), or the key an admin shares with the Space.
import { Text, View } from "react-native";
import { Foot, Group, FieldRow, Row, AppIcon, Title, TextButton, baseText, useJoin, ErrorLine } from "./kit.tsx";
import type { AiChoice, JoinInvite } from "./logic.ts";

export interface ConnectAIProps {
  invite: Pick<JoinInvite, "space" | "email" | "adminKey">;
  ai: AiChoice;
  apiKey: string;
  /** "subok" once the subscription sign-in finished */
  note: string;
  error?: string;
  onPick: (ai: AiChoice) => void;
  onKey: (v: string) => void;
  onSubscribe: () => void;
}

export function aiOptions(invite: Pick<JoinInvite, "space" | "adminKey">): { id: AiChoice; title: string; help: string }[] {
  const o: { id: AiChoice; title: string; help: string }[] = [
    { id: "sub", title: "Use my subscription", help: "Sign in with Claude, ChatGPT or Codex. Your usage stays on your plan." },
    { id: "key", title: "Use my own key", help: "Paste an API key. Vyre stores it in your vault and never shows it again." },
  ];
  if (invite.adminKey) o.push({ id: "admin", title: `Use the key from ${invite.space}`, help: "An admin provides a shared key. Spend counts toward the Space limit." });
  return o;
}

function InlineLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const { p } = useJoin();
  return <Text accessibilityRole="link" testID={testID} onPress={onPress} style={{ color: p.blue }}>{label}</Text>;
}

export function ConnectAI({ invite, ai, apiKey, note, error, onPick, onKey, onSubscribe }: ConnectAIProps) {
  const { p } = useJoin();
  return (
    <View>
      <AppIcon kind="ai" />
      <Title title="Connect an AI account" sub="Your assistant needs an account to answer. You can change this in Settings." />
      {error ? <ErrorLine testID="join-error">{error}</ErrorLine> : null}
      <Group testID="ai-options">
        {aiOptions(invite).map((o) => <Row kind="option" key={o.id} testID={`ai-${o.id}`} title={o.title} help={o.help} checked={ai === o.id} onPress={() => onPick(o.id)} />)}
      </Group>
      {ai === "key" ? (
        <Group top={24}>
          <FieldRow label="API key" value={apiKey} onChange={onKey} placeholder="Paste your API key" secure testID="ai-key-field" />
        </Group>
      ) : null}
      {ai === "sub" ? (
        <Group top={24}>
          <Row>
            <Text style={[baseText(p), { flex: 1 }]}>Claude account</Text>
            <TextButton testID="ai-subscribe" label={note === "subok" ? `Connected as ${invite.email ?? "your account"}` : "Sign in…"} onPress={onSubscribe} />
          </Row>
        </Group>
      ) : null}
      {ai === "none" ? (
        <Foot testID="ai-locked" top={14}>Your assistant is locked. It can read its welcome note but cannot run until an account is connected.</Foot>
      ) : (
        <Foot top={8}><InlineLink testID="ai-none" label="Not now" onPress={() => onPick("none")} /> locks the assistant until you connect an account.</Foot>
      )}
    </View>
  );
}
