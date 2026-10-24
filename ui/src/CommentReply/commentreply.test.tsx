// ui/CommentReply: a full-width reply field that ends a comment thread, with an up-arrow send at the right edge (D56).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentReply, COMMENT_REPLY_SEND, COMMENT_REPLY_WIDTH, canSendReply, fieldHeights, frozenCommentReplyProps } from "./index.tsx";

test("the field is full width and the send control is the up arrow, never the word Send", () => {
  const html = renderToStaticMarkup(<CommentReply {...frozenCommentReplyProps} />);
  assert.equal(COMMENT_REPLY_WIDTH, "full");
  assert.equal(COMMENT_REPLY_SEND, "up");
  assert.match(html, /data-width="full"/);
  assert.match(html, /data-send="up"/);
  assert.match(html, /placeholder="Reply"/);
  assert.match(html, /data-testid="comment-reply-thr_file_1"/);
  assert.match(html, /aria-label="Send reply"/);
  assert.doesNotMatch(html, />Send</, "no Send word in the control");
  assert.match(html, /<svg/, "the arrow is drawn");
});

test("the arrow is disabled until there is text, and when the thread is closed", () => {
  const empty = renderToStaticMarkup(<CommentReply {...frozenCommentReplyProps} />);
  assert.match(empty, /aria-disabled="true"/);
  const typed = renderToStaticMarkup(<CommentReply {...frozenCommentReplyProps} value="Looks good to me" />);
  assert.doesNotMatch(typed, /aria-disabled="true"/);
  assert.equal(canSendReply("Looks good", false), true);
  assert.equal(canSendReply("   ", false), false);
  assert.equal(canSendReply("Looks good", true), false);
  const closed = renderToStaticMarkup(<CommentReply {...frozenCommentReplyProps} value="Looks good to me" disabled />);
  assert.match(closed, /aria-disabled="true"/);
});

test("the field sits on the whole row: the box carries the width and the field fills it", () => {
  const html = renderToStaticMarkup(<CommentReply {...frozenCommentReplyProps} density="regular" />);
  assert.match(html, /r-width-/, "the box carries a width style");
});

test("compact density (phone) is taller for touch", () => {
  assert.ok(fieldHeights("compact").min > fieldHeights("regular").min);
  assert.ok(fieldHeights("compact").max >= fieldHeights("regular").max);
});
