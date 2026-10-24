// Renders a declarative LayoutNode tree (ARCH 3.5). Pointers read the screen scope: /queries/<name>, /state/<key>, /row.
// Every list row is one whole-width pressable: hover paints the row, Enter or Space presses it, Up and Down move between
// rows, right-click or Shift+F10 opens the screen's menu for that list. Row height is fixed so a loading skeleton and the
// real rows are the same size.
import { useState, type ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { LayoutNode } from "../types.ts";
import type { BuiltinRegistry, KitScreenContext } from "./builtins.ts";
import { evalExpr, interpolate, resolvePointer, type Scope } from "./pointer.ts";
import { ROW_HEIGHT } from "./states.tsx";

export interface LayoutRuntime {
  screen: KitScreenContext;
  builtins: BuiltinRegistry;
}

/** Lists longer than this are virtualised. */
export const VIRTUALIZE_OVER = 60;

const BODY: TextStyle = { color: "var(--ink)", fontSize: 14 };
const TEXT_STYLES: Readonly<Record<string, TextStyle>> = {
  title: { color: "var(--ink)", fontSize: 20, fontWeight: "600" },
  heading: { color: "var(--ink)", fontSize: 15, fontWeight: "600" },
  body: BODY,
  muted: { color: "var(--ink-3)", fontSize: 13 },
  caption: { color: "var(--ink-4)", fontSize: 12 },
};

/** The first button's action under a node: what pressing a whole row does. */
export function firstAction(node: LayoutNode): string | undefined {
  switch (node.t) {
    case "button": return node.action;
    case "stack": case "row":
      for (const child of node.children) { const a = firstAction(child); if (a) return a; }
      return undefined;
    case "when": return firstAction(node.then) ?? (node.else ? firstAction(node.else) : undefined);
    default: return undefined;
  }
}

/** The slice of the DOM that row keyboard navigation touches (web only; native hosts never send these events). */
interface DomEl {
  closest(selector: string): DomEl | null;
  parentElement: DomEl | null;
  querySelectorAll(selector: string): ArrayLike<DomEl>;
  focus(): void;
}

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const items = (value as Record<string, unknown>).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

function display(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? "" : String(value);
}

function isMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

function ListRow({ node, scope, rt, index, bind }: { node: Extract<LayoutNode, { t: "list" | "table" | "board" }>; scope: Scope; rt: LayoutRuntime; index: number; bind: string }) {
  const [hovered, setHovered] = useState(false);
  const [selected, setSelected] = useState(false);
  const action = firstAction(node.row);
  const press = () => { if (action) rt.screen.run(action, scope.row); else setSelected((s) => !s); };
  const menus = rt.screen.def.menus?.find((m) => m.target === bind);
  const open = (point: { x: number; y: number }) => {
    if (!menus || !rt.screen.env.openMenu) return;
    const items = menus.items.filter((i) => evalExpr(i.when, scope));
    rt.screen.env.openMenu({ target: bind, items, point, run: (a) => rt.screen.run(a, scope.row) });
  };
  const web = {
    onContextMenu: (e: { preventDefault(): void; clientX: number; clientY: number }) => { if (menus) { e.preventDefault(); open({ x: e.clientX, y: e.clientY }); } },
    onKeyDown: (e: { key: string; shiftKey: boolean; preventDefault(): void; currentTarget: unknown }) => {
      if (isMenuKey(e) && menus) {
        e.preventDefault();
        const r = (e.currentTarget as { getBoundingClientRect?: () => { left: number; bottom: number } }).getBoundingClientRect?.();
        open({ x: r?.left ?? 0, y: r?.bottom ?? 0 });
      }
    },
  } as object;
  return (
    <Pressable
      {...web}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`kit-row-${index}`}
      onPress={press}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.row, (hovered || selected) && styles.rowOn]}
    >
      <Layout node={node.row} scope={scope} rt={rt} />
    </Pressable>
  );
}

function ListView({ node, scope, rt }: { node: Extract<LayoutNode, { t: "list" | "table" | "board" }>; scope: Scope; rt: LayoutRuntime }) {
  const rows = rowsOf(resolvePointer(scope, node.bind));
  if (rows.length === 0) {
    return node.empty ? <Text style={[styles.muted, styles.pad]} testID="kit-list-empty">{node.empty}</Text> : null;
  }
  const rowScope = (item: unknown, index: number): Scope => ({ ...scope, row: item, index });
  const moveFocus = (e: { key: string; target: unknown; preventDefault(): void }) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const row = (e.target as DomEl | null)?.closest?.("[data-testid^='kit-row-']");
    const siblings = row?.parentElement?.querySelectorAll("[data-testid^='kit-row-']");
    if (!row || !siblings) return;
    const list = Array.from(siblings);
    const next = list[list.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  };
  const web = { onKeyDown: moveFocus } as object;
  if (node.t === "board") {
    return (
      <View style={styles.board} testID="kit-board">
        {rows.map((item, i) => (
          <View key={i} style={styles.boardItem}><ListRow node={node} scope={rowScope(item, i)} rt={rt} index={i} bind={node.bind} /></View>
        ))}
      </View>
    );
  }
  if (rows.length > VIRTUALIZE_OVER) {
    return (
      <FlatList
        {...web}
        testID="kit-list"
        data={rows}
        keyExtractor={(_item, i) => String(i)}
        getItemLayout={(_d, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
        renderItem={({ item, index }) => <ListRow node={node} scope={rowScope(item, index)} rt={rt} index={index} bind={node.bind} />}
      />
    );
  }
  return (
    <View {...web} accessibilityRole="list" testID="kit-list">
      {rows.map((item, i) => <ListRow key={i} node={node} scope={rowScope(item, i)} rt={rt} index={i} bind={node.bind} />)}
    </View>
  );
}

export function Layout({ node, scope, rt }: { node: LayoutNode; scope: Scope; rt: LayoutRuntime }): ReactElement | null {
  switch (node.t) {
    case "stack":
      return <View style={{ gap: node.gap ?? 0 }}>{node.children.map((c, i) => <Layout key={i} node={c} scope={scope} rt={rt} />)}</View>;
    case "row":
      return <View style={{ flexDirection: "row", alignItems: "center", gap: node.gap ?? 8, flex: 1 }}>{node.children.map((c, i) => <Layout key={i} node={c} scope={scope} rt={rt} />)}</View>;
    case "list": case "table": case "board":
      return <ListView node={node} scope={scope} rt={rt} />;
    case "text": {
      const style = TEXT_STYLES[node.style ?? "body"] ?? BODY;
      return <Text style={style} numberOfLines={1}>{interpolate(node.value, scope)}</Text>;
    }
    case "field": {
      const base = resolvePointer(scope, node.bind);
      const value = base && typeof base === "object" ? (base as Record<string, unknown>)[node.field] : undefined;
      return <Text style={BODY} numberOfLines={1}>{display(value)}</Text>;
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
      const props: Record<string, unknown> = {};
      for (const [k, pointer] of Object.entries(node.props ?? {})) props[k] = resolvePointer(scope, pointer);
      if (!Component) return <Text style={[styles.muted, styles.pad]} testID="kit-missing-component">{`${node.component} is not available in this build`}</Text>;
      return <Component screen={{ ...rt.screen, scope }} props={props} />;
    }
    case "when":
      return evalExpr(node.expr, scope) ? <Layout node={node.then} scope={scope} rt={rt} /> : node.else ? <Layout node={node.else} scope={scope} rt={rt} /> : null;
  }
}

const styles = StyleSheet.create({
  row: { height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, width: "100%" },
  rowOn: { backgroundColor: "var(--hover)" as string },
  board: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12 },
  boardItem: { width: 240 },
  muted: { color: "var(--ink-3)" as string, fontSize: 13 },
  pad: { padding: 16 },
  button: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  buttonOn: { backgroundColor: "var(--hover)" as string },
  buttonText: { color: "var(--accent-ink)" as string, fontSize: 13, fontWeight: "500" },
});
