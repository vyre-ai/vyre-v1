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
import { TextAsk } from "../../chats/menus/TextAsk.tsx";
import { SIDEBAR, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { ListRowIn } from "../list/model.ts";
import { ListView } from "../screens/ListView.tsx";
import { useOpenConnect } from "../../../shell/connect/context.ts";
import { connectNeedOf } from "../clear/model.ts";
import type { Blocked } from "../clear/model.ts";
import { readinessKey, useReadiness } from "../clear/useReadiness.ts";
import { needsYou } from "./model.ts";
import type { AutoRow, JourneyRow } from "./model.ts";

export const listRowOf = (a: AutoRow, me: string, blocked?: Blocked): ListRowIn => ({
  id: a.id,
  name: a.name,
  state: needsYou(a) ? "needs" : a.status === "on" ? "on" : "off",
  scope: a.kind === "space" ? "Space" : a.ownerId !== me ? "Shared" : null,
  ...(a.sentence ? { sentence: a.sentence } : {}),
  ...(blocked ? { blocked: { short: blocked.short, button: blocked.button } } : {}),
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
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const api = useMemo(() => createMenuApiB(data), [data]);
  const fail = (e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work.");
  const once = (run: () => Promise<void>): void => void run().catch(fail);
  const list = useScreenQuery<{ automations: readonly AutoRow[] }>(SIDEBAR, "automations", {});
  // a Journey is a row in the same list (design 2.2), opened in its own record-by-stage view
  const journeys = useScreenQuery<{ journeys: readonly JourneyRow[] }>(SIDEBAR, "journeys", {});
  const groupsQ = useScreenQuery<{ groups: readonly { id: string; name: string }[] }>(SIDEBAR, "groups", {});
  const groups = groupsQ.status === "ready" ? groupsQ.data.groups : [];
  // what each one is missing, before anyone turns it on: its row says so and carries the one button
  const blocked = useReadiness(list.status === "ready" ? readinessKey(list.data.automations) : "");
  const openConnect = useOpenConnect();
  if (list.status !== "ready") return null;
  /** Connect opens the connect flow where the person is; a fix that lives on a step opens the Automation. */
  const fix = (id: string): void => {
    const b = blocked.get(id);
    const need = b ? connectNeedOf(b) : null;
    if (b && need && openConnect) {
      void openConnect(need).catch(() => null);
      return;
    }
    data.nav.openAutomation(id);
    onChoose();
  };
  const journeyIds = new Set(journeys.status === "ready" ? journeys.data.journeys.map((j) => j.id) : []);
  const journeyRows: ListRowIn[] =
    journeys.status === "ready"
      ? journeys.data.journeys.map((j) => ({ id: j.id, name: j.name, state: "off", scope: "Journey" }))
      : [];
  // the row's own menu, as the old list had it (chats/menus/kinds-b.ts): a Space Automation is changed only by those who may, and a member's menu is the shorter one
  const rowMenu = (id: string, x: number, y: number): void => {
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
          rename: () => setRenaming({ id: a.id, name: a.name }),
          duplicate: () => once(() => api.automationDuplicate(a.id)),
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
        rows={[...list.data.automations.map((a) => listRowOf(a, data.me.id, blocked.get(a.id))), ...journeyRows]}
        query={query}
        selectedId={selectedId}
        onMenu={rowMenu}
        onFix={fix}
        onHome={onChoose}
        onOpen={(id) => {
          if (journeyIds.has(id)) data.nav.openJourney(id);
          else data.nav.openAutomation(id);
          onChoose();
        }}
      />
      {element}
      {renaming ? (
        <TextAsk
          title="Rename this Automation"
          label="Name"
          action="Rename"
          initial={renaming.name}
          onDone={(name) => {
            const id = renaming.id;
            setRenaming(null);
            once(() => api.automationRename(id, name));
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </>
  );
}
