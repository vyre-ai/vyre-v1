// The one mount point of chapters in the conversation: it holds the hook (a hook cannot sit after the conversation's loading return) and hands its children the rows laid out in chapters, the rail
// dots and the jump. With no chapters the rows come back as the same array and nothing else happens.
import type { ReactElement, ReactNode } from "react";
import { railOf, withChapters } from "./model.ts";
import type { ChapterInfo, ChapterRow, Dot } from "./model.ts";
import { useEffect } from "react";
import { setCurrentChapter } from "./current-chapter.ts";
import { JobLines } from "./JobLines.tsx";
import { useJobs } from "./jobs.ts";
import { useChapters } from "./use-chapters.ts";
import type { Clock } from "../model.ts";

export interface Laid<R> {
  rows: Array<R | ChapterRow>;
  dots: Dot[];
  /** The quiet lines of background jobs; goes at the foot of the chat. */
  jobs: ReactNode;
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
  /** Where background jobs are read from: the agents in the chat, and whether one is working now. */
  jobs?: { agentIds: readonly string[]; working: boolean };
  rows: readonly R[];
  own: (r: R) => number | null;
  clock: Clock;
  children: (laid: Laid<R>) => ReactNode;
}): ReactElement {
  const s = useChapters(p);
  const j = useJobs({
    call: p.call,
    agentIds: p.jobs?.agentIds ?? [],
    working: p.jobs?.working ?? false,
    now: Date.now,
  });
  const chapters: readonly ChapterInfo[] = s.chapters;
  const now = chapters.find((c) => c.current)?.title ?? "";
  useEffect(() => {
    setCurrentChapter(p.threadId, now);
    return () => setCurrentChapter(p.threadId, "");
  }, [p.threadId, now]);
  return (
    <>
      {p.children({
        rows: withChapters(p.rows, p.own, chapters, s.flipped, p.clock, s.reveal),
        dots: railOf(chapters),
        jobs: <JobLines running={j.running} finished={j.finished} now={Date.now()} />,
        flip: s.flip,
        jump: s.jump,
      })}
    </>
  );
}
