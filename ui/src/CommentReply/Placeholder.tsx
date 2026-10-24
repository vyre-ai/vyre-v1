// F9 stand-in. The place paints `text` in a box labelled `label`.
// Full-width field, up arrow at the right edge (D56).

import type { CommentReplyProps, Density } from "./props.ts";
import { COMMENT_REPLY_SEND, COMMENT_REPLY_WIDTH } from "./props.ts";

export const COMMENT_REPLY_LABEL = "CommentReply";

export interface LabelledPlaceholder {
  label: typeof COMMENT_REPLY_LABEL;
  text: string;
  density: Density;
}

export function CommentReplyPlaceholder(props: CommentReplyProps): LabelledPlaceholder {
  const text = `${COMMENT_REPLY_LABEL} ${props.density}: ${COMMENT_REPLY_WIDTH}, ${COMMENT_REPLY_SEND}`;
  return { label: COMMENT_REPLY_LABEL, text, density: props.density };
}
