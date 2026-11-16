// The left side as ONE list (design 2.6): his Automations, what needs him first, a dot for the state and a quiet scope word. A row opens that Automation. No Failed runs, Templates, Watching, Analytics, Dependencies, Event Explorer or Packages rows.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Text } from "react-native";
import { automationMenu } from "../../chats/menus/kinds-b.ts";
import { copyToClipboard, createMenuApiB, vyreLink } from "../../chats/menus/actions-b.ts";
import { tidy } from "../../../../../../ui/src/Menu/entries.ts";
import { openEntries } from "../../../../../../ui/src/Menu/open-entries.ts";
import { openIn } from "../../../shell/tabs/open-how.ts";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { ListRowIn } from "../list/model.ts";
import { ListView } from "../screens/ListView.tsx";
import { needsYou } from "./model.ts";
import type { AutoRow, JourneyRow } from "./model.ts";

export const listRowOf = (a: AutoRow, me: string): ListRowIn => ({
  id: a.id,
  name: a.name,
  state: needsYou(a) ? "needs" : a.status === "on" ? "on" : "off",
  scope: a.kind === "space" ? "Space" : a.ownerId !== me ? "Shared" : null,
});

export function AutomationsList({
  selectedId,
  query,
  onChoose,
}: {
  selectedId: string | null;
  query: string;
  onChoose(): void;
}): ReactElement | null {
  const data = useAutomationsData();
  const { element, show } = useMenu();
  const [note, setNote] = useState<string | null>(null);
  const api = useMemo(() => createMenuApiB(data), [data]);
  const fail = (e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work.");
  const list = useScreenQuery<{ automations: readonly AutoRow[] }>(SIDEBAR, "automations", {});
  // a Journey is a row in the same list (design 2.2), opened in its own record-by-stage view
  const journeys = useScreenQuery<{ journeys: readonly JourneyRow[] }>(SIDEBAR, "journeys", {});
  const groupsQ = useScreenQuery<{ groups: readonly { id: string; name: string }[] }>(SIDEBAR, "groups", {});
  const groups = groupsQ.status === "ready" ? groupsQ.data.groups : [];
  if (list.status !== "ready") return null;
  const journeyIds = new Set(journeys.status === "ready" ? journeys.data.journeys.map((j) => j.id) : []);
  const journeyRows: ListRowIn[] =
    journeys.status === "ready"
      ? journeys.data.journeys.map((j) => ({ id: j.id, name: j.name, state: "off", scope: "Journey" }))
      : [];
  // the row's own menu, as the old list had it (chats/menus/kinds-b.ts): a Space Automation is changed only by those who may, and a member's menu is the shorter one
  const rowMenu = (id: string, x: number, y: number): void => {
    const once = (run: () => Promise<void>): void => void run().catch(fail);
    const jr = journeys.status === "ready" ? journeys.data.journeys.find((j) => j.id === id) : undefined;
    if (jr) {
      show(
        tidy([
          ...openEntries({
            open: () => {
              data.nav.openJourney(id);
              onChoose();
            },
          }),
          { separator: true },
          { label: "Copy Link", onSelect: () => copyToClipboard(vyreLink("journey", id)) },
          { separator: true },
          {
            label: "Move to Trash…",
            danger: true,
            onSelect: () =>
              show(
                [
                  { head: "Move this Journey to Trash?" },
                  {
                    label: "Move to Trash",
                    danger: true,
                    onSelect: () => once(() => data.call("journeys.delete", { journeyId: id }).then(() => undefined)),
                  },
                  { label: "Cancel" },
                ],
                x,
                y,
                "other",
              ),
          },
        ]),
        x,
        y,
        "context",
        { label: jr.name },
      );
      return;
    }
    const a = list.data.automations.find((r) => r.id === id);
    if (!a) return;
    const canEdit = !(a.kind === "space" && data.canSpace === false);
    show(
      automationMenu(
        {
          name: a.name,
          enabled: a.status === "on",
          space: a.kind === "space",
          canEdit,
          canRun: canEdit && a.status !== "draft",
          canDelete: canEdit,
          failedRuns: a.failedRuns,
          group: groups.find((g) => g.id === a.groupId)?.name ?? null,
          groups: groups.filter((g) => g.id !== a.groupId).map((g) => ({ id: g.id, name: g.name })),
        },
        {
          open: () => {
            data.nav.openAutomation(a.id);
            onChoose();
          },
          openTab: () => openIn("tab", () => data.nav.openAutomation(a.id)),
          run: () => once(() => api.automationRun(a.id)),
          setEnabled: (on) => once(() => api.automationSetEnabled(a.id, on)),
          test: () => once(() => api.automationTest(a.id)),
          makePersonalCopy: () => once(() => api.automationPersonalCopy(a.id)),
          move: (groupId) => once(() => api.automationMove(a.id, groupId)),
          runs: () => (a.failedRuns > 0 ? data.nav.openFailedRuns() : (data.nav.openAutomation(a.id), onChoose())),
          copyLink: () => copyToClipboard(vyreLink("automation", a.id)),
          remove: () =>
            show(
              [
                { head: "Move this Automation to Trash?" },
                { label: "Move to Trash", danger: true, onSelect: () => once(() => api.automationTrash(a.id)) },
                { label: "Cancel" },
              ],
              x,
              y,
              "other",
            ),
        },
      ),
      x,
      y,
      "context",
      { label: a.name },
    );
  };
  return (
    <>
      {note ? <Text testID="al-note">{note}</Text> : null}
      <ListView
        rows={[...list.data.automations.map((a) => listRowOf(a, data.me.id)), ...journeyRows]}
        query={query}
        selectedId={selectedId}
        onMenu={rowMenu}
        onHome={onChoose}
        onOpen={(id) => {
          if (journeyIds.has(id)) data.nav.openJourney(id);
          else data.nav.openAutomation(id);
          onChoose();
        }}
      />
      {element}
    </>
  );
}
