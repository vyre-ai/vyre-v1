// Mount for direct AI sign-in: onboarding's Connect your AI and the Vault's Add an AI provider (Settings > AI accounts), over scripted answers. ?part=
//   onboarding (the three Sign in with buttons), onboarding-claude (link and code field), onboarding-chatgpt (link and code to type), settings-claude, settings-chatgpt, settings-grok-missing
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConnectAiCard } from "../../../apps/app/src/onboarding/ConnectAiCard.tsx";
import { OnboardingScreen } from "../../../apps/app/src/onboarding/OnboardingScreen.tsx";
import { AddProvider } from "../../../apps/app/src/places/vault/providers/AddProvider.tsx";
import { VaultDataProvider } from "../../../apps/app/src/places/vault/layout/data.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import type { Flow } from "../../../apps/app/src/ai-signin/flow.ts";

export const title = "Direct AI sign-in";

const noop = (): void => undefined;
const call = (async () => ({})) as never;
const CLAUDE: Flow & { provider: string } = { provider: "claude-code", flowId: "sub_1", instruction: "x", url: "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a&state=abc", needsCode: true };
const CHATGPT: Flow & { provider: string } = { provider: "codex", flowId: "sub_2", instruction: "x", url: "https://auth.openai.com/codex/device", userCode: "KQ7M-2XPD", needsCode: false };

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "onboarding"), []);
  const sample = useMemo(() => createSampleVault(northwind), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part.startsWith("settings")) {
    const grok = part === "settings-grok-missing";
    const flow = part === "settings-chatgpt" ? CHATGPT : CLAUDE;
    return (
      <VaultDataProvider value={sample.data}>
        <View style={{ flex: 1, minHeight: 760, backgroundColor: "var(--win)" as string }}>
          <AddProvider onClose={noop} onAdded={noop} initial={{ providerKey: grok ? "grok" : flow.provider, connection: "subscription" }} {...(grok ? {} : { initialFlow: flow })} />
        </View>
      </VaultDataProvider>
    );
  }
  const flow = part === "onboarding-claude" ? CLAUDE : part === "onboarding-chatgpt" ? CHATGPT : undefined;
  return <OnboardingScreen key={part} flow="personal" spaceName="Personal" progress={{}} stepKey="ai" live={false} onStep={noop} onClose={noop} renderCard={() => <ConnectAiCard call={call} onConnected={noop} {...(flow ? { initialFlow: flow } : {})} />} />;
}
