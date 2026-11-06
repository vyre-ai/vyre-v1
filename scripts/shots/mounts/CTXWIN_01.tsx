// Mount for CTXWIN_01 (lane l-ctxwin): the composer's model panel with real windows: the Context row reads "42% of 1M" and each model in the picker carries its window ("1M context").
import { useState } from "react";
import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { Composer, ModelPanel } from "../../../ui/src/Composer/index.tsx";
import type { ChatMode, ComposerAgent, ComposerLists, Effort, PanelAccount, PanelModel } from "../../../ui/src/Composer/index.tsx";

export const title = "Model panel with context windows";

const lists: ComposerLists = { agents: [{ t: "Intake", ref: "agt_intake", kind: "Agent", s: "Leads this chat" }], people: [] };
const agents: ComposerAgent[] = [{ id: "agt_intake", name: "Intake", provider: "claude_code", modelTitle: "Opus 5.5", effort: "high", context: { used: 420_000, window: 1_000_000 } }];
const ACCTS: PanelAccount[] = [{ ref: "#cl", name: "Claude Code", provider: "claude_code", session: 0.31 }];
const MODELS: PanelModel[] = [
  { id: "claude-opus-5-5", title: "Opus 5.5", note: "Default", window: 1_000_000 },
  { id: "claude-sonnet-5-5", title: "Sonnet 5.5", window: 1_000_000 },
  { id: "claude-haiku-5-5", title: "Haiku 5.5", window: 1_000_000 },
  { id: "claude-sonnet-4-5", title: "Sonnet 4.5", window: 200_000 },
  { id: "gpt-5-codex", title: "GPT-5 Codex", window: 258_400 },
  { id: "grok-4.6", title: "Grok 4.6", window: 500_000 },
];

export default function Mount(): ReactNode {
  const narrow = useWindowDimensions().width < 600;
  const [model, setModel] = useState("claude-opus-5-5");
  const [effort, setEffort] = useState<Effort>("high");
  const [mode, setMode] = useState<ChatMode>("ask");
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", padding: 24, maxWidth: 760, alignSelf: "center", width: "100%" }}>
      <Composer whoWillAnswer="" lead="Intake" lists={lists} agents={agents} mode={mode} onMode={setMode}
        renderPanel={(agent, close) => (
          <ModelPanel narrow={narrow} agent={agent} scope="chat" onScope={() => undefined} accounts={ACCTS} accountRef="#cl" onAccount={() => undefined}
            models={MODELS} model={model} onModel={setModel} effort={effort} onEffort={setEffort}
            usage={{ context: { used: 420_000, window: 1_000_000 }, session: { pct: 0.31 }, week: { pct: 0.12 } }} mode={mode} onMode={setMode} onClose={close} now={0} />
        )} />
    </View>
  );
}
