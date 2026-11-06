// Mount for lane l-chatrely (owner, 6 Nov): the first screen starts a new chat on the model the person picked last, so the composer already shows it (here GLM 5 on OpenCode Go, high effort).
// ?part=landing is the first screen over the Northwind sample with a remembered pick.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Landing } from "../../../apps/app/src/places/chats/landing/Landing.tsx";
import { createSample } from "../../../apps/app/src/places/chats/conversation/sample.ts";
import { ResumeContext } from "../../../apps/app/src/onboarding/resume-context.ts";
import type { ShellRuntime } from "../../../apps/app/src/shell/providers/runtime.tsx";

export const title = "First screen on the last pick";
const noop = (): void => undefined;
const ready = (data: unknown) => { const snap = { status: "ready" as const, data }; return { subscribe: () => () => undefined, getSnapshot: () => snap }; };

export default function Mount(): ReactNode {
  const rt = useMemo(() => {
    const conv = createSample("idle");
    const me = { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" as const };
    const fixed: Record<string, unknown> = {
      "tasks.my-work.needs": ready({ items: [], total: 0 }),
      "chats.sidebar.recent": ready({ starred: [], today: [], yesterday: [], earlier: [], archived: [], nextUnread: null }),
    };
    const screens = { query: (id: string, name: string, state: unknown) => (fixed[`${id}.${name}`] as never) ?? conv.data.screens.query(id, name, state as never) };
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "engine.last_pick.get") return { model: "glm-5", provider: "opencode-go", effort: "high" };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_assistant", name: "Assistant", kind: "assistant" }] };
      if (cap === "engine.accounts.list") return { accounts: [
        { ref: "#space_oc", driver: "opencode-go", kind: "api_key", title: "OpenCode Go", name: "Northwind OpenCode", mine: false, status: "ok" },
        { ref: "#mine_oc", driver: "opencode-go", kind: "api_key", title: "OpenCode Go", name: "My OpenCode", mine: true, status: "ok" },
      ] };
      return conv.data.call(cap as never, input as never);
    };
    return { screens, call, connection: conv.data.connection, principals: { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: [me] }) }, recordTitle: () => undefined, me, clock: conv.data.clock,
      space: { id: "northwind", kind: "personal", name: "Personal" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: false, open: noop, openUrl: noop } as unknown as ShellRuntime;
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: "var(--win)" as string }}>
      <ResumeContext.Provider value={{ done: 8, total: 8, open: noop, pill: null }}>
        <Landing rt={rt} nameOf={(id) => id} kindOf={() => "agent"} agents={[]} people={[]} openChat={noop} openTasks={noop} openNeed={noop} openProfile={noop} fill={noop} newKey={() => "k"} say={noop} />
      </ResumeContext.Provider>
    </View>
  );
}
