// Frozen props for ui/CommentReply. Spec 3.0 (D56), ARCH 7, F9.
// Comment threads end in one full-width reply field. The send control is
// an up arrow at the right edge. Width and the arrow are not caller choices.

/** Phone layouts pass `compact`. Desktop passes `regular`. ARCH 7.11. */
export type Density = "regular" | "compact";

/** The field is full width. Hover and the send control share that width. */
export const COMMENT_REPLY_WIDTH = "full" as const;

/** Up arrow at the right edge. The word Send is not the control. */
export const COMMENT_REPLY_SEND = "up" as const;

export interface CommentReplyProps {
  threadId: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  density: Density;
}

export const frozenCommentReplyProps = {
  threadId: "thr_file_1",
  value: "",
  placeholder: "Reply",
  disabled: false,
  density: "compact",
} as const satisfies CommentReplyProps;
