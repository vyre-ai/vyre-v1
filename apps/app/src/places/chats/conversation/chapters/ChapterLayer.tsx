// The one mount point of chapters in the conversation: it holds the hook (a hook cannot sit after the conversation's loading return) and hands its children the rows laid out in chapters, the rail
// dots and the jump. With no chapters the rows come back as the same array and nothing else happens.
import type { ReactElement, ReactNode } from "react";
import { railOf, withChapters } from "./model.ts";
import type { ChapterInfo, ChapterRow, Dot } from "./model.ts";
import { useChapters } from "./use-chapters.ts";
import type { Clock } from "../model.ts";

export interface Laid<R> {
  rows: Array<R | ChapterRow>;
  dots: Dot[];
  flip(startSeq: number): void;
  jump(startSeq: number): void;
}

export function ChapterLayer<R extends { kind: string }>(p: {
  call: (cap: string, input: unknown) => Promise<unknown>;
  threadId: string;
  /** How many messages the chat is known to hold. */
  size: number;
  /** The newest message's sequence number. */
  newest: number;
  /** The sequence number of a message that has to be on screen, if any. */
  focusSeq: number | null;
  rows: readonly R[];
  own: (r: R) => number | null;
  clock: Clock;
  children: (laid: Laid<R>) => ReactNode;
}): ReactElement {
  const s = useChapters(p);
  const chapters: readonly ChapterInfo[] = s.chapters;
  return (
    <>
      {p.children({
        rows: withChapters(p.rows, p.own, chapters, s.flipped, p.clock, s.reveal),
        dots: railOf(chapters),
        flip: s.flip,
        jump: s.jump,
      })}
    </>
  );
}
