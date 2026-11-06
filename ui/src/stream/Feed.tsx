// The scroll area of a conversation: it follows the end while the person is at the end, lets go when they scroll up, and says so (`atEnd`) so the place can show "to latest".
// Following happens in a layout effect, in the same frame as the commit that grew the content: DOM writes first, then one read of the scroll height (the one layout of the frame), then one write of
// the scroll position. Nothing reads layout between two writes, so a frame never lays out twice.
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Platform, ScrollView } from "react-native";
import type { StreamStore } from "./store.ts";
import type { NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";

/** Closer to the end than this and the person counts as at the end. */
export const END_SLACK = 24;

export function isAtEnd(scrollTop: number, clientHeight: number, scrollHeight: number, slack = END_SLACK): boolean {
  return scrollHeight - scrollTop - clientHeight <= slack;
}

/** When the feed's own height changes: it goes back to the end only while it follows and the person is at the end. Someone who scrolled up is left where they are. */
export function holdsEnd(follow: boolean, atEnd: boolean): boolean {
  return follow && atEnd;
}

export interface FeedProps {
  children: ReactNode;
  /** Changes whenever the content grew (a stream's snapshot version). The feed follows the end after each change. */
  followKey?: unknown;
  /** A stream whose snapshots grow the content. The feed follows the end on each of them, without the parent re-rendering. */
  store?: StreamStore;
  /** Follow the end while the person is there. Default on. */
  follow?: boolean;
  /** Open at the top, following only once the person reaches the end (a page that sits on top of its thread). */
  startAway?: boolean;
  /** Changes when the person acted and should see the result: the feed goes to the end and follows again, with no remount. */
  endKey?: number;
  testID?: string;
  /** Padding and width of the content inside the scroll area. */
  contentStyle?: StyleProp<ViewStyle>;
  onAtEndChange?: (atEnd: boolean) => void;
}

interface ScrollNode {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** A scrollbar that takes room (Windows, Linux) must not arrive late and push the text sideways: its place is kept from the first frame. */
const GUTTER = Platform.OS === "web" ? ({ scrollbarGutter: "stable" } as object) : null;
const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_VERSION = (): number => 0;

export function Feed({ children, followKey, store, follow = true, startAway = false, endKey = 0, testID = "stream-list", contentStyle, onAtEndChange }: FeedProps) {
  const ref = useRef<ScrollView | null>(null);
  const atEnd = useRef(!startAway);
  const [away, setAway] = useState(false);
  const lastEnd = useRef(endKey);
  if (lastEnd.current !== endKey) { lastEnd.current = endKey; atEnd.current = true; }
  const version = useSyncExternalStore(store ? store.subscribe : NO_SUBSCRIBE, store ? () => store.getSnapshot().version : NO_VERSION, store ? () => store.getSnapshot().version : NO_VERSION);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const now = isAtEnd(contentOffset.y, layoutMeasurement.height, contentSize.height);
    if (now !== atEnd.current) {
      atEnd.current = now;
      setAway(!now);
      onAtEndChange?.(now);
    }
  }, [onAtEndChange]);

  const toEnd = useCallback((): void => {
    if (Platform.OS === "web") {
      const node = (ref.current as unknown as { getScrollableNode?: () => ScrollNode } | null)?.getScrollableNode?.();
      if (node) node.scrollTop = node.scrollHeight;
    } else {
      ref.current?.scrollToEnd({ animated: false });
    }
  }, []);

  useLayoutEffect(() => {
    if (!follow || !atEnd.current) return;
    toEnd();
  }, [followKey, version, follow, endKey, toEnd]);

  // the list got shorter (a notice line, a taller composer, a menu opened under it) while the person was at the end: the end stays in view, so the last card's buttons are not cut off
  const onLayout = useCallback(() => { if (holdsEnd(follow, atEnd.current)) toEnd(); }, [follow, toEnd]);

  return (
    <ScrollView ref={ref} testID={testID} accessibilityLabel={away ? "Conversation, scrolled up" : "Conversation"} onScroll={onScroll} onLayout={onLayout} scrollEventThrottle={16} style={[{ flex: 1 }, GUTTER]} contentContainerStyle={contentStyle}>
      {children}
    </ScrollView>
  );
}
