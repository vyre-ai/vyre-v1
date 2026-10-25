// Streaming render and layout-shift work (ARCH 9): deltas coalesced into one append per frame, markdown parsed incrementally for the open block only, and boxes reserved at the size of the final
// content. The chat place uses the store, StreamText and Feed for the open message; the blocks, rows and avatars use the reserved sizes.
export { createCoalescer, frameScheduler } from "./coalesce.ts";
export type { Coalescer, CoalescerStats, FrameScheduler } from "./coalesce.ts";
export { createIncrementalMarkdown, parseChunk, parseInline } from "./markdown.ts";
export type { Block, IncrementalMarkdown, Inline, MarkdownStats, MarkdownView } from "./markdown.ts";
export { createStreamStore } from "./store.ts";
export type { StreamSnapshot, StreamStats, StreamStore } from "./store.ts";
export { useStream } from "./useStream.ts";
export { BlockView, CARET, MarkdownBlocks } from "./Markdown.tsx";
export type { BlockViewProps, MarkdownBlocksProps } from "./Markdown.tsx";
export { StreamText } from "./StreamText.tsx";
export type { StreamTextProps } from "./StreamText.tsx";
export { END_SLACK, Feed, isAtEnd } from "./Feed.tsx";
export type { FeedProps } from "./Feed.tsx";
export { AVATAR_SIZE, AvatarSlot, BLOCK_GAP, BODY_LINE, BODY_SIZE, HEADER_GAP, HEADER_HEIGHT, ReservedImage, SkeletonMessage, messageHeight } from "./Reserved.tsx";
export type { AvatarSlotProps, ReservedImageProps, SkeletonMessageProps } from "./Reserved.tsx";
