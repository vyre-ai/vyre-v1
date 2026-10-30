// Provider setup follows verified account creation. No local state can claim a subscription succeeded.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { Bar, Button, ErrorLine, Foot, Group, JoinFrame, Panel, Row, Step, TextButton, Title } from "../../join/kit.tsx";
import type { JoinValues } from "../../join/JoinFlow.tsx";
import { createCapCaller } from "./caps.ts";
import { addJoinedApiKey } from "./join-provider.ts";
import type { StoredSession } from "./stored.ts";
import { SignInPanel } from "../../ai-signin/SignInPanel.tsx";
import { startFlow } from "../../ai-signin/flow.ts";
import type { Flow } from "../../ai-signin/flow.ts";

export function JoinProviderSetup({ stored, ai, onOpen, onClearSecret }: { stored: StoredSession; ai: JoinValues["ai"]; onOpen: () => void; onClearSecret: () => void }): ReactElement {
  const call = useMemo(() => createCapCaller({ baseUrl: stored.baseUrl, token: () => stored.token }), [stored]);
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
    } catch (e) { if (alive.current) setError((e as { code?: string }).code === "auth.unauthenticated" ? "Your Mine vault is locked here. Connect this account from your own computer, or continue and set it up in Vault later." : "Couldn’t save this provider. Your account is ready. Check the connection and retry, or connect an account in Vault later."); }
    finally { if (alive.current) setBusy(false); }
  };
  const subscription = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const started = await startFlow(call, provider, `${attempt.current}:${Date.now()}`);
      if (alive.current) setFlow(started);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The sign-in could not start. Try again. Your assistant stays locked until a provider connects."); }
    finally { if (alive.current) setBusy(false); }
  };
  const key = ai.choice === "key";
  return <JoinFrame halftoneIntensity="calm"><Panel center bar={<Bar hideBack cont={<Button testID="joined-provider-continue" label={connected ? "Open Space" : busy ? "Connecting…" : key ? "Save API key" : `Sign in with ${provider === "codex" ? "ChatGPT" : provider === "grok" ? "Grok" : "Claude"}`} disabled={busy || (!!flow && !connected)} onPress={connected ? onOpen : () => void (key ? connectKey() : subscription())} />} />}><Step id="joined-provider"><Title title={connected ? key ? "Your API key is saved" : "Your AI account is connected" : "Connect your AI account"} sub={`Your account in ${stored.def.name} is ready.`} />{error ? <ErrorLine testID="joined-provider-error">{error}</ErrorLine> : null}{!connected && !key && !flow ? <Group>{(["claude-code", "codex", "grok"] as const).map((id) => <Row key={id} kind="option" title={id === "codex" ? "ChatGPT" : id === "grok" ? "Grok" : "Claude"} checked={provider === id} onPress={() => { setProvider(id); attempt.current = globalThis.crypto.randomUUID(); }} testID={`joined-provider-${id}`} />)}</Group> : null}{!connected && key ? <Foot>Your key will be stored in your Mine vault for {ai.providerKey}. Vyre has not saved it yet.</Foot> : null}{flow && !connected ? <SignInPanel call={call} flow={flow} onCancel={() => setFlow(null)} onDone={() => { if (alive.current) { setFlow(null); setConnected(true); } }} /> : null}{!connected ? <TextButton testID="joined-provider-later" label="Connect later" disabled={busy} onPress={() => { secret.current = ""; onOpen(); }} /> : null}</Step></Panel></JoinFrame>;
}
