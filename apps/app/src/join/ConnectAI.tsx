// join/ConnectAI: the last account step (spec 3.13, 4.14). The assistant needs an AI account to answer. Three ways in, or not now.
// The person's own subscription, their own key (kept in the vault, never shown again), or the key an admin shares with the Space.
import { View } from "react-native";
import { Foot, Group, FieldRow, Links, Row, Segments, TextButton, Title, ErrorLine } from "./kit.tsx";
import type { AiChoice, JoinInvite } from "./logic.ts";

export interface ConnectAIProps {
  invite: Pick<JoinInvite, "space" | "email" | "adminKey">;
  ai: AiChoice;
  apiKey: string;
  /** "subok" once the subscription sign-in finished */
  note: string;
  providerKey?: "openrouter" | "anthropic" | "openai";
  onProvider?: (key: "openrouter" | "anthropic" | "openai") => void;
  error?: string;
  onPick: (ai: AiChoice) => void;
  onKey: (v: string) => void;
  onSubscribe: () => void;
}

export function aiOptions(invite: Pick<JoinInvite, "space" | "adminKey">): { id: AiChoice; title: string; help: string }[] {
  const o: { id: AiChoice; title: string; help: string }[] = [
    { id: "sub", title: "Claude, ChatGPT or Grok", help: "Sign in with your plan" },
    { id: "key", title: "API key", help: "Kept in your Vault" },
  ];
  if (invite.adminKey) o.push({ id: "admin", title: `The key from ${invite.space}`, help: "Spend counts toward the Space" });
  return o;
}

export function ConnectAI({ invite, ai, apiKey, error, onPick, onKey, providerKey = "openrouter", onProvider }: ConnectAIProps) {
  const name = providerKey === "openrouter" ? "OpenRouter" : providerKey === "anthropic" ? "Anthropic" : "OpenAI";
  return (
    <View>
      <Title title="Connect your AI" />
      <Group testID="ai-options">
        {aiOptions(invite).map((o) => <Row kind="option" key={o.id} testID={`ai-${o.id}`} title={o.title} help={o.help} checked={ai === o.id} onPress={() => onPick(o.id)} />)}
      </Group>
      {ai === "key" ? (
        <Group top={12}>
          <Segments label="Provider" value={providerKey} onChange={(key) => onProvider?.(key)} options={[{ id: "openrouter", title: "OpenRouter", testID: "ai-provider-openrouter" }, { id: "anthropic", title: "Anthropic", testID: "ai-provider-anthropic" }, { id: "openai", title: "OpenAI", testID: "ai-provider-openai" }]} />
          <FieldRow label={`${name} API key`} value={apiKey} onChange={onKey} placeholder="Paste your API key" secure testID="ai-key-field" />
        </Group>
      ) : null}
      {ai === "sub" ? <Foot testID="ai-subscribe-after-join" top={12}>You sign in after joining</Foot> : null}
      <ErrorLine testID="join-error">{error}</ErrorLine>
      {ai === "none" ? <Foot testID="ai-locked" top={4}>Your assistant waits until you connect one</Foot> : <Links><TextButton testID="ai-none" label="Not now" onPress={() => onPick("none")} /></Links>}
    </View>
  );
}
