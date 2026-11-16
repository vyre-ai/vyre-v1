// The drag and click wiring of a line or tile (P-L9e_25). Drag events are not on the list React Native Web forwards, so the page's own listeners do it, and they are set ONCE on the list's box and
// look the handlers up by the `data-fkey` of the element the event came from (event delegation): dragstart (what travels), dragover, dragleave and drop (on a folder), and a capture-phase click that
// records Cmd, Ctrl and Shift for the selection rules. A line adds nothing but two attributes (the shared Row's domProps); a tile does the same through this wrapper. Off the web there is no drag.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, ReactElement, ReactNode } from "react";
import { Platform, View } from "react-native";
import type { Mods } from "../tree/model.ts";

export interface DragHandlers {
  /** What a drag of this line carries. */
  payload(): string;
  /** A folder line is a drop target; a file line is not. */
  folder: boolean;
  onMods(mods: Mods): void;
  onOver(): void;
  onLeave(): void;
  onDrop(payload: string): void;
}

/** The handlers of the lines and tiles drawn, by key. Filled as they are drawn; the listeners read it when an event arrives. */
export type DragRegistry = Map<string, DragHandlers>;

/** The attributes that make an element a drag source the delegation finds. */
export const dragAttrs = (key: string): Record<string, unknown> => ({ draggable: true, "data-fkey": key });

const keyOf = (e: Event): string | null => {
  const t = e.target as { closest?: (s: string) => { getAttribute(n: string): string | null } | null } | null;
  return t?.closest?.("[data-fkey]")?.getAttribute("data-fkey") ?? null;
};

/** One set of listeners for the whole list: put it on the list's box. The box is held in state (a callback ref), so the listeners are set when the box is drawn, even if the list showed something else first (loading, empty). */
export function useDragDelegation(box: HTMLElement | null, registry: MutableRefObject<DragRegistry>): void {
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const el = box;
    if (!el || typeof el.addEventListener !== "function") return undefined;
    const at = (e: Event): DragHandlers | undefined => {
      const k = keyOf(e);
      return k === null ? undefined : registry.current.get(k);
    };
    const start = (e: DragEvent): void => {
      const h = at(e);
      if (!h) return;
      e.dataTransfer?.setData("text/plain", h.payload());
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
    };
    const click = (e: MouseEvent): void => {
      at(e)?.onMods({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
    };
    const over = (e: DragEvent): void => {
      const h = at(e);
      if (h?.folder) {
        e.preventDefault();
        h.onOver();
      }
    };
    const leave = (e: DragEvent): void => {
      const h = at(e);
      if (h?.folder) h.onLeave();
    };
    const drop = (e: DragEvent): void => {
      const h = at(e);
      if (h?.folder) {
        e.preventDefault();
        h.onDrop(e.dataTransfer?.getData("text/plain") ?? "");
      }
    };
    el.addEventListener("dragstart", start);
    el.addEventListener("click", click, true);
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragstart", start);
      el.removeEventListener("click", click, true);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [box, registry]);
}

/** A tile (or a native line): registers its handlers and, on the web, becomes a drag source by two attributes set once. */
export function DragWrap({
  fkey,
  registry,
  handlers,
  props,
  children,
}: {
  fkey: string;
  registry: MutableRefObject<DragRegistry>;
  handlers: DragHandlers;
  props: Record<string, unknown>;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<View | null>(null);
  registry.current.set(fkey, handlers);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || typeof el.setAttribute !== "function") return;
    el.draggable = true;
    el.setAttribute("data-fkey", fkey);
  }, [fkey]);
  return (
    <View ref={ref} {...props}>
      {children}
    </View>
  );
}

/** A stable callback ref that holds the element drawn (web: the DOM element) in state, for the hooks above. */
export function useBox(): [HTMLElement | null, (el: unknown) => void] {
  const [box, set] = useState<HTMLElement | null>(null);
  const setBox = useCallback((el: unknown) => set((el as HTMLElement | null) ?? null), []);
  return [box, setBox];
}

/** Every element carrying a data-fkey inside the box is a drag source: set once as it appears (rows are drawn at different times, by different parts of the tree). */
export function useDraggableRows(box: HTMLElement | null): void {
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const el = box;
    if (!el || typeof el.querySelectorAll !== "function") return undefined;
    const mark = (): void => {
      for (const n of Array.from(el.querySelectorAll<HTMLElement>("[data-fkey]"))) {
        if (n.draggable !== true && n.getAttribute("data-fkey") !== "root:all") n.draggable = true;
      }
    };
    mark();
    const seen = new MutationObserver(mark);
    seen.observe(el, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [box]);
}
