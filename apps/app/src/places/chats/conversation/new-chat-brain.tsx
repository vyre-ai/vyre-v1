// The model menu for a chat that does not exist yet (the first screen): the choices are held here and go in with chat.start. It reads the same accounts and models the open chat's menu reads, and asks for no
// usage: a chat that has not started has none, so its limits stay out rather than guessed.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { ModelPanel } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import type { PanelAccount, PanelModel, PanelScope } from "../../../../../../ui/src/Composer/ModelPanel.tsx";
import type { ChatMode, ComposerAgent, Effort } from "../../../../../../ui/src/Composer/brain.ts";
import { useOpenConnect } from "../../../shell/connect/context.ts";
import { prettyModel } from "./brain.tsx";

export interface NewChoice { mode: ChatMode; model?: string; modelTitle?: string; provider?: string; accountRef?: string; effort?: Effort }

/** What the pill says before the chat exists. */
export function newChatStrip(lead: { id: string; name: string; kind: string }, c: NewChoice, accounts: readonly PanelAccount[]): ComposerAgent {
  const provider = c.provider ?? accounts[0]?.provider;
  return {
    id: lead.id, name: lead.name, kind: lead.kind === "assistant" ? "assistant" : "agent",
    ...(provider ? { provider } : {}), ...(c.model ? { modelTitle: c.modelTitle ?? prettyModel(c.model) } : {}), ...(c.effort ? { effort: c.effort } : {}),
  };
}

export function NewChatBrain({ data, agent, accounts, choice, onChoice, close, narrow }: {
  data: { call(cap: string, input: unknown): Promise<unknown> }; agent: ComposerAgent; accounts: readonly PanelAccount[] | null; choice: NewChoice; onChoice(next: (c: NewChoice) => NewChoice): void; close(): void; narrow: boolean;
}): ReactElement {
  const [scope, setScope] = useState<PanelScope>("chat");
  const [models, setModels] = useState<PanelModel[] | null>(null);
  const openConnect = useOpenConnect();
  const shownRef = choice.accountRef ?? accounts?.[0]?.ref ?? null;
  useEffect(() => {
    let live = true;
    setModels(null);
    void Promise.resolve(data.call("engine.models.list", { ...(shownRef ? { accountRef: shownRef } : {}) })).then((out) => {
      if (!live) return;
      const list = (out as { models?: { model: string; title: string; contextTokens?: number; allowed: boolean; reason?: string }[] } | undefined)?.models ?? [];
      setModels(list.map((m) => ({ id: m.model, title: m.title, allowed: m.allowed, ...(m.contextTokens ? { window: m.contextTokens } : {}), ...(m.reason ? { reason: m.reason === "not_connected" ? "Not connected" : "Not allowed here" } : {}), ...(m.model === "auto" ? { note: "Picks per message" } : {}) })));
    }, () => { if (live) setModels([]); });
    return () => { live = false; };
  }, [data, shownRef]);
  return (
    <ModelPanel
      agent={agent} scope={scope} onScope={setScope} accounts={accounts} accountRef={shownRef}
      onAccount={(ref) => { const provider = accounts?.find((a) => a.ref === ref)?.provider; onChoice((c) => { const { model: _m, modelTitle: _t, ...rest } = c; return { ...rest, accountRef: ref, ...(provider ? { provider } : {}) }; }); }}
      models={models} model={choice.model ?? null}
      onModel={(id) => { const title = models?.find((m) => m.id === id)?.title; onChoice((c) => ({ ...c, model: id, ...(title ? { modelTitle: title } : {}) })); }}
      effort={choice.effort} onEffort={(e) => onChoice((c) => ({ ...c, effort: e }))}
      usage={null} mode={choice.mode} onMode={(m) => onChoice((c) => ({ ...c, mode: m }))}
      onAddProvider={() => { close(); void openConnect?.({ kind: "ai" }); }}
      onClose={close} narrow={narrow} below
    />
  );
}
