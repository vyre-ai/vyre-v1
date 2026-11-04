// "Needs you" at the top of a page: the open alerts that are dealt with on this page's tab, so a page opens with what is wrong before what is usual. Home shows all of them, so it has no strip.
import type { ReactElement } from "react";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { ATTENTION_PAGE, ATTENTION_SENTENCE } from "../pages/overview/Overview.tsx";
import { ago } from "./format.ts";
import { useConsoleData, useScreenQuery } from "./data.tsx";
import { Glyph } from "./glyphs.tsx";
import { Group, Lead, LinkButton, Section } from "./ui.tsx";
import { resolve, tabOf } from "./sections.ts";

type Out = CapMap["console.overview"]["out"];

/** The attention items whose page sits on the same tab as `page`. */
export function itemsHere(items: Out["attention"], page: string): Out["attention"] {
  const tab = tabOf(page);
  return items.filter((a) => { const to = resolve(ATTENTION_PAGE[a.kind]); return tab !== undefined && tab.views.some((x) => x.page === to); });
}

export function NeedsHere({ page }: { page: string }): ReactElement | null {
  const data = useConsoleData();
  const q = useScreenQuery<Out>("console.overview", "overview", {});
  if (page === "overview" || page === "machines" || q.status !== "ready") return null;
  const here = itemsHere(q.data.attention, page);
  if (here.length === 0) return null;
  const now = data.clock().now;
  return (
    <Section title="Needs you" count={here.length}>
      <Group testID="needs-here">
        {here.map((a, i) => (
          <Row key={`${a.kind}-${a.ref ?? i}`} id={`needs-${a.kind}-${a.ref ?? i}`} title={a.title} note={`${ATTENTION_SENTENCE[a.kind]} since ${ago(now, a.since)}`} leading={<Lead><Glyph name="warn" size={16} color="var(--warn)" /></Lead>}
            trailing={<LinkButton label={a.next} onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])} testID={`needs-go-${i}`} />} onPress={() => data.nav.openPage(ATTENTION_PAGE[a.kind])} />
        ))}
      </Group>
    </Section>
  );
}
