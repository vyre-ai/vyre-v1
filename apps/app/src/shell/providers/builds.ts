// Can this person's assistant build connectors, or can the person make it so with one press? The doors that hand the assistant a connector task (Build a connector in the step picker, Bring in from your
// CRM and Edit mapping in Records) show only when it can (owner, 13 Nov 2026: "its beyond the scope of my assistant so then dont show that to me"). Pressing one of them allows it first.
import { useEffect, useState } from "react";
import type { ShellRuntime } from "./runtime.tsx";
import { readyToBuild } from "../../places/vault/itemenv/automations.ts";
import type { BuilderStatus } from "../../places/vault/itemenv/automations.ts";

export interface Builds {
  /** Known, and the assistant either may build connectors or its person may give it that. */
  builds: boolean;
  /** Called when a door is pressed: allows the assistant when it is not yet (the person who may give it just asked for the task). */
  prepare(): Promise<void>;
}

export function useAssistantBuilds(rt: ShellRuntime | null): Builds {
  const [st, setSt] = useState<BuilderStatus | null>(null);
  const agentId = rt?.assistant.id;
  useEffect(() => {
    if (!rt || !agentId) return undefined;
    let live = true;
    void (async () => {
      try {
        let out = (await rt.call("access.connector_builder.status" as never, { agentId } as never)) as BuilderStatus;
        // a Personal Space is the person's own: their assistant is allowed to build connectors without a press
        if (!out.allowed && out.canGrant && rt.space.kind === "personal") {
          await rt.call("access.connector_builder.grant" as never, { agentId } as never);
          out = { ...out, allowed: true };
        }
        if (live) setSt(out);
      } catch {
        if (live) setSt(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [rt, agentId]);
  return {
    builds: st !== null && (st.allowed || st.canGrant),
    prepare: () =>
      rt && agentId
        ? readyToBuild((cap, input) => Promise.resolve(rt.call(cap as never, input as never)), agentId)
        : Promise.reject(new Error("Your assistant is not ready yet.")),
  };
}
