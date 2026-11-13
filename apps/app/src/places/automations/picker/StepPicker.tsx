// The step picker (owner, 13 Nov 2026, design 2.4): search on top; Suggested next; Vyre's groups; only the apps he has connected and may use, one row each with its actions in a submenu beside
// the list; Connect an app pinned last. Keys come from nav.ts. On a phone the submenu is a drill-in with a back arrow. It draws in the overlay layer, where it was pressed.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { AppLogo } from "../../../../../../ui/src/AppLogo/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { Overlay } from "../../../../../../ui/src/Overlay/index.tsx";
import { RADIUS } from "../../../../../../ui/src/tokens/radius.ts";
import { glyphOf, tintOf } from "./glyphs.ts";
import { pickerRows, submenuOf } from "./model.ts";
import type { Mark, PickIn, PickRow } from "./model.ts";
import { INITIAL, mainRows, step } from "./nav.ts";
import type { Input, Nav } from "./nav.ts";

export interface StepPickerProps {
  model: PickIn;
  /** Window coordinates of the press that opened it. */
  x: number;
  y: number;
  onChoose(stepId: string): void;
  onConnect(): void;
  onClose(): void;
  /** The app's own icon as the server serves it, by app id. */
  iconOf?(appId: string): string | undefined;
  /** Where the picker starts (the shots open it on an app or a search). */
  initial?: Partial<Nav>;
}

const web = Platform.OS === "web";
const FIXED = (web ? "fixed" : "absolute") as ViewStyle["position"];
const MAIN_W = 380;
const SUB_W = 320;

function Logo({
  mark,
  size,
  iconOf,
}: {
  mark: Mark;
  size: 20 | 24 | 28 | 32;
  iconOf?: StepPickerProps["iconOf"];
}): ReactElement {
  return (
    <View style={{ marginRight: 10 }}>
      <AppLogo
        app={mark.app}
        name={mark.name}
        size={size}
        iconUrl={iconOf?.(mark.app)}
        glyph={glyphOf(mark)}
        tint={tintOf(mark)}
      />
    </View>
  );
}

export function StepPicker(p: StepPickerProps): ReactElement {
  const win = useWindowDimensions();
  const phone = win.width < 560;
  const [nav, setNav] = useState<Nav>({ ...INITIAL, ...p.initial });
  const navRef = useRef(nav);
  navRef.current = nav;
  const send = (input: Input): void => {
    const r = step(p.model, navRef.current, input);
    navRef.current = r.state;
    setNav(r.state);
    if (r.effect?.kind === "choose") p.onChoose(r.effect.stepId);
    else if (r.effect?.kind === "connect") p.onConnect();
    else if (r.effect?.kind === "close") p.onClose();
  };
  const rows = useMemo(() => pickerRows(p.model, nav.query), [p.model, nav.query]);
  const lit = mainRows(p.model, nav)[nav.index];
  const litId = lit === undefined ? null : lit.kind === "connect" ? "connect" : lit.id;
  const sub = nav.open ? submenuOf(p.model, nav.open) : null;
  useEffect(() => {
    // a model that changed under the list (an app was just added) keeps the lit row inside it
    if (nav.index >= mainRows(p.model, nav).length) setNav((n) => ({ ...n, index: 0 }));
  }, [p.model, nav]);

  const left = Math.max(8, Math.min(p.x, win.width - MAIN_W - 8));
  const top = Math.max(8, Math.min(p.y, win.height - 580));
  // the actions open beside the row they belong to: its place is read from the row's element (the layer is the overlay's, never inside a ScrollView)
  // the lit row stays in view while the arrows move through a long list
  useEffect(() => {
    const doc = (
      globalThis as { document?: { querySelector?: (q: string) => { scrollIntoView?: (o: object) => void } | null } }
    ).document;
    const id = nav.open ?? litId;
    if (id && doc?.querySelector)
      doc.querySelector(`[data-testid="row-pk-${id}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [nav.index, nav.open, litId]);
  const [subTop, setSubTop] = useState<number | null>(null);
  useEffect(() => {
    const doc = (
      globalThis as {
        document?: { querySelector?: (q: string) => { getBoundingClientRect(): { top: number } } | null };
      }
    ).document;
    const el = nav.open && doc?.querySelector ? doc.querySelector(`[data-testid="row-pk-${nav.open}"]`) : null;
    setSubTop(el ? el.getBoundingClientRect().top - 5 : null);
  }, [nav.open, nav.query]);
  const subY = subTop === null ? top : Math.max(top, Math.min(subTop, top + 400, win.height - 380));
  const subLeft = left + MAIN_W + 6 + SUB_W > win.width - 8 ? Math.max(8, left - SUB_W - 6) : left + MAIN_W + 6;

  const onKeyDown = (e: {
    key: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    metaKey?: boolean;
    ctrlKey?: boolean;
  }): void => {
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(e.key)) {
      // in a search the caret keeps Left and Right
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && nav.col === "main" && nav.query !== "") return;
      e.preventDefault?.();
      e.stopPropagation?.();
      send({ key: e.key });
    }
  };

  const showSub = sub !== null && (!phone || nav.col === "sub");
  const showMain = !(phone && sub !== null && nav.col === "sub");

  return (
    <Overlay>
      <View
        style={styles.layer}
        testID="step-picker"
        pointerEvents="box-none"
        {...(web ? ({ onKeyDown, tabIndex: -1 } as object) : {})}
      >
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={p.onClose} />
        {showMain ? (
          <View
            aria-label="Add a step"
            testID="pk-main"
            style={[styles.panel, { left: phone ? 8 : left, top, width: phone ? win.width - 16 : MAIN_W }]}
          >
            <View style={styles.searchRow}>
              <Text style={styles.searchGlyph}>{"\u2315"}</Text>
              <TextInput
                autoFocus
                value={nav.query}
                onChangeText={(t) => send({ type: t })}
                placeholder="Search steps and apps"
                placeholderTextColor="var(--ink-3)"
                accessibilityLabel="Search"
                testID="pk-search"
                style={styles.search}
              />
            </View>
            <View style={styles.list}>
              {/* ui-rows-lint: not a list (section headings and ui/Row items; PickRowView draws each item as a Row) */}
              {rows
                .filter((r) => r.kind !== "connect")
                .map((r, i) => (
                  <PickRowView
                    key={r.kind === "heading" ? `h${i}` : `${r.kind}:${"id" in r ? r.id : "connect"}`}
                    row={r}
                    lit={litId !== null && r.kind !== "heading" && litId === r.id}
                    send={send}
                    p={p}
                    onOpen={(id) =>
                      setNav((n) => ({
                        ...n,
                        index: Math.max(
                          0,
                          mainRows(p.model, n).findIndex((x) => "id" in x && x.id === id),
                        ),
                        open: id,
                        col: "sub",
                        subIndex: 0,
                      }))
                    }
                  />
                ))}
              {mainRows(p.model, nav).every((r) => r.kind === "connect") && nav.query !== "" ? (
                <Text style={styles.none}>{`Nothing called “${nav.query}” in your apps.`}</Text>
              ) : null}
            </View>
            <View style={styles.pinned}>
              <Row
                id="pk-connect"
                title="Connect an app"
                selected={litId === "connect"}
                leading={<Logo mark={{ app: "vyre:plug", name: "Connect an app" }} size={28} iconOf={p.iconOf} />}
                domProps={{ style: { minHeight: 40 } }}
                onPress={p.onConnect}
              />
            </View>
          </View>
        ) : null}
        {showSub && sub ? (
          <View
            testID="pk-sub"
            role="menu"
            aria-label={sub.title}
            style={[
              styles.panel,
              { left: phone ? 8 : subLeft, top: phone ? top : subY, width: phone ? win.width - 16 : SUB_W },
            ]}
          >
            <View style={styles.subHead}>
              {phone ? (
                <Pressable
                  testID="pk-back"
                  accessibilityLabel="Back"
                  onPress={() => send({ key: "ArrowLeft" })}
                  style={styles.back}
                >
                  <Text style={styles.backGlyph}>{"‹"}</Text>
                </Pressable>
              ) : null}
              <Logo mark={sub.mark} size={20} iconOf={p.iconOf} />
              <Text style={styles.subTitle} numberOfLines={1}>
                {sub.title}
              </Text>
              <Text style={styles.meta}>{`${sub.items.length} ${sub.items.length === 1 ? "step" : "steps"}`}</Text>
            </View>
            {sub.items.map((item, i) => (
              <Row
                key={item.id}
                id={`pk-sub-${item.id}`}
                title={item.title}
                {...(item.desc ? { note: item.desc } : {})}
                selected={nav.col === "sub" && nav.subIndex === i}
                onPress={() => p.onChoose(item.id)}
                domProps={{ onMouseEnter: () => setNav((n) => ({ ...n, col: "sub", subIndex: i })) }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Overlay>
  );
}

function PickRowView({
  row,
  lit,
  send,
  p,
  onOpen,
}: {
  row: PickRow;
  lit: boolean;
  send: (i: Input) => void;
  p: StepPickerProps;
  onOpen(id: string): void;
}): ReactElement {
  if (row.kind === "heading")
    return (
      <View style={styles.heading}>
        <Text style={styles.headText}>{row.text}</Text>
        {row.note ? <Text style={styles.headNote}>{row.note}</Text> : null}
      </View>
    );
  if (row.kind === "connect") return <></>;
  const opens = row.kind === "group" || row.kind === "app";
  const trailing = opens ? (
    <Text style={styles.meta}>{`${row.count}  \u203a`}</Text>
  ) : row.kind === "step" && row.where ? (
    <Text style={styles.meta} numberOfLines={1}>
      {row.where}
    </Text>
  ) : undefined;
  return (
    <Row
      id={`pk-${row.id}`}
      title={row.title}
      {...(row.kind === "step" && row.desc ? { note: row.desc } : {})}
      selected={lit}
      leading={<Logo mark={row.mark} size={28} iconOf={p.iconOf} />}
      {...(trailing !== undefined ? { trailing } : {})}
      domProps={{ style: { minHeight: 40 }, ...(opens ? { onMouseEnter: () => send({ hover: row.id }) } : {}) }}
      onPress={() => (opens ? onOpen(row.id) : p.onChoose(row.id))}
    />
  );
}

const styles = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147483000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
  panel: {
    position: FIXED,
    maxHeight: 560,
    padding: 5,
    borderRadius: RADIUS,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-pop)" as string,
    overflow: "hidden",
    ...({ outlineStyle: "none" } as unknown as ViewStyle),
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "var(--line)" as string,
    marginBottom: 4,
  },
  searchGlyph: { fontSize: 16, color: "var(--ink-3)" as string, marginRight: 8 },
  search: {
    flex: 1,
    height: 40,
    fontSize: 14,
    color: "var(--ink)" as string,
    ...({ outlineStyle: "none" } as unknown as ViewStyle),
  },
  pinned: { borderTopWidth: 1, borderTopColor: "var(--line)" as string, marginTop: 4, paddingTop: 4 },
  list: { overflow: "scroll" as ViewStyle["overflow"], maxHeight: 440 },
  heading: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 3,
  },
  headText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  headNote: { fontSize: 11.5, color: "var(--ink-4)" as string },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: RADIUS,
    ...({ outlineStyle: "none" } as unknown as ViewStyle),
  },
  meta: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  none: { paddingVertical: 10, paddingHorizontal: 10, fontSize: 12.5, color: "var(--ink-3)" as string },
  subHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  subTitle: { flex: 1, fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  back: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  backGlyph: { fontSize: 20, color: "var(--ink-2)" as string },
});
