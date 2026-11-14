// The browser's one picture in the Computer tab: still frames from computers.browser.preview, at most two a second and at least one every ten while the pane is seen, none while it is hidden or the sheet is open.
// Two layers sit in one fixed box. A new frame is decoded off screen and swapped in only when it is ready, so the old frame stays until then: no flash, no spinner, no resize jump (AGENT-COMPUTER-2026-11-13.md A5).
import { createElement, useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";

export const PREVIEW_EVERY_MS = 1500;
export const PREVIEW_IDLE_MS = 10_000;

type Call = (cap: string, input: unknown) => Promise<unknown>;
interface Shot {
  state?: string;
  png?: string;
}

/** Pulls frames while `active`; calls `show` with each new data URI. A failed read keeps the last frame and tries again later. Returns the stop function. */
export function pullFrames(
  call: Call,
  agentId: string,
  show: (uri: string) => void,
  o: { every?: number; hidden?: () => boolean; wait?: (ms: number) => Promise<void> } = {},
): () => void {
  const every = o.every ?? PREVIEW_EVERY_MS;
  const wait =
    o.wait ??
    ((ms: number) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, ms) as unknown as { unref?: () => void };
        t.unref?.();
      }));
  let live = true;
  let last = "";
  void (async () => {
    while (live) {
      if (!(o.hidden?.() ?? false)) {
        try {
          const s = (await call("computers.browser.preview", { agentId })) as Shot;
          if (live && s.state === "live" && typeof s.png === "string" && s.png !== "" && s.png !== last) {
            last = s.png;
            show(`data:image/png;base64,${s.png}`);
          }
        } catch {
          /* the last frame stays */
        }
      }
      if (live) await wait(every);
    }
  })();
  return () => {
    live = false;
  };
}

export function PreviewImage({
  call,
  agentId,
  active,
}: {
  call: Call;
  agentId: string;
  active: boolean;
}): ReactElement | null {
  const box = useRef<HTMLElement | null>(null);
  const front = useRef(0);
  useEffect(() => {
    if (Platform.OS !== "web" || !active) return undefined;
    const doc = (globalThis as { document?: Document }).document;
    const el = box.current;
    if (!doc || !el) return undefined;
    const layers = [el.children[0], el.children[1]] as HTMLImageElement[];
    const stop = pullFrames(
      call,
      agentId,
      (uri) => {
        const back = layers[1 - front.current]!;
        const now = layers[front.current]!;
        back.src = uri;
        const swap = (): void => {
          if (!el.isConnected) return;
          back.style.visibility = "visible";
          now.style.visibility = "hidden";
          front.current = 1 - front.current;
        };
        if (back.decode) void back.decode().then(swap, swap);
        else swap();
      },
      { hidden: () => doc.visibilityState === "hidden" },
    );
    return stop;
  }, [call, agentId, active]);
  if (Platform.OS !== "web") return null;
  const img = (i: number): ReactElement =>
    createElement("img", {
      key: i,
      alt: "",
      draggable: false,
      "data-testid": `browser-preview-${i}`,
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        visibility: "hidden",
      },
    });
  return (
    <View testID="browser-preview" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {createElement("div", { ref: box, style: { position: "absolute", inset: 0 } }, img(0), img(1))}
    </View>
  );
}
