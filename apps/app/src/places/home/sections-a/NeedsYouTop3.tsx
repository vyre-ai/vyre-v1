// Home > Needs you: the top 3 of what waits on me, each with one action. Approve acts in place and the next one moves up; Review, Answer and Unblock open the item
// in Needs you, where the thing to look at is. "All N in Needs you" opens the full list. Data: tasks.needs_you (screen home.needs-you-top3), live from the kept copy.
import { useEffect } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useActions } from "./actions.ts";
import { useHomeData, usePrincipals, useScreenQuery, useSelection } from "./data.tsx";
import { needsRow, rowKeysBy, topNeeds } from "./model.ts";
import type { NeedsItem, NeedsRow } from "./model.ts";
import { EmptyLine, Face, HRow, LinkButton, PrimaryButton, RowText, Section, SectionHeader, Skeleton, tone } from "./parts.tsx";

export const NEEDS_SCREEN = "home.needs-you-top3";
type Out = CapMap["tasks.needs_you"]["out"];

/** What a person can do from a row's menu: its own actions, then open. Every entry changes real state or opens the item. */
export function needsMenu(item: NeedsItem, row: NeedsRow, run: (key: string) => void, open: () => void): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const a of item.task.actions) entries.push({ label: a.label, onSelect: () => run(a.key) });
  if (entries.length) entries.push({ separator: true });
  entries.push({ label: "Open in Needs you", onSelect: open });
  return entries;
}

export function NeedsYouTop3(): ReactElement {
  const data = useHomeData();
  const { name, kindOf } = usePrincipals();
  const sel = useSelection();
  const actions = useActions();
  const q = useScreenQuery<Out>(NEEDS_SCREEN, "items", { limit: 3 });
  const menu = useMenu();
  const items = q.status === "ready" ? topNeeds(q.data.items) : [];
  const total = q.status === "ready" ? q.data.total : 0;
  const keyList = rowKeysBy("need", items, (i) => i.task.id).join("|");
  useEffect(() => { sel.register(0, keyList ? keyList.split("|") : []); }, [keyList]);

  const act = (item: NeedsItem, actionKey: string, label: string): void => void actions.act(item, actionKey, label);

  const rows: ReactElement[] = [];
  for (const item of items) {
    const row = needsRow(item, name);
    const open = (): void => data.nav.openNeedsYou(item.task.id);
    const onPrimary = (): void => (row.inline ? act(item, row.actionKey, row.actionLabel) : open());
    rows.push(
      <HRow
        key={row.id} rowKey={`need:${row.id}`} label={`${row.title}, ${row.kind}`} onOpen={open}
        onMenu={(x, y) => menu.show(needsMenu(item, row, (k) => act(item, k, item.task.actions.find((a) => a.key === k)?.label ?? k), open), x, y, "context", { label: row.title })}
      >
        <Face name={name(row.requester)} seedId={row.requester} kind={kindOf({ kind: "agent", id: row.requester })} size={26} />
        <RowText
          title={row.title}
          sub={<><Text style={tone[row.tone]}>{row.kind}</Text>{row.sub ? ` · ${row.sub}` : ""}</>}
        />
        <PrimaryButton label={row.actionLabel} tone={row.tone} onPress={onPrimary} testID={`need-action-${row.id}`} />
      </HRow>,
    );
  }

  return (
    <Section id="s-needs" first>
      <SectionHeader id="needs" title="Needs you" count={q.status === "ready" && total > 0 ? total : undefined}>
        {total > 0 ? <LinkButton label={`All ${total} in Needs you`} onPress={() => data.nav.openNeedsYou()} testID="needs-all" /> : null}
      </SectionHeader>
      {q.status === "loading" ? <Skeleton rows={3} id="needs" /> : rows.length ? <View accessibilityRole="list">{rows}</View> : <EmptyLine id="needs" text="Nothing needs you" />}
      {menu.element}
    </Section>
  );
}
