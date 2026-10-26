// The table's scroller: one surface that scrolls both ways, with the header held at the top, the foot at the bottom and the first columns held at the left (those hold themselves with
// position: sticky inside their rows). React Native's ScrollView scrolls one way, so on the web this is one scrolling div; elsewhere it is a horizontal ScrollView around a vertical one.
import { createElement, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";

export interface ScrollPos { top: number; left: number }

/** Lets the grid move the scroll position (Cmd-Up, Cmd-Down, jump to a row). */
export interface ScrollHandle { to(top: number): void }

export function Scroller({ width, header, footer, children, height, onScroll, handle }: {
  handle?: MutableRefObject<ScrollHandle | null>; width: number; header: ReactNode; footer: ReactNode; children: ReactNode; height: number; onScroll: (pos: ScrollPos) => void;
}): ReactElement {
  const pos = useRef<ScrollPos>({ top: 0, left: 0 });
  if (Platform.OS === "web") {
    return createElement(
      "div",
      {
        "data-testid": "records-scroll",
        ref: (el: { scrollTop: number } | null) => { if (handle) handle.current = el ? { to: (top: number) => { el.scrollTop = top; } } : null; },
        onScroll: (e: { currentTarget: { scrollTop: number; scrollLeft: number } }) => onScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft }),
        style: { position: "absolute", inset: 0, overflow: "auto", overscrollBehavior: "contain" },
      },
      createElement(
        "div",
        { style: { width, minHeight: "100%", display: "flex", flexDirection: "column" } },
        createElement("div", { style: { position: "sticky", top: 0, zIndex: 4 } }, header),
        createElement("div", { style: { position: "relative", height, flex: "none" } }, children),
        createElement("div", { style: { position: "sticky", bottom: 0, zIndex: 4, marginTop: "auto" } }, footer),
      ),
    );
  }
  if (handle) handle.current = null;
  return (
    <ScrollView horizontal onScroll={(e) => { pos.current = { ...pos.current, left: e.nativeEvent.contentOffset.x }; onScroll(pos.current); }} scrollEventThrottle={16} contentContainerStyle={{ width, height: "100%" }} testID="records-scroll">
      <View style={{ width, flex: 1, minHeight: 0 }}>
        {header}
        <ScrollView onScroll={(e) => { pos.current = { ...pos.current, top: e.nativeEvent.contentOffset.y }; onScroll(pos.current); }} scrollEventThrottle={16} style={{ flex: 1 }}>
          <View style={{ height, width }}>{children}</View>
        </ScrollView>
        {footer}
      </View>
    </ScrollView>
  );
}
