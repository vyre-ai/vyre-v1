// Records views, part A: the one component the Records place draws a type with. It reads the type and its saved views, starts on the kind the saved view has (or the table), and draws the table,
// the board, the gallery or the list; the kinds part B adds (calendar, timeline, map, charts) arrive through `extraKinds` and appear in the same switch. Changing the kind keeps the filter and the
// find text; a saved view of another kind opens as that kind.
import { Fragment, useState } from "react";
import { useWindowDimensions } from "react-native";
import type { ReactElement } from "react";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useLive, useOptionalRecordsData, useScreenQuery } from "../sidebar/data.tsx";
import { SCREENS, effectiveType, typeGroups } from "../sidebar/model.ts";
import { useRecordsState } from "../sidebar/state.tsx";
import { TableLoading, TableView } from "../table/index.ts";
import { fromSaved } from "../table/model.ts";
import { BoardView } from "./BoardView.tsx";
import { GalleryView } from "./GalleryView.tsx";
import { ListView } from "./ListView.tsx";
import { each, KIND_LABEL, KIND_ORDER, kindOf } from "./model.ts";
import type { TableViewState } from "./model.ts";
import type { KindDef, ViewCtx } from "./view.tsx";
import { KindSwitch } from "./view.tsx";

type TypesOut = CapMap["schema.types.list"]["out"];
type ViewsOut = CapMap["views.list"]["out"];

/** A kind a later part draws: how it is named in the switch and how it is drawn from the context. */
export interface ExtraKind { kind: string; label: string; render: (ctx: ViewCtx) => ReactElement }

export interface RecordViewsProps {
  /** The shell may force a type (a deep link); otherwise the sidebar's open type shows. */
  type?: string;
  /** The kind to open on when no saved view says otherwise. */
  kind?: string;
  /** A starting view on top of the saved one. */
  view?: Partial<TableViewState>;
  extraKinds?: readonly ExtraKind[];
}

function TypeViews({ type, kind, view, extraKinds }: RecordViewsProps & { type: string }): ReactElement {
  const { state } = useRecordsState();
  const describe = useLive("schema.describe", { type });
  const views = useScreenQuery<ViewsOut>(SCREENS.views, "views", { type });
  const list = views.status === "ready" ? views.data.views : [];
  const saved = state.viewId ? list.find((x) => x.viewId === state.viewId) : undefined;
  const def = describe.status === "ready" ? describe.data.types.find((t) => t.key === type) : undefined;
  const kinds: KindDef[] = [...each(KIND_ORDER, (k) => ({ kind: k, label: KIND_LABEL[k] })), ...each(extraKinds ?? [], (k) => ({ kind: k.kind, label: k.label }))];
  const known = each(kinds, (k) => k.kind);
  const winW = useWindowDimensions().width;
  const phone = winW > 0 && winW < 700;
  const [picked, setPicked] = useState<{ key: string; kind: string } | null>(null);
  const key = `${type}:${saved?.viewId ?? ""}`;
  if (!def) return <TableLoading />;
  const savedKind = saved ? kindOf(saved, known) : null;
  const active = picked && picked.key === key ? picked.kind : savedKind ?? (kind && known.includes(kind) ? kind : "table");
  const base: TableViewState = { ...fromSaved(saved), ...view };
  const ctx: ViewCtx = { type, def, views: list, saved, base, kind: active, kinds, onKind: (k) => setPicked({ key, kind: k }) };
  // On the phone the table is its list: a face or icon, the title and one line, in the shared Row (no columns to scroll sideways).
  if (active === "table" && phone) return <ListView key={key} ctx={ctx} />;
  if (active === "table") return <TableView key={key} type={type} {...(view ? { view } : {})} headerExtra={<KindSwitch ctx={ctx} />} />;
  const extra = (extraKinds ?? []).find((k) => k.kind === active);
  if (extra) return <Fragment key={`${key}:${active}`}>{extra.render(ctx)}</Fragment>;
  return active === "board" ? <BoardView key={key} ctx={ctx} /> : active === "gallery" ? <GalleryView key={key} ctx={ctx} /> : <ListView key={key} ctx={ctx} />;
}

function Open(props: RecordViewsProps): ReactElement {
  const { state } = useRecordsState();
  const types = useScreenQuery<TypesOut>(SCREENS.types, "types");
  if (types.status !== "ready") return <TableLoading />;
  const open = props.type ?? effectiveType(state, typeGroups(types.data.types));
  if (!open) return <States kind="empty" title="No record types yet." icon="records" />;
  return <TypeViews {...props} type={open} />;
}

export function RecordViews(props: RecordViewsProps): ReactElement {
  const data = useOptionalRecordsData();
  if (!data) return <TableLoading />;
  return <Open {...props} />;
}
