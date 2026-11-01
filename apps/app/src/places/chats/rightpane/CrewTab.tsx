// Right pane > Crew (DESIGN-crew.md, step 3): one row per teammate working for this chat, what it is on in a few words and how it stands. A row opens the teammate's own thread beside the chat, where you can
// type to it directly; a finished one offers Merge, a running one offers Stop. The lead's chat stays calm: this list is where the crew lives, and the result card is where a finish arrives.
import type { ReactElement } from "react";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { PaneDeps } from "./actions.ts";
import { crewMerge, crewStop } from "./actions.ts";
import { PANE_SCREEN } from "./ThreadsTab.tsx";
import { usePaneData, useScreenQuery } from "./data.tsx";
import { crewNote } from "./model.ts";
import type { CrewJob } from "./model.ts";
import { Face, LeadIcon, PaneList, TextButton } from "./parts.tsx";
import type { Entry } from "./parts.tsx";

type CrewOut = CapMap["engine.crew.list"]["out"];

/** Which jobs wait for a person's yes: a finished teammate has work to merge. */
export const canMerge = (j: CrewJob): boolean => j.state === "done";
export const canStop = (j: CrewJob): boolean => j.state === "working" || j.state === "waiting";

export function CrewTab({ deps, window }: { deps: PaneDeps; window?: VirtualWindow }): ReactElement {
  const data = usePaneData();
  const q = useScreenQuery<CrewOut>(PANE_SCREEN, "crew", { threadId: data.threadId });
  const clock = data.clock();
  const jobs = q.status === "ready" ? q.data.jobs : [];
  const entries: Entry[] = [];
  if (jobs.length === 0) entries.push({ key: "none", type: "empty", text: "No teammates working for this chat.", testID: "crew-empty" });
  for (const j of jobs) {
    const name = j.name ?? "Teammate";
    entries.push({
      key: `j-${j.jobId}`, type: "row", title: `${name} · ${j.title}`, note: crewNote(j, clock), testID: `crew-${j.jobId}`,
      leading: <Face name={name} seedId={j.agentId} size={16} pulse={j.state === "working"} />,
      onPress: () => data.nav.openThread(j.threadId, "side"),
      trailing: (): ReactElement => (
        <>
          {canMerge(j) ? <TextButton label="Merge" primary onPress={() => { void crewMerge(deps, j.jobId, name, j.branch); }} testID={`crew-merge-${j.jobId}`} /> : null}
          {canStop(j) ? <TextButton label="Stop" onPress={() => { void crewStop(deps, j.jobId, name); }} testID={`crew-stop-${j.jobId}`} /> : null}
          {j.state === "merged" ? <LeadIcon name="check" /> : null}
        </>
      ),
    });
  }
  return <PaneList entries={entries} {...(window ? { window } : {})} testID="crew-list" />;
}
