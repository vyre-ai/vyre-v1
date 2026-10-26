// ui/Plan timeline view: stage rows and task rows on the left, a day grid on the right with a bar per task, a diamond per milestone, a line for today and arrows for what waits on what.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { menuTrigger } from "../Menu/index.tsx";
import {
  HEAD_H, LABEL_W, MON, MONL, ROW_H, dayOfMonth, fmtDay, fmtWeekday, geomOf, isLate, isWeekend, layoutOf, monthOf, weekday,
} from "./logic.ts";
import type { Item } from "./logic.ts";
import { BAR, FaceButton, ICON, NameField, StatusMark, h, icon } from "./parts.tsx";
import type { EventLike, PlanCtx } from "./parts.tsx";

/** The routed path of a dependency arrow: right, down or up, right, with rounded corners. */
export function roundedPath(pts: readonly (readonly [number, number])[], r: number): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] as readonly [number, number], [x1, y1] = pts[i] as readonly [number, number], [x2, y2] = pts[i + 1] as readonly [number, number];
    const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1), k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) { d += `L${x1} ${y1}`; continue; }
    d += `L${x1 - ((x1 - x0) / l1) * k} ${y1 - ((y1 - y0) / l1) * k}Q${x1} ${y1} ${x1 + ((x2 - x1) / l2) * k} ${y1 + ((y2 - y1) / l2) * k}`;
  }
  const last = pts[pts.length - 1] as readonly [number, number];
  return `${d}L${last[0]} ${last[1]}`;
}

const HANDLE_L: CSSProperties = { position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" };
const HANDLE_R: CSSProperties = { position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" };

export function timelineView(c: PlanCtx, height: number): ReactElement {
  const g = geomOf(c.items, c.today, c.width);
  const lay = layoutOf(c.stages, c.items, c.collapsed, c.filter, c.today);
  const { d0, d1, dw, cw } = g;
  const total = LABEL_W + cw + 24;
  const tx = LABEL_W + (c.today - d0 + 0.5) * dw;
  const pending = c.slips.filter((s) => s.status === "pending");
  const pos: Record<string, { x1: number; x2: number; yc: number }> = {};
  const labels: ReactNode[] = [];
  const bars: ReactNode[] = [];
  const menuProps = (it: Item): Record<string, unknown> => menuTrigger((x: number, y: number) => c.menu(it.id, x, y));
  for (const r of lay.rows) {
    if (r.stage) {
      const st = r.stage;
      const col = c.collapsed[st.id] === true;
      const tn = st.all.filter((x) => !x.milestone).length, dn = st.all.filter((x) => !x.milestone && x.status === "done").length;
      labels.push(h("div", { key: `sl-${st.id}`, style: { position: "absolute", top: r.y, height: r.h, left: 0, width: LABEL_W, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", boxSizing: "border-box" } },
        h("button", { type: "button", "aria-expanded": !col, "data-testid": `plan-stage-${st.id}`, onClick: () => c.toggleStage(st.id), style: { border: 0, background: "none", font: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, fontSize: 12.5, color: "var(--ink)", padding: 0 } },
          h("span", { style: { display: "inline-flex", transform: col ? "rotate(-90deg)" : "none" }, dangerouslySetInnerHTML: { __html: ICON.chev } }), st.name),
        h("span", { style: { marginLeft: "auto", fontSize: 11.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, `${dn}/${tn}`),
        c.canAdd ? h("button", { type: "button", "aria-label": `Add a task to ${st.name}`, title: "Add a task", "data-testid": `plan-add-${st.id}`, onClick: () => c.add(st.id), style: { border: 0, background: "none", cursor: "pointer", color: "var(--ink-3)", padding: 2, display: "inline-flex" }, dangerouslySetInnerHTML: { __html: ICON.plus } }) : null));
      // color-mix-ok: h("div") style, a real DOM node of the Plan view
      bars.push(h("div", { key: `sb-${st.id}`, style: { position: "absolute", top: r.y, height: r.h, left: 0, right: 0, background: "color-mix(in srgb, var(--sunk) 55%, transparent)" } }));
      if (st.all.length > 0) {
        const s = Math.min(...st.all.map((x) => x.s)), e = Math.max(...st.all.map((x) => x.e));
        bars.push(h("div", { key: `sp-${st.id}`, style: { position: "absolute", top: r.y + 13, left: LABEL_W + (s - d0) * dw + 1, width: (e - s + 1) * dw - 2, height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden" } },
          h("i", { style: { display: "block", height: "100%", width: `${tn ? Math.round((100 * dn) / tn) : 0}%`, background: "var(--ok)" } })));
      }
      continue;
    }
    const it = r.item as Item;
    const on = c.sel.has(it.id);
    const x = (it.s - d0) * dw, w = (it.e - it.s + 1) * dw;
    const late = isLate(it, c.today);
    const target = c.band?.target === it.id;
    labels.push(h("div", {
      key: `il-${it.id}`, role: "row", "aria-selected": on, "data-testid": `plan-row-${it.id}`, title: it.title,
      onClick: (e: EventLike) => c.select(it.id, e.metaKey || e.ctrlKey, e.shiftKey), onDoubleClick: () => c.open(it.id), ...menuProps(it),
      style: { position: "absolute", top: r.y, height: r.h, left: 0, width: LABEL_W, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 22px", boxSizing: "border-box", cursor: "default", background: on ? "var(--hover)" : "transparent" },
    }, it.milestone ? icon(ICON.diamond) : h(StatusMark, { status: it.status }), h(NameField, { it, ctx: c, style: { fontSize: 13 } })));
    if (it.milestone) {
      const cx = LABEL_W + (it.s - d0 + 0.5) * dw;
      pos[it.id] = { x1: cx - 8, x2: cx + 8, yc: r.y + ROW_H / 2 };
      bars.push(h("div", {
        key: `ms-${it.id}`, role: "button", "aria-pressed": on, tabIndex: -1, "data-testid": `plan-bar-${it.id}`, title: `${it.title} · ${fmtDay(it.s)}${it.fixed ? " · pinned" : ""}`,
        onPointerDown: (e: EventLike) => c.down(e, it.id, "mv"), onDoubleClick: () => c.open(it.id), ...menuProps(it),
        style: { position: "absolute", left: cx - 9, top: r.y + 9, width: 18, height: 18, cursor: it.fixed ? "default" : "grab", color: it.status === "done" ? "var(--ok)" : on || target ? "var(--accent)" : "var(--ink-2)" },
      }, h("span", { style: { display: "block", transform: "rotate(45deg) scale(.82)", width: 18, height: 18, border: "2px solid currentColor", borderRadius: 3, boxSizing: "border-box", background: it.status === "done" ? "currentColor" : "var(--win)" } }),
      on ? h("i", { "data-link": it.id, onPointerDown: (e: EventLike) => { e.stopPropagation(); c.down(e, it.id, "link"); }, style: LINK_DOT } ) : null));
      bars.push(h("span", { key: `msl-${it.id}`, style: { position: "absolute", left: cx + 15, top: r.y + 9, fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap", display: "inline-flex", gap: 6, alignItems: "center" } }, it.title, h("em", { style: { fontStyle: "normal", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" } }, `${fmtWeekday(it.s)} ${fmtDay(it.s)}`), it.fixed ? icon(ICON.pin) : null));
      continue;
    }
    const paint = BAR[it.status];
    pos[it.id] = { x1: LABEL_W + x + 1, x2: LABEL_W + x + w - 1, yc: r.y + ROW_H / 2 };
    bars.push(h("div", {
      key: `bar-${it.id}`, role: "button", "aria-pressed": on, "aria-label": `${it.title}, ${it.s === it.e ? fmtDay(it.s) : `${fmtDay(it.s)} to ${fmtDay(it.e)}`}${it.who ? `, ${it.who.name}` : ""}`, tabIndex: -1, "data-testid": `plan-bar-${it.id}`, "data-status": it.status, "data-id": it.id,
      title: `${it.title} · ${it.who ? `${it.who.name} · ` : ""}${it.s === it.e ? fmtDay(it.s) : `${fmtDay(it.s)} to ${fmtDay(it.e)}`}`,
      onPointerDown: (e: EventLike) => { const t = e.target; c.down(e, it.id, t.closest("[data-h=s]") ? "rs" : t.closest("[data-h=e]") ? "re" : "mv"); },
      onDoubleClick: () => c.open(it.id), ...menuProps(it),
      // color-mix-ok: h("div") style, a real DOM node of the Plan view
      style: { position: "absolute", left: LABEL_W + x + 1, top: r.y + 7, width: w - 2, height: 22, boxSizing: "border-box", borderRadius: 7, background: paint.bg, border: `1px solid ${late ? "var(--danger)" : on || target ? "var(--accent)" : paint.line}`, boxShadow: target ? "0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent)" : on ? "0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)" : c.moving.has(it.id) ? "0 4px 10px rgba(0,0,0,.18)" : "none", display: "flex", alignItems: "center", gap: 4, padding: "0 4px", cursor: "grab", touchAction: "none" },
    },
    h("i", { "data-h": "s", style: HANDLE_L }),
    h(FaceButton, { it, size: 16, ctx: c }),
    w >= 120 ? h("span", { style: { fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, it.title) : null,
    h("i", { "data-h": "e", style: HANDLE_R }),
    on ? h("i", { "data-link": it.id, title: "Drag to another task to make it follow this one", onPointerDown: (e: EventLike) => { e.stopPropagation(); c.down(e, it.id, "link"); }, style: LINK_DOT }) : null));
    if (w < 120) bars.push(h("span", { key: `bt-${it.id}`, style: { position: "absolute", left: LABEL_W + x + w + 18, top: r.y + 9, fontSize: 12.5, color: it.status === "done" ? "var(--ink-3)" : "var(--ink-2)", whiteSpace: "nowrap" } }, it.title));
  }
  const grid: ReactNode[] = [];
  const heads: ReactNode[] = [];
  const months: ReactNode[] = [];
  const segs: { d: number; m: number }[] = [];
  for (let d = d0; d <= d1; d++) {
    const x = (d - d0) * dw;
    // color-mix-ok: h("div") style, a real DOM node of the Plan view
    if (isWeekend(d)) grid.push(h("i", { key: `we-${d}`, style: { position: "absolute", left: LABEL_W + x, width: dw, top: 0, bottom: 0, background: "color-mix(in srgb, var(--sunk) 60%, transparent)" } }));
    if (dayOfMonth(d) === 1) grid.push(h("i", { key: `vl-${d}`, style: { position: "absolute", left: LABEL_W + x, top: 0, bottom: 0, width: 1, background: "var(--line)" } }));
    if (d === d0 || dayOfMonth(d) === 1) segs.push({ d, m: monthOf(d) });
    heads.push(h("span", { key: `dc-${d}`, style: { position: "absolute", top: 22, left: LABEL_W + x, width: dw, height: 24, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10.5, color: d === c.today ? "var(--accent)" : isWeekend(d) ? "var(--ink-4)" : "var(--ink-3)", fontWeight: d === c.today ? 700 : 500, lineHeight: 1.15 } }, h("em", { style: { fontStyle: "normal" } }, "SMTWTFS"[weekday(d)] ?? ""), h("b", { style: { fontWeight: "inherit", fontVariantNumeric: "tabular-nums" } }, dayOfMonth(d))));
  }
  segs.forEach((sg, i) => {
    const e = i + 1 < segs.length ? (segs[i + 1] as { d: number }).d : d1 + 1;
    months.push(h("div", { key: `ms-${sg.d}`, style: { position: "absolute", top: 0, left: LABEL_W + (sg.d - d0) * dw, width: (e - sg.d) * dw, height: 22, display: "flex", alignItems: "center", paddingLeft: 6, fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", overflow: "hidden", whiteSpace: "nowrap" } }, (e - sg.d) * dw < 90 ? MON[sg.m] : MONL[sg.m]));
  });
  const arrows: ReactNode[] = [];
  for (const y2 of c.items) {
    for (const dId of y2.deps) {
      const a = pos[dId], b = pos[y2.id];
      if (!a || !b) continue;
      const da = c.items.find((q) => q.id === dId) as Item;
      const conflict = y2.s < da.e + (da.milestone || y2.milestone ? 0 : 1) && y2.status !== "done";
      const x1 = a.x2, y1 = a.yc, x2 = b.x1, yb = b.yc;
      const pts: [number, number][] = x2 >= x1 + 16 ? [[x1, y1], [x1 + 9, y1], [x1 + 9, yb], [x2 - 1, yb]] : (() => { const ym = yb > y1 ? yb - ROW_H / 2 : yb + ROW_H / 2; return [[x1, y1], [x1 + 9, y1], [x1 + 9, ym], [x2 - 11, ym], [x2 - 11, yb], [x2 - 1, yb]]; })();
      const hi = c.sel.has(dId) || c.sel.has(y2.id);
      const stroke = conflict ? "var(--danger)" : hi ? "var(--accent)" : "var(--ink-4)";
      const d = roundedPath(pts, 5);
      arrows.push(h("g", { key: `dep-${dId}-${y2.id}`, "data-dep": `${dId}>${y2.id}` },
        h("path", { d, fill: "none", stroke, strokeWidth: hi || conflict ? 1.8 : 1.3, pointerEvents: "none" }),
        h("path", { d: `M${x2} ${yb}l-5.5 -3.2v6.4z`, fill: stroke, pointerEvents: "none" }),
        h("path", { d, fill: "none", stroke: "transparent", strokeWidth: 10, style: { pointerEvents: "stroke", cursor: "context-menu" }, ...menuTrigger((mx: number, my: number) => c.linkMenu(dId, y2.id, mx, my)) })));
    }
  }
  const ghosts: ReactNode[] = [];
  for (const s of pending) for (const m of s.moves) { const y = lay.ypos[m.id]; if (y !== undefined) ghosts.push(h("div", { key: `gh-${s.id}-${m.id}`, style: { position: "absolute", left: LABEL_W + (m.s - d0) * dw + 1, top: y + 7, width: (m.e - m.s + 1) * dw - 2, height: 22, borderRadius: 7, border: "1.5px dashed var(--ink-4)", boxSizing: "border-box", pointerEvents: "none" } })); }
  const band = c.band ? h("path", { d: `M${c.band.x1} ${c.band.y1}C${c.band.x1 + 40} ${c.band.y1} ${c.band.x2 - 40} ${c.band.y2} ${c.band.x2} ${c.band.y2}`, fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "5 4", pointerEvents: "none" }) : null;
  const tip = (() => {
    const first = [...c.moving][0];
    if (first === undefined) return null;
    const f = c.items.find((q) => q.id === first);
    const y = lay.ypos[first];
    if (!f || y === undefined) return null;
    return h("div", { style: { position: "absolute", left: LABEL_W + (f.s - d0) * dw, top: y - 4, padding: "2px 6px", borderRadius: 5, background: "var(--ink)", color: "var(--win)", fontSize: 11, whiteSpace: "nowrap", pointerEvents: "none", fontVariantNumeric: "tabular-nums" } }, f.s === f.e ? fmtDay(f.s) : `${fmtDay(f.s)} to ${fmtDay(f.e)}`);
  })();

  return h("div", { ref: c.setScroller, "data-testid": "plan-scroll", style: { position: "relative", overflow: "auto", height, border: "1px solid var(--line)", borderRadius: 10, background: "var(--win)" } },
    h("div", { style: { position: "relative", width: total, height: lay.height + HEAD_H + 2 } },
      h("div", { style: { position: "sticky", top: 0, zIndex: 5, height: HEAD_H, width: total, background: "var(--win)", borderBottom: "1px solid var(--line)" } },
        ...months, ...heads,
        h("span", { style: { position: "absolute", left: tx - 18, top: 4, width: 36, textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "var(--accent-ink)", background: "var(--accent)", borderRadius: 5, lineHeight: "15px", zIndex: 2 } }, "Today")),
      h("div", { ref: c.setBody, style: { position: "absolute", top: HEAD_H, left: 0, width: total, height: lay.height } },
        ...grid, ...bars,
        h("i", { style: { position: "absolute", left: tx, top: 0, bottom: 0, width: 2, marginLeft: -1, background: "var(--accent)", opacity: 0.7, pointerEvents: "none" } }),
        ...ghosts,
        h("svg", { width: total, height: lay.height, style: { position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" } }, ...arrows, band),
        tip),
      h("div", { style: { position: "sticky", left: 0, top: 0, width: LABEL_W, height: 0, zIndex: 6 } },
        h("div", { style: { position: "absolute", left: 0, top: 0, width: LABEL_W, height: lay.height, background: "var(--win)", borderRight: "1px solid var(--line)" } }, ...labels))));
}

const LINK_DOT: CSSProperties = { position: "absolute", right: -5, top: "50%", marginTop: -5, width: 10, height: 10, borderRadius: 99, background: "var(--win)", border: "2px solid var(--accent)", boxSizing: "border-box", cursor: "crosshair", zIndex: 2 };
