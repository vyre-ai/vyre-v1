// Mount for lane l-goals: the real Chats place (ChatsMounted over the sample Space's runtime, inside the shell) with the goals capabilities answered from apps/app/src/places/chats/goals/sample.ts.
//   ?part=page (the goal page; the Goals group in the sidebar), landing (the first screen, Goals under the composer), cards (the goal blocks a chat carries: draft, check-in, stuck, missed, done)
//   ?state=active | stuck | budget | paused | missed | done | draft (the goal page's state)
// The query is read after mount (rule 25), so the first frame is empty and the client draws the same one.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { Shell } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import type { PlaceContext } from "../../../apps/app/src/shell/spaces/Shell.tsx";
import { createSampleShell, samplePlace } from "../../../apps/app/src/shell/spaces/sample.tsx";
import { ChatsMounted } from "../../../apps/app/src/places/chats/mounts/ChatsMounted.tsx";
import { createMountSample, PEOPLE } from "../../../apps/app/src/places/chats/mounts/sample.ts";
import { START, step } from "../../../apps/app/src/places/chats/mounts/route.ts";
import { goalsCall } from "../../../apps/app/src/places/chats/goals/sample.ts";
import type { SampleState } from "../../../apps/app/src/places/chats/goals/sample.ts";
import { GoalCard } from "../../../apps/app/src/places/chats/goals/GoalCard.tsx";
import { GoalPage } from "../../../apps/app/src/places/chats/goals/GoalPage.tsx";
import type { GoalBlock } from "../../../apps/app/src/places/chats/goals/model.ts";

export const title = "Goals";

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
const MORE_PEOPLE = [...PEOPLE, { id: "agt_labdesk", name: "Lab Desk", kind: "agent" as const }, { id: "agt_content", name: "Content", kind: "agent" as const }, { id: "usr_aliza", name: "Aliza Khan", kind: "person" as const }];

function Inner({ search }: { search: string }): ReactNode {
  const height = useWindowDimensions().height;
  const made = useMemo(() => {
    const query = new URLSearchParams(search);
    const skin = query.get("skin") ?? "paper";
    const root = (globalThis as { document?: { documentElement?: RootLike } }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    const theme = createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin, hb: skin, me: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
    const hub = createSampleShell({ openId: "nw", theme });
    hub.go("chats");
    const sample = createMountSample();
    const state = (query.get("state") ?? "active") as SampleState;
    const now = sample.rt.clock().now;
    const call = goalsCall(sample.rt.call as (cap: string, input: unknown) => Promise<unknown>, now, state);
    const ready = { status: "ready" as const, data: MORE_PEOPLE };
    sample.rt = { ...sample.rt, call: call as typeof sample.rt.call, principals: { subscribe: () => () => undefined, getSnapshot: () => ready } as typeof sample.rt.principals };
    const part = query.get("part") ?? "page";
    const shown = part === "landing" ? START : step(START, { t: "goal", goalId: "gol_lab8" });
    return { hub, theme, sample, shown, part, call, now };
  }, [search]);
  if (made.part === "cards") return <Cards call={made.call} now={made.now} />;
  // the goal page on its own, as a phone shows it after a tap on its row
  if (made.part === "alone") return <View style={{ height }}><GoalPage goalId="gol_lab8" call={made.call} changes={undefined} me="usr_irfad" nameOf={(id) => MORE_PEOPLE.find((x) => x.id === id)?.name ?? id} clock={made.sample.rt.clock} conversationFor={() => { throw new Error("no chat in this shot"); }} openTask={() => undefined} openAgent={() => undefined} /></View>;
  const renderPlace = (ctx: PlaceContext): ReactNode => (ctx.place === "chats"
    ? <ChatsMounted key={ctx.spaceId} rt={made.sample.rt} initial={made.shown} window={{ start: 0, end: 500 }} />
    : samplePlace(ctx));
  return <View style={{ height }}><Shell hub={made.hub} theme={made.theme} renderPlace={renderPlace} /></View>;
}

function Cards({ call, now }: { call: (cap: string, input: unknown) => Promise<unknown>; now: number }): ReactNode {
  const cards = useMemo(() => {
  const base = { goalId: "gol_lab8", threadId: "thr_goal", title: "300 registrations for Lab 8", line: "Luma registrations for Lab 8 reach 300 by Fri 7 Nov, 18:00", unit: "registrations", deadline: now + 3 * 86_400_000 };
  const blocks: GoalBlock[] = [
    { ...base, kind: "draft", status: "draft", target: 300, plan: ["Remind Lab 7 attendees who have not registered (31% registered after one reminder last time)", "Post Lab 8 in the community (the last post brought most first-time registrations)", "Ask Aliza for two reels from the Lab 7 recording"], permissions: ["Post in the MLA AI Labs community", "Send email from the Lab template to Lab 8 registrants"] },
    { ...base, kind: "update", status: "active", value: 212, prev: 194, target: 300, summary: "212, behind pace by 30. The Skool post brought 11 and the reels 7. The Lab 7 reminder is the biggest lever left and waits on your approval.", done: ["Posted Lab 8 in the community", "Aliza's two reels went out"], next: ["Send the Lab 7 reminder once you approve", "Start retargeting the lead form"], needs: ["Approve: email to 1,240 Lab 7 attendees"] },
    { ...base, kind: "stuck", status: "stuck", value: 212, target: 300, summary: "No new registrations in 3 check-ins. Luma has shown 212 since Mon. Every step left waits on the email approval.", needs: ["Approve the held send", "Drop the email step and move effort to retargeting"] },
    { ...base, kind: "ended", status: "missed", outcome: "missed", value: 268, target: 300, summary: "Got to 268 of 300 (89%) by Fri 7 Nov, 18:00. The reminder waited on approval from Mon to Thu; most of the gap is those three days." },
    { ...base, kind: "ended", status: "done", outcome: "done", value: 301, target: 300, summary: "Reached 301 on Thu 6 Nov, 15:40, a day early. Spent $14.80 of $25 and 118 of 200 turns." },
  ];
  // each card follows its own goal: the draft is still a draft, the stuck one still stuck
  const own = (b: GoalBlock) => async (cap: string, input: unknown): Promise<unknown> => (cap === "goals.get" ? { goal: { status: b.status, deadline: b.deadline, progress: { value: b.value, target: b.target, tasksDone: 0, tasks: 0 } } } : call(cap, input));
  return blocks.map((b) => ({ b, call: own(b) }));
  }, [call, now]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "var(--win)" as string }} contentContainerStyle={{ padding: 24, gap: 14, maxWidth: 640 }}>
      {/* ui-rows-lint: not a list (cards a chat carries, one per message) */}
      {cards.map(({ b, call: c }) => <GoalCard key={`${b.kind}-${b.status}`} block={b} call={c} changes={undefined} openGoal={() => undefined} me="usr_irfad" />)}
    </ScrollView>
  );
}

export default function Mount(): ReactNode {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => setSearch((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  if (search === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  return <Inner search={search} />;
}
