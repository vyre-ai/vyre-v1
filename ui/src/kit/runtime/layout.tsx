// Renders a declarative LayoutNode tree (ARCH 3.5). Pointers read the screen scope: /queries/<name>, /state/<key>, /row.
// A list is a ui/VirtualList of ui/Row: one whole-width row with hover, selection and a second line. The first text or
// field of a row layout is the title, the rest the note, and pressing the row runs the first button's action. Right-click,
// the menu key and Shift+F10 open the screen's menu for the row (through the host's ui/Menu trigger); Up and Down move
// between rows; Enter and Space press.
import { useRef, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { LayoutNode } from "../types.ts";
import { Row, ROW_HEIGHT, ROW_HEIGHT_WITH_NOTE } from "../../Row/index.tsx";
import { VirtualList } from "../../VirtualList/index.tsx";
import type { BuiltinRegistry, KitScreenContext } from "./builtins.ts";
import { each } from "./each.ts";
import { presentRow, type RowPresentation } from "./present.ts";
import { evalExpr, interpolate, resolvePointer, type Scope } from "./pointer.ts";

export { firstAction } from "./present.ts";

export interface LayoutRuntime {
  screen: KitScreenContext;
  builtins: BuiltinRegistry;
}

const BODY: TextStyle = { color: "var(--ink)", fontSize: 14 };
const TEXT_STYLES: Readonly<Record<string, TextStyle>> = {
  title: { color: "var(--ink)", fontSize: 20, fontWeight: "600" },
  heading: { color: "var(--ink)", fontSize: 15, fontWeight: "600" },
  body: BODY,
  muted: { color: "var(--ink-3)", fontSize: 13 },
  caption: { color: "var(--ink-4)", fontSize: 12 },
};

/** The slice of the DOM that row keyboard navigation touches (web only; native hosts never send these events). */
interface DomEl {
  closest(selector: string): DomEl | null;
  parentElement: DomEl | null;
  previousElementSibling: DomEl | null;
  nextElementSibling: DomEl | null;
  querySelector(selector: string): DomEl | null;
  getAttribute(name: string): string | null;
  focus(): void;
}

const ROW_SELECTOR = "[data-testid^='row-']";

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const items = (value as Record<string, unknown>).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/** Index of the row under an event target, from the Row's test id (`row-<index>`), or -1. */
export function rowIndexOf(target: unknown): number {
  const id = (target as DomEl | null)?.closest?.(ROW_SELECTOR)?.getAttribute("data-testid") ?? "";
  const n = /^row-(\d+)$/.exec(id)?.[1];
  return n === undefined ? -1 : Number(n);
}

function moveFocus(e: { key: string; target: unknown; preventDefault(): void }): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const row = (e.target as DomEl | null)?.closest?.(ROW_SELECTOR);
  const cell = row?.parentElement;
  const next = (e.key === "ArrowDown" ? cell?.nextElementSibling : cell?.previousElementSibling)?.querySelector(ROW_SELECTOR);
  if (next) { e.preventDefault(); next.focus(); }
}

type Handler = (e: never) => void;

/** Calls the host's handler for an event and then ours. */
function chain(host: Record<string, unknown>, name: string, ours: (e: never) => void): Handler {
  const theirs = host[name] as Handler | undefined;
  return (e) => { ours(e); theirs?.(e); };
}

type ListNode = Extract<LayoutNode, { t: "list" | "table" | "board" }>;

function ListView({ node, scope, rt }: { node: ListNode; scope: Scope; rt: LayoutRuntime }) {
  const [selected, setSelected] = useState(-1);
  const target = useRef(-1);
  const rows = rowsOf(resolvePointer(scope, node.bind));
  const { screen } = rt;
  const rowScope = (item: unknown, index: number): Scope => ({ ...scope, row: item, index });
  const shown: RowPresentation[] = [];
  for (let i = 0; i < rows.length; i++) shown.push(presentRow(node.row, rowScope(rows[i], i)));
  if (rows.length === 0) {
    return node.empty ? <Text style={[styles.muted, styles.pad]} testID="kit-list-empty">{node.empty}</Text> : null;
  }
  const press = (i: number) => {
    const action = shown[i]?.action;
    if (action) screen.run(action, rows[i]);
    else setSelected((cur) => (cur === i ? -1 : i));
  };
  const menus = screen.def.menus?.find((m) => m.target === node.bind);
  const open = (x: number, y: number) => {
    const i = target.current;
    if (!menus || i < 0 || i >= rows.length || !screen.env.openMenu) return;
    const items = menus.items.filter((item) => evalExpr(item.when, rowScope(rows[i], i)));
    screen.env.openMenu({ target: node.bind, items, point: { x, y }, run: (a) => screen.run(a, rows[i]) });
  };
  const host = menus && screen.env.menuTrigger ? screen.env.menuTrigger(open) : {};
  const record = (e: { target: unknown }) => { target.current = rowIndexOf(e.target); };
  const web = {
    ...host,
    onMouseDown: chain(host, "onMouseDown", record as (e: never) => void),
    onKeyDown: chain(host, "onKeyDown", ((e: { key: string; target: unknown; preventDefault(): void }) => { record(e); moveFocus(e); }) as (e: never) => void),
  } as object;
  const height = shown.some((r) => r.note) ? ROW_HEIGHT_WITH_NOTE : ROW_HEIGHT;
  if (node.t === "board") {
    return (
      <View style={styles.board} testID="kit-board" {...web}>
        {each(shown, (r, i) => (
          <View key={i} style={styles.boardItem}>
            <Row id={String(i)} title={r.title} {...(r.note ? { note: r.note } : {})} selected={selected === i} onPress={() => press(i)} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.list} accessibilityRole="list" testID="kit-list" {...web}>
      <VirtualList
        data={shown}
        rowHeight={height}
        keyOf={(_r, i) => String(i)}
        renderItem={(r, i) => <Row id={String(i)} title={r.title} {...(r.note ? { note: r.note } : {})} selected={selected === i} onPress={() => press(i)} />}
      />
    </View>
  );
}

export function Layout({ node, scope, rt }: { node: LayoutNode; scope: Scope; rt: LayoutRuntime }): ReactElement | null {
  switch (node.t) {
    case "stack":
      return <View style={{ gap: node.gap ?? 0, flexShrink: 1, flex: 1 }}>{each(node.children, (c, i) => <Layout key={i} node={c} scope={scope} rt={rt} />)}</View>;
    case "row":
      return <View style={{ flexDirection: "row", alignItems: "center", gap: node.gap ?? 8 }}>{each(node.children, (c, i) => <Layout key={i} node={c} scope={scope} rt={rt} />)}</View>;
    case "list": case "table": case "board":
      return <ListView node={node} scope={scope} rt={rt} />;
    case "text":
      return <Text style={TEXT_STYLES[node.style ?? "body"] ?? BODY} numberOfLines={1}>{interpolate(node.value, scope)}</Text>;
    case "field": {
      const base = resolvePointer(scope, node.bind);
      const value = base && typeof base === "object" ? (base as Record<string, unknown>)[node.field] : undefined;
      return <Text style={BODY} numberOfLines={1}>{value === undefined || value === null || typeof value === "object" ? "" : String(value)}</Text>;
    }
    case "button":
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => rt.screen.run(node.action, scope.row)}
          style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.button, (hovered || pressed) && styles.buttonOn]}
        >
          <Text style={styles.buttonText}>{interpolate(node.label, scope)}</Text>
        </Pressable>
      );
    case "use": {
      const Component = rt.builtins.resolve(node.component);
      if (!Component) return <Text style={[styles.muted, styles.pad]} testID="kit-missing-component">{`${node.component} is not available in this build`}</Text>;
      const props: Record<string, unknown> = {};
      for (const [k, pointer] of Object.entries(node.props ?? {})) props[k] = resolvePointer(scope, pointer);
      return <Component screen={{ ...rt.screen, scope }} props={props} />;
    }
    case "when":
      return evalExpr(node.expr, scope) ? <Layout node={node.then} scope={scope} rt={rt} /> : node.else ? <Layout node={node.else} scope={scope} rt={rt} /> : null;
  }
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  board: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12 },
  boardItem: { width: 240 },
  muted: { color: "var(--ink-3)" as string, fontSize: 13 },
  pad: { padding: 16 },
  button: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  buttonOn: { backgroundColor: "var(--hover)" as string },
  buttonText: { color: "var(--accent-ink)" as string, fontSize: 13, fontWeight: "500" },
});
