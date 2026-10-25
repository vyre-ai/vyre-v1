// The drag and click wiring of one line. React Native Web forwards only a fixed list of props to the page, and drag events are not on it, so the line's element gets its listeners straight
// from the DOM: dragstart (what travels), dragover, dragleave and drop (on a folder line), and a capture-phase click that records Cmd, Ctrl and Shift for the selection rules.
// Off the web there is no drag, and the wrapper is a plain View.
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
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

export function DragWrap({ handlers, props, children }: { handlers: DragHandlers; props: Record<string, unknown>; children: ReactNode }): ReactElement {
  const ref = useRef<View | null>(null);
  const live = useRef(handlers);
  live.current = handlers;
  const folder = handlers.folder;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== "function") return;
    el.draggable = true;
    const start = (e: DragEvent): void => {
      e.dataTransfer?.setData("text/plain", live.current.payload());
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };
    const click = (e: MouseEvent): void => live.current.onMods({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
    const over = (e: DragEvent): void => { e.preventDefault(); live.current.onOver(); };
    const leave = (): void => live.current.onLeave();
    const drop = (e: DragEvent): void => { e.preventDefault(); live.current.onDrop(e.dataTransfer?.getData("text/plain") ?? ""); };
    el.addEventListener("dragstart", start);
    el.addEventListener("click", click, true);
    if (folder) {
      el.addEventListener("dragover", over);
      el.addEventListener("dragleave", leave);
      el.addEventListener("drop", drop);
    }
    return () => {
      el.removeEventListener("dragstart", start);
      el.removeEventListener("click", click, true);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [folder]);
  return <View ref={ref} {...props}>{children}</View>;
}
