// The chapters of the open chat: read from the server once the chat is long enough to have any, kept in step as messages arrive, and the one place that remembers what a person opened, closed or
// jumped to. A chat under the limit never calls the server: the hook is idle and returns nothing. The read is a plain query and never holds the chat.
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { chapterAt } from "./model.ts";
import type { ChapterInfo } from "./model.ts";

/** The server's own limit (modules/chat/handlers/chapters.ts): a chat of this many messages or fewer has none, so the app does not ask. */
export const CHAPTER_MIN = 40;
/** Read again at most this often while messages keep arriving. */
export const REFRESH_MS = 10_000;

type Call = (cap: string, input: unknown) => Promise<unknown>;

interface Doc {
  querySelector(s: string): { scrollIntoView?: (o: object) => void } | null;
  querySelectorAll(
    s: string,
  ): ArrayLike<{ getAttribute(n: string): string | null; getBoundingClientRect(): { top: number } }>;
  addEventListener(t: string, l: (e: KeyEvent) => void): void;
  removeEventListener(t: string, l: (e: KeyEvent) => void): void;
}
interface KeyEvent {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault(): void;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}
const docOf = (): Doc | undefined => (globalThis as unknown as { document?: Doc }).document;

export interface Chapters {
  chapters: readonly ChapterInfo[];
  /** The start of every chapter a person pressed. */
  flipped: ReadonlySet<number>;
  /** A message that has to be on screen: its chapter opens whatever was pressed. */
  reveal: number | null;
  flip(startSeq: number): void;
  /** Open the chapter and scroll to its heading. */
  jump(startSeq: number): void;
}

export function useChapters(o: {
  call: Call;
  threadId: string;
  /** How many messages the chat is known to hold: loaded ones, or more when older pages exist. */
  size: number;
  /** The newest message's sequence number: a change means a new message. */
  newest: number;
  /** The sequence number of a message a find, a link or a jump needs to show. */
  focusSeq: number | null;
}): Chapters {
  const [chapters, setChapters] = useState<readonly ChapterInfo[]>([]);
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(new Set());
  const [target, setTarget] = useState<number | null>(null);
  const last = useRef(0);
  const asked = useRef("");
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const long = o.size > CHAPTER_MIN;
  const { threadId, newest } = o;
  const callRef = useRef(o.call);
  callRef.current = o.call;

  useEffect(() => {
    setChapters([]);
    setFlipped(new Set());
    setTarget(null);
    last.current = 0;
    asked.current = "";
  }, [threadId]);

  useEffect(() => {
    if (!long) return;
    const stamp = `${threadId}:${newest}`;
    if (asked.current === stamp) return;
    let live = true;
    const go = (): void => {
      asked.current = stamp;
      last.current = Date.now();
      Promise.resolve(callRef.current("chat.chapters", { threadId })).then(
        (r) => {
          const list = (r as { chapters?: ChapterInfo[] } | null)?.chapters;
          if (live && Array.isArray(list)) setChapters(list);
        },
        () => {
          /* the chat reads fine without chapters */
        },
      );
    };
    const since = Date.now() - last.current;
    if (since >= REFRESH_MS || last.current === 0) go();
    else wait.current = setTimeout(go, REFRESH_MS - since);
    return () => {
      live = false;
      if (wait.current) clearTimeout(wait.current);
    };
  }, [long, threadId, newest]);

  const flip = useCallback((seq: number) => {
    setFlipped((cur) => {
      const next = new Set(cur);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }, []);

  const jump = useCallback(
    (seq: number) => {
      const c = chapters.find((x) => x.startSeq === seq);
      setFlipped((cur) => {
        // open it: a closed chapter is opened by a flip, an open one stays
        const wanted = c !== undefined && !c.current;
        const next = new Set(cur);
        if (wanted) next.add(seq);
        else next.delete(seq);
        return next;
      });
      setTarget(seq);
    },
    [chapters],
  );

  useEffect(() => {
    if (target === null || Platform.OS !== "web") return;
    const t = setTimeout(() => {
      docOf()
        ?.querySelector(`[data-testid="chapter-${target}"]`)
        ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      setTarget(null);
    }, 0);
    return () => clearTimeout(t);
  }, [target]);

  // alt up and alt down: the chapter above the top of the screen, or the next one below it
  useEffect(() => {
    if (Platform.OS !== "web" || chapters.length < 2) return;
    const d = docOf();
    if (!d) return;
    const onKey = (e: KeyEvent): void => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable === true) return;
      const heads = Array.from(d.querySelectorAll('[data-testid^="chapter-"]'))
        .map((n) => ({
          seq: Number((n.getAttribute("data-testid") ?? "").replace("chapter-", "")),
          top: n.getBoundingClientRect().top,
        }))
        .filter((h) => Number.isFinite(h.seq));
      const up = e.key === "ArrowUp";
      const pick = up ? [...heads].reverse().find((h) => h.top < 60) : heads.find((h) => h.top > 120);
      if (!pick) return;
      e.preventDefault();
      jump(pick.seq);
    };
    d.addEventListener("keydown", onKey);
    return () => d.removeEventListener("keydown", onKey);
  }, [chapters, jump]);

  const reveal = o.focusSeq !== null && chapterAt(chapters, o.focusSeq) ? o.focusSeq : null;
  return { chapters, flipped, reveal, flip, jump };
}
