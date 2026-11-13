// Can this person's assistant build connectors, or can the person make it so with one press? The doors that hand the assistant a connector task (Build a connector in the step picker, Bring in from your
// CRM and Edit mapping in Records) show only when it can (owner, 13 Nov 2026: "its beyond the scope of my assistant so then dont show that to me"). Pressing one of them allows it first.
import { useEffect, useState } from "react";
import type { ShellRuntime } from "./runtime.tsx";
import { openAskPane } from "../ask/pane.ts";
import { ALLOW_BUILD_LINE, builderGateFor, readyToBuild } from "../../places/vault/itemenv/automations.ts";
import type { BuilderStatus } from "../../places/vault/itemenv/automations.ts";

export interface Builds {
  /** Known, and the assistant either may build connectors or its person may give it that. */
  builds: boolean;
  /** Called when a door is pressed: allows the assistant when it is not yet (the person who may give it just asked for the task). */
  prepare(): Promise<void>;
  /** Said before the press while the assistant is not yet allowed: pressing also allows it. Null once it is. */
  note: string | null;
  /** The press: allows the assistant first, then runs `open`; a refusal or a failed grant is said in plain words in the Ask pane's hint, never swallowed. */
  press(place: string, open: () => void): void;
}

export function useAssistantBuilds(rt: ShellRuntime | null): Builds {
  const [st, setSt] = useState<BuilderStatus | null>(null);
  const agentId = rt?.assistant.id;
  useEffect(() => {
    if (!rt || !agentId) return undefined;
    let live = true;
    void (async () => {
      try {
        // nothing is granted by looking: a grant is given by a press that said so (press below)
        const out = (await rt.call("access.connector_builder.status" as never, { agentId } as never)) as BuilderStatus;
        if (live) setSt(out);
      } catch {
        if (live) setSt(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [rt, agentId]);
  const prepare = (): Promise<void> =>
    rt && agentId
      ? readyToBuild((cap, input) => Promise.resolve(rt.call(cap as never, input as never)), agentId)
      : Promise.reject(new Error("Your assistant is not ready yet."));
  return {
    builds: st !== null && ["ready", "no_builder"].includes(builderGateFor(st).state),
    note: st !== null && builderGateFor(st).state === "no_builder" ? ALLOW_BUILD_LINE : null,
    prepare,
    press: (place, open) => {
      void prepare().then(open, (e: unknown) =>
        openAskPane(
          {
            thing: null,
            hint: e instanceof Error && e.message ? e.message : "Your assistant could not be allowed to do that.",
          },
          place as never,
        ),
      );
    },
  };
}
