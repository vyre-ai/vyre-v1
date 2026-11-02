// Provider setup follows verified account creation. No local state can claim a subscription succeeded.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Bar, Button, ErrorLine, Group, JoinFrame, Links, Panel, Row, Step, TextButton, Title } from "../../join/kit.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { createCapCaller } from "./caps.ts";
import { addJoinedApiKey } from "./join-provider.ts";
import type { StoredSession } from "./stored.ts";
import { SignInPanel } from "../../ai-signin/SignInPanel.tsx";
import { startFlow } from "../../ai-signin/flow.ts";
import type { Flow } from "../../ai-signin/flow.ts";
import { ownAiRefusal } from "../../ai-signin/own-ai.ts";
import { statusNote, useSpaceAi } from "../../ai-signin/SpaceAiStatus.tsx";
import type { SpaceAiRead } from "../../ai-signin/SpaceAiStatus.tsx";
import type { AiHome } from "../../ai-signin/own-ai.ts";

/** `home`: where the Space runs, for the words of a refusal (own-ai.ts). Above the choices, whether this Space's AI key already covers the person, and who can add one (the inviter
 *  when the Space's people list cannot say). `spaceAi` gives that answer up front (tests and screenshots). */
export function JoinProviderSetup({ stored, ai, onOpen, onClearSecret, home = "computer", invitedBy, spaceAi }: { stored: StoredSession; ai: JoinValues["ai"]; onOpen: () => void; onClearSecret: () => void; home?: AiHome; invitedBy?: string; spaceAi?: SpaceAiRead }): ReactElement {
  const call = useMemo(() => createCapCaller({ baseUrl: stored.baseUrl, token: () => stored.token }), [stored]);
  const covered = useSpaceAi(call, { ...(invitedBy ? { fallbackAdmin: invitedBy } : {}), ...(spaceAi ? { initial: spaceAi } : {}) });
  const secret = useRef(ai.key ?? "");
  const attempt = useRef(globalThis.crypto.randomUUID());
  const [provider, setProvider] = useState<"claude-code" | "codex" | "grok">("claude-code");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    onClearSecret();
    return () => { alive.current = false; queueMicrotask(() => { if (!alive.current) secret.current = ""; }); };
    // The initial key is moved out of parent state once, then held only until use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const connectKey = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await addJoinedApiKey(call, { ...ai, key: secret.current }, attempt.current);
      secret.current = "";
      if (alive.current) setConnected(true);
    } catch (e) { if (alive.current) setError(ownAiRefusal(e, home) ?? "Couldn’t save this provider. Your account is ready. Check the connection and retry, or connect an account in Vault later."); }
    finally { if (alive.current) setBusy(false); }
  };
  const subscription = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const started = await startFlow(call, provider, `${attempt.current}:${Date.now()}`, home);
      if (alive.current) setFlow(started);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The sign-in could not start. Try again. Your assistant stays locked until a provider connects."); }
    finally { if (alive.current) setBusy(false); }
  };
  const key = ai.choice === "key";
  return (
    <JoinFrame>
      <Panel
        below={!connected ? <Links><TextButton testID="joined-provider-later" label={covered.covered ? "Continue with the Space key" : "Connect later"} disabled={busy} onPress={() => { secret.current = ""; onOpen(); }} /></Links> : undefined}
        bar={<Bar hideBack cont={<Button testID="joined-provider-continue" label={connected ? "Open Space" : busy ? "Connecting" : key ? "Save API key" : `Sign in with ${provider === "codex" ? "ChatGPT" : provider === "grok" ? "Grok" : "Claude"}`} busy={busy} disabled={!!flow && !connected} onPress={connected ? onOpen : () => void (key ? connectKey() : subscription())} />} />}
      >
        <Step id="joined-provider">
          <Title title={connected ? "Your AI is connected" : "Connect your AI"} sub={stored.def.name} />
          {!connected ? <Group top={12} testID="joined-space-ai"><Row kind="check" testID="joined-space-ai-row" title={covered.title} sub={statusNote(covered)} done={covered.covered} /></Group> : null}
          {!connected && !key && !flow ? <Group>{(["claude-code", "codex", "grok"] as const).map((id) => <Row key={id} kind="option" title={id === "codex" ? "ChatGPT" : id === "grok" ? "Grok" : "Claude"} checked={provider === id} onPress={() => { setProvider(id); attempt.current = globalThis.crypto.randomUUID(); }} testID={`joined-provider-${id}`} />)}</Group> : null}
          {flow && !connected ? <SignInPanel call={call} flow={flow} home={home} onCancel={() => setFlow(null)} onDone={() => { if (alive.current) { setFlow(null); setConnected(true); } }} /> : null}
          <ErrorLine testID="joined-provider-error">{error}</ErrorLine>
        </Step>
      </Panel>
    </JoinFrame>
  );
}
