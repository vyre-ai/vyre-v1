// The first thing a person meets after the account exists (prototype scenes personal-3-ai, team-3-ai, member-4-ai): one card, Connect your AI, and a way past it. Everything else the old six-step
// setup asked (how you work, Chrome, phone, a team) waits as rows beside the chat. "Not now" goes to the chat; connecting an AI goes there too. The card is the join kit's, the AI choices are the
// same ConnectAiCard the Vault and the setup steps use. "Not now" keeps the id the wide setup screen gave its Finish later, so every place that leaves onboarding the same way still does.
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { JoinFrame, Links, Panel, Step, TextButton, Title } from "../join/kit.tsx";

export function FirstEntry({
  title,
  sub,
  onNotNow,
  children,
}: {
  title: string;
  sub?: string;
  onNotNow(): void;
  children: ReactNode;
}): ReactElement {
  return (
    <View testID="onboarding" style={{ flex: 1 }}>
      <JoinFrame>
        <Panel
          below={
            <Links>
              <TextButton testID="onboarding-close" label="Not now" onPress={onNotNow} />
            </Links>
          }
        >
          <Step id="first-ai">
            <Title title={title} {...(sub ? { sub } : {})} />
            <View testID="first-entry-card" style={{ marginTop: 18 }}>
              {children}
            </View>
          </Step>
        </Panel>
      </JoinFrame>
    </View>
  );
}
