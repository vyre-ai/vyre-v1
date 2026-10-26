// ui/DiffTab: a commit, a pull request, two versions or an agent's working changes (spec 2.16, 4.5, 4.7; ARCH 7.5).
// File list with counts, unified or split, word marks, paragraph diff for docx and md, a slider or side by side for images, inline comments with @ people
// and agents (an @ agent answers in the thread), revert of a single change. Keys owned here: j and k move files, n and p move changes, Cmd-Enter reverts
// the focused change. A diff tab is a tab like any file; the caller keeps its state while it is closed.
// Lists use the shared Row; the reply field is the shared CommentReply; menus use the shared Menu. Colours are skin tokens (CSS variables on web).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { CommentReply } from "../CommentReply/index.tsx";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { DIFF_KEYS } from "./props.ts";
import type { DiffBody, DiffComment, DiffFile, DiffHunk, DiffLayout, DiffTabProps, Density } from "./props.ts";

export type { DiffBody, DiffComment, DiffFile, DiffHunk, DiffLayout, DiffTabProps, Density } from "./props.ts";
export { DIFF_KEYS, frozenDiffTabProps } from "./props.ts";

/* ---------- capabilities (manifests/files.ts: changesets.revert_change, changesets.comments.add) ---------- */

export const REVERT_CAPABILITY = "changesets.revert_change" as const;
export const COMMENT_CAPABILITY = "changesets.comments.add" as const;

export type DiffInvoke = (capability: string, input: Record<string, unknown>) => Promise<unknown> | unknown;

export function revertInput(changesetId: string, path: string, hunkId: string): Record<string, unknown> {
  return { changesetId, path, hunkId };
}

/** The anchor of a comment on one change: a range in the file, quoting the changed text. */
export function commentAnchor(path: string, hunk: DiffHunk): { kind: "range"; path: string; quote: string } {
  const text = (hunk.added !== "" ? hunk.added : hunk.removed).replace(/\s+/g, " ").trim();
  return { kind: "range", path, quote: text.slice(0, 120) };
}

export function commentInput(changesetId: string, path: string, hunk: DiffHunk, text: string): Record<string, unknown> {
  const mentions = mentionsOf(text);
  return { changesetId, anchor: commentAnchor(path, hunk), text, ...(mentions.length > 0 ? { mentions } : {}) };
}

/* ---------- words ---------- */

/** Longest pair of texts (in tokens, multiplied) that gets word marks. */
export const MAX_CELLS = 1_000_000;

export type MarkKind = "same" | "del" | "add";

export interface Segment {
  text: string;
  kind: MarkKind;
}

/** Splits into words and the spaces between them, so a join gives the original text back. */
export function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Longest common subsequence over tokens: the indices kept from `a` and `b`. */
function lcs(a: readonly string[], b: readonly string[]): { a: Set<number>; b: Set<number> } {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const down = table[(i + 1) * width + j] ?? 0;
      const right = table[i * width + j + 1] ?? 0;
      table[i * width + j] = a[i] === b[j] ? (table[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(down, right);
    }
  }
  const keepA = new Set<number>();
  const keepB = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keepA.add(i);
      keepB.add(j);
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++;
    else j++;
  }
  return { a: keepA, b: keepB };
}

function merge(parts: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === part.kind) last.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

/** Word marks: the removed text with its deleted words marked, and the added text with its new words marked. A space between two marked words is marked too. */
export function wordMarks(removed: string, added: string): { removed: Segment[]; added: Segment[] } {
  const a = tokens(removed);
  const b = tokens(added);
  // a very long pair is shown as wholly removed and wholly added instead of costing a table of millions of cells
  if (a.length * b.length > MAX_CELLS) return { removed: [{ text: removed, kind: "del" }], added: [{ text: added, kind: "add" }] };
  const keep = lcs(a, b);
  const side = (list: readonly string[], kept: Set<number>, mark: MarkKind): Segment[] => {
    const raw: Segment[] = list.map((text, index) => ({ text, kind: kept.has(index) ? "same" : mark }));
    // a lone space between two marked words reads as one mark
    for (let index = 1; index < raw.length - 1; index++) {
      const here = raw[index];
      const before = raw[index - 1];
      const after = raw[index + 1];
      if (here !== undefined && before !== undefined && after !== undefined && here.kind === "same" && /^\s+$/.test(here.text) && before.kind === mark && after.kind === mark) here.kind = mark;
    }
    return merge(raw);
  };
  return { removed: side(a, keep.a, "del"), added: side(b, keep.b, "add") };
}

/** True when the two texts differ only by whitespace. Nothing is marked then. */
export function sameWords(removed: string, added: string): boolean {
  return removed.split(/\s+/).filter(Boolean).join(" ") === added.split(/\s+/).filter(Boolean).join(" ");
}

/* ---------- lines, paragraphs, rows ---------- */

export function linesOf(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** Paragraphs: blocks separated by a blank line (docx and md). */
export function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
}

export interface DiffLine {
  /** "-" removed, "+" added, " " context. */
  sign: "-" | "+" | " ";
  text: string;
  /** Word marks, when the line pairs with a line on the other side. */
  segments?: Segment[];
}

/** Unified rows for a text hunk: every removed line, then every added line. A removed and an added line at the same place get word marks. */
export function unifiedLines(hunk: DiffHunk, marks: boolean): DiffLine[] {
  const removed = linesOf(hunk.removed);
  const added = linesOf(hunk.added);
  const out: DiffLine[] = [];
  removed.forEach((text, index) => {
    const mate = added[index];
    const segs = marks && mate !== undefined && !sameWords(text, mate) ? wordMarks(text, mate).removed : undefined;
    out.push({ sign: "-", text, ...(segs === undefined ? {} : { segments: segs }) });
  });
  added.forEach((text, index) => {
    const mate = removed[index];
    const segs = marks && mate !== undefined && !sameWords(mate, text) ? wordMarks(mate, text).added : undefined;
    out.push({ sign: "+", text, ...(segs === undefined ? {} : { segments: segs }) });
  });
  return out;
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Split rows: the removed line on the left, the added line on the right, side by side at the same place. */
export function splitRows(hunk: DiffHunk, marks: boolean): SplitRow[] {
  const removed = linesOf(hunk.removed);
  const added = linesOf(hunk.added);
  const rows: SplitRow[] = [];
  for (let i = 0; i < Math.max(removed.length, added.length); i++) {
    const a = removed[i];
    const b = added[i];
    const both = a !== undefined && b !== undefined && marks && !sameWords(a, b) ? wordMarks(a, b) : null;
    rows.push({
      left: a === undefined ? null : { sign: "-", text: a, ...(both === null ? {} : { segments: both.removed }) },
      right: b === undefined ? null : { sign: "+", text: b, ...(both === null ? {} : { segments: both.added }) },
    });
  }
  return rows;
}

export interface ParagraphRow {
  kind: "removed" | "added";
  segments: Segment[];
}

/** Paragraph diff for docx and md: removed paragraphs, then added ones, with word marks where a paragraph pairs with one on the other side. */
export function paragraphRows(hunk: DiffHunk, marks: boolean): ParagraphRow[] {
  const removed = paragraphsOf(hunk.removed);
  const added = paragraphsOf(hunk.added);
  const rows: ParagraphRow[] = [];
  removed.forEach((text, index) => {
    const mate = added[index];
    rows.push({ kind: "removed", segments: marks && mate !== undefined && !sameWords(text, mate) ? wordMarks(text, mate).removed : [{ text, kind: "same" }] });
  });
  added.forEach((text, index) => {
    const mate = removed[index];
    rows.push({ kind: "added", segments: marks && mate !== undefined && !sameWords(mate, text) ? wordMarks(mate, text).added : [{ text, kind: "same" }] });
  });
  return rows;
}

/** A prose row of a review: one paragraph with its removed words struck and its added words filled (`changed`), or a whole removed or added paragraph. */
export interface ProseRow {
  kind: "removed" | "added" | "changed";
  segments: Segment[];
}

/** The words of a pair read as one paragraph, deleted words next to the words that replaced them. Null when most of the words differ (then the two are shown as a red line and a green one). */
export function inlineMarks(removed: string, added: string, limit = 0.5): Segment[] | null {
  const a = tokens(removed);
  const b = tokens(added);
  if (a.length * b.length > MAX_CELLS) return null;
  const keep = lcs(a, b);
  const words = (list: readonly string[]): number => list.filter((t) => !/^\s+$/.test(t)).length;
  const kept = (list: readonly string[], set: Set<number>): number => list.filter((t, i) => set.has(i) && !/^\s+$/.test(t)).length;
  const total = words(a) + words(b);
  if (total === 0) return null;
  const changed = words(a) - kept(a, keep.a) + (words(b) - kept(b, keep.b));
  if (changed / total > limit) return null;
  const raw: Segment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && !keep.a.has(i)) raw.push({ text: a[i++] ?? "", kind: "del" });
    else if (j < b.length && !keep.b.has(j)) raw.push({ text: b[j++] ?? "", kind: "add" });
    else { raw.push({ text: b[j] ?? "", kind: "same" }); i++; j++; }
  }
  // a lone space between two marks of one kind reads as part of the mark
  for (let k = 1; k < raw.length - 1; k++) {
    const here = raw[k];
    const before = raw[k - 1];
    const after = raw[k + 1];
    if (here && before && after && here.kind === "same" && /^\s+$/.test(here.text) && before.kind !== "same" && before.kind === after.kind) here.kind = before.kind;
  }
  return merge(raw);
}

/** Prose rows for a review: a paragraph with a small edit is one row, marked inline; a paragraph that was mostly rewritten is a removed row and an added row; the rest stand alone. */
export function proseRows(hunk: DiffHunk, marks: boolean): ProseRow[] {
  if (!marks) return paragraphRows(hunk, false);
  const removed = paragraphsOf(hunk.removed);
  const added = paragraphsOf(hunk.added);
  const rows: ProseRow[] = [];
  for (let index = 0; index < Math.max(removed.length, added.length); index++) {
    const r = removed[index];
    const a = added[index];
    if (r !== undefined && a !== undefined) {
      if (sameWords(r, a)) { rows.push({ kind: "removed", segments: [{ text: r, kind: "same" }] }, { kind: "added", segments: [{ text: a, kind: "same" }] }); continue; }
      const inline = inlineMarks(r, a);
      if (inline) rows.push({ kind: "changed", segments: inline });
      else { const w = wordMarks(r, a); rows.push({ kind: "removed", segments: w.removed }, { kind: "added", segments: w.added }); }
    } else if (r !== undefined) rows.push({ kind: "removed", segments: [{ text: r, kind: "same" }] });
    else if (a !== undefined) rows.push({ kind: "added", segments: [{ text: a, kind: "same" }] });
  }
  return rows;
}

/* ---------- navigation and keys ---------- */

export interface ChangeRef {
  path: string;
  hunkId: string;
}

/** Every change in file order, for n and p. */
export function changeList(files: readonly DiffFile[]): ChangeRef[] {
  const out: ChangeRef[] = [];
  for (const file of files) for (const hunk of file.hunks) out.push({ path: file.path, hunkId: hunk.id });
  return out;
}

/** j and k: the next or previous file. Stops at the ends. */
export function moveFile(files: readonly DiffFile[], path: string | null, key: "j" | "k"): string | null {
  if (files.length === 0) return null;
  const at = files.findIndex((f) => f.path === path);
  if (at < 0) return files[0]?.path ?? null;
  const next = key === "j" ? Math.min(files.length - 1, at + 1) : Math.max(0, at - 1);
  return files[next]?.path ?? null;
}

/** n and p: the next or previous change, across files. Stops at the ends. */
export function moveChange(changes: readonly ChangeRef[], from: ChangeRef | null, key: "n" | "p"): ChangeRef | null {
  if (changes.length === 0) return null;
  const at = from === null ? -1 : changes.findIndex((c) => c.path === from.path && c.hunkId === from.hunkId);
  if (at < 0) return changes[key === "n" ? 0 : changes.length - 1] ?? null;
  const next = key === "n" ? Math.min(changes.length - 1, at + 1) : Math.max(0, at - 1);
  return changes[next] ?? null;
}

export type DiffKeyAction = "next-file" | "prev-file" | "next-change" | "prev-change" | "revert";

/** What a key does. Nothing happens while a field has the focus. Cmd-Enter (Ctrl-Enter off a Mac) reverts the focused change. */
export function diffKeyAction(event: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, typing: boolean): DiffKeyAction | null {
  if (typing) return null;
  if (event.key === "Enter") return event.metaKey === true || event.ctrlKey === true ? "revert" : null;
  if (event.metaKey === true || event.ctrlKey === true || event.altKey === true) return null;
  if (event.key === "j") return "next-file";
  if (event.key === "k") return "prev-file";
  if (event.key === "n") return "next-change";
  if (event.key === "p") return "prev-change";
  return null;
}

/* ---------- revert and comments ---------- */

/** The files after one change is reverted: the hunk is gone and the counts follow. A file with no hunks left stays listed with 0 and 0. */
export function withoutChange(files: readonly DiffFile[], path: string, hunkId: string): DiffFile[] {
  return files.map((file) => {
    if (file.path !== path) return file;
    const gone = file.hunks.find((h) => h.id === hunkId);
    if (gone === undefined) return file;
    const added = Math.max(0, file.added - countOf(gone, "added"));
    const removed = Math.max(0, file.removed - countOf(gone, "removed"));
    return { ...file, added, removed, hunks: file.hunks.filter((h) => h.id !== hunkId) };
  });
}

function countOf(hunk: DiffHunk, side: "added" | "removed"): number {
  const text = hunk[side];
  return text === "" ? 0 : (text.match(/\n/g)?.length ?? 0) + 1;
}

// An @ starts a mention only at the start of the text or after a space or opening mark, so an e-mail address is not one.
const MENTION = /(^|[\s(["'])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export interface MentionSpan {
  start: number;
  end: number;
  name: string;
}

/** Where each @ person or agent sits in the text. Trailing punctuation is not part of the name. */
export function mentionSpans(text: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  for (const match of text.matchAll(MENTION)) {
    const lead = match[1] ?? "";
    const raw = match[2] ?? "";
    const name = raw.replace(/[._-]+$/, "");
    if (name === "") continue;
    const start = (match.index ?? 0) + lead.length;
    out.push({ start, end: start + 1 + name.length, name });
  }
  return out;
}

/** People and agents mentioned with @, once each. */
export function mentionsOf(text: string): string[] {
  const out: string[] = [];
  for (const span of mentionSpans(text)) if (!out.includes(span.name)) out.push(span.name);
  return out;
}

export interface BodyPart {
  text: string;
  mention: boolean;
}

/** A comment body split so every @mention can be coloured. */
export function bodyParts(text: string): BodyPart[] {
  const out: BodyPart[] = [];
  let at = 0;
  for (const span of mentionSpans(text)) {
    if (span.start > at) out.push({ text: text.slice(at, span.start), mention: false });
    out.push({ text: text.slice(span.start, span.end), mention: true });
    at = span.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mention: false });
  return out;
}

export function commentsFor(comments: readonly DiffComment[], hunkId: string): DiffComment[] {
  return comments.filter((c) => c.hunkId === hunkId);
}

/** "+2 -1": the counts beside a file. */
export function countsLabel(file: Pick<DiffFile, "added" | "removed">): string {
  return `+${file.added} −${file.removed}`;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Arrow keys on the image slider move it by 5, Home and End to the ends. */
export function sliderKey(value: number, key: string): number | null {
  if (key === "ArrowLeft" || key === "ArrowDown") return clampPercent(value - 5);
  if (key === "ArrowRight" || key === "ArrowUp") return clampPercent(value + 5);
  if (key === "Home") return 0;
  if (key === "End") return 100;
  return null;
}

/* ---------- web-only props without a ts-ignore ---------- */

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  preventDefault?: () => void;
  target?: { tagName?: string; isContentEditable?: boolean };
}

function isTyping(event: KeyLike): boolean {
  const tag = event.target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable === true;
}

/* ---------- pieces ---------- */

const MONO = Platform.OS === "web" ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" : "Menlo";

function Marked({ segments, mark, style }: { segments: readonly Segment[]; mark: "del" | "add"; style: StyleProp<TextStyle> }): ReactElement {
  const nodes: ReactNode[] = [];
  segments.forEach((seg, index) => {
    nodes.push(<Text key={index} style={seg.kind === "same" ? null : mark === "del" ? styles.markDel : styles.markAdd}>{seg.text}</Text>);
  });
  return <Text style={style}>{nodes}</Text>;
}

/** The body of a paragraph change (docx, md): removed paragraphs, then added ones. */
/** The unchanged text above or below a change in a prose file, as plain paragraphs, so the open file reads as the whole document. */
function Context({ text, where }: { text: string | undefined; where: "before" | "after" }): ReactElement | null {
  if (!text) return null;
  const nodes: ReactNode[] = [];
  paragraphsOf(text).forEach((p, index) => nodes.push(<View key={index} style={styles.para}><Text style={styles.prose}>{p}</Text></View>));
  return <View testID={`diff-para-context-${where}`}>{nodes}</View>;
}

function ParagraphBody({ hunk, marks, review = false }: { hunk: DiffHunk; marks: boolean; review?: boolean }): ReactElement {
  const nodes: ReactNode[] = [];
  nodes.push(<Context key="before" text={hunk.before} where="before" />);
  (review ? proseRows(hunk, marks) : paragraphRows(hunk, marks)).forEach((row, index) => {
    if (row.kind === "changed") {
      // ui-rows-lint: not a list (the marked words of one paragraph, inline text spans)
      const parts: ReactNode[] = row.segments.map((seg, k) => <Text key={k} style={seg.kind === "del" ? styles.inlineDel : seg.kind === "add" ? styles.markAdd : null}>{seg.text}</Text>);
      nodes.push(<View key={index} style={styles.para} testID="diff-para-changed"><Text style={styles.prose}>{parts}</Text></View>);
      return;
    }
    nodes.push(
      <View key={index} style={[styles.para, row.kind === "removed" ? styles.lineDel : styles.lineAdd]} testID={`diff-para-${row.kind}`}>
        <Marked segments={row.segments} mark={row.kind === "removed" ? "del" : "add"} style={styles.prose} />
      </View>,
    );
  });
  nodes.push(<Context key="after" text={hunk.after} where="after" />);
  return <View testID="diff-paragraphs">{nodes}</View>;
}

function SplitBody({ hunk, marks }: { hunk: DiffHunk; marks: boolean }): ReactElement {
  const nodes: ReactNode[] = [];
  splitRows(hunk, marks).forEach((row, index) => {
    nodes.push(
      <View key={index} style={styles.splitRow}>
        <SplitCell line={row.left} side="left" />
        <SplitCell line={row.right} side="right" />
      </View>,
    );
  });
  return <View testID="diff-split">{nodes}</View>;
}

/** The unchanged lines around a change, as context rows. */
export function contextLines(text: string | undefined): DiffLine[] {
  return linesOf(text ?? "").map((line) => ({ sign: " " as const, text: line }));
}

function UnifiedBody({ hunk, marks, bare = false }: { hunk: DiffHunk; marks: boolean; bare?: boolean }): ReactElement {
  const nodes: ReactNode[] = [];
  if (bare) nodes.push(<Text key="top" style={styles.gap} aria-hidden>{"…"}</Text>);
  contextLines(hunk.before).forEach((line, index) => {
    nodes.push(<LineRow key={`b${index}`} line={line} testID="diff-line-ctx" />);
  });
  unifiedLines(hunk, marks).forEach((line, index) => {
    nodes.push(<LineRow key={index} line={line} testID={`diff-line-${line.sign === "-" ? "del" : "add"}`} />);
  });
  contextLines(hunk.after).forEach((line, index) => {
    nodes.push(<LineRow key={`a${index}`} line={line} testID="diff-line-ctx" />);
  });
  if (bare) nodes.push(<Text key="bottom" style={styles.gap} aria-hidden>{"…"}</Text>);
  return <View testID="diff-unified">{nodes}</View>;
}

/** A comment: the author's face, the name, the text with every @mention coloured. */
/** A comment thread: a light bordered card with the face, the name, when ("Maya Chen · Today 9:38 am": the author's name, then a dot and the time, if the caller gives one), the text and a Reply link. */
function Note({ comment, onReply }: { comment: DiffComment; onReply?: () => void }): ReactElement {
  const parts: ReactNode[] = [];
  bodyParts(comment.body).forEach((part, index) => {
    parts.push(<Text key={index} style={part.mention ? styles.mention : null}>{part.text}</Text>);
  });
  const dot = comment.author.indexOf(" \u00b7 ");
  const name = dot >= 0 ? comment.author.slice(0, dot) : comment.author;
  const when = dot >= 0 ? comment.author.slice(dot + 3) : "";
  return (
    <View style={styles.comment} testID={`diff-note-${comment.id}`}>
      <Avatar name={name} {...(comment.authorId !== undefined ? { seedId: comment.authorId } : {})} kind="person" size={22} />
      <View style={styles.commentBody}>
        <View style={styles.who}>
          <Text style={styles.whoName}>{name}</Text>
          {when ? <Text style={styles.whoWhen}>{when}</Text> : null}
        </View>
        <Text style={styles.text}>{parts}</Text>
        {onReply ? <Text accessibilityRole="button" aria-label="Reply" onPress={onReply} testID={`diff-note-reply-${comment.id}`} style={styles.replyLink}>Reply</Text> : null}
      </View>
    </View>
  );
}

function LineRow({ line, testID }: { line: DiffLine; testID: string }): ReactElement {
  const removed = line.sign === "-";
  const context = line.sign === " ";
  return (
    <View style={[styles.line, context ? null : removed ? styles.lineDel : styles.lineAdd]} testID={testID}>
      <Text style={[styles.sign, context ? null : removed ? styles.signDel : styles.signAdd]} aria-hidden>{context ? " " : line.sign}</Text>
      {line.segments === undefined
        ? <Text style={styles.code}>{line.text === "" ? " " : line.text}</Text>
        : <Marked segments={line.segments} mark={removed ? "del" : "add"} style={styles.code} />}
    </View>
  );
}

function SplitCell({ line, side }: { line: DiffLine | null; side: "left" | "right" }): ReactElement {
  if (line === null) return <View style={[styles.cell, styles.cellEmpty]} />;
  const removed = line.sign === "-";
  return (
    <View style={[styles.cell, removed ? styles.lineDel : styles.lineAdd]} testID={`diff-split-${side}`}>
      <Text style={[styles.sign, removed ? styles.signDel : styles.signAdd]} aria-hidden>{line.sign}</Text>
      {line.segments === undefined
        ? <Text style={styles.code}>{line.text === "" ? " " : line.text}</Text>
        : <Marked segments={line.segments} mark={removed ? "del" : "add"} style={styles.code} />}
    </View>
  );
}

/** Before and after of an image: a slider (drag, or arrows) or the two side by side. */
export function ImageDiff({ before, after, mode, onMode }: { before: string; after: string; mode: "slider" | "side"; onMode: (mode: "slider" | "side") => void }): ReactElement {
  const [pos, setPos] = useState(50);
  const [width, setWidth] = useState(0);
  return (
    <View testID="diff-image">
      <View style={styles.imageBar}>
        <SegButton label="Slider" on={mode === "slider"} onPress={() => onMode("slider")} testID="diff-image-slider" />
        <SegButton label="Side by side" on={mode === "side"} onPress={() => onMode("side")} testID="diff-image-side" />
      </View>
      {mode === "side" ? (
        <View style={styles.imageSide}>
          <View style={styles.imageCol}><Text style={styles.imageLabel}>Before</Text><Image source={{ uri: before }} style={styles.image} resizeMode="contain" accessibilityLabel="Before" /></View>
          <View style={styles.imageCol}><Text style={styles.imageLabel}>After</Text><Image source={{ uri: after }} style={styles.image} resizeMode="contain" accessibilityLabel="After" /></View>
        </View>
      ) : (
        <Pressable
          role="slider"
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pos}
          focusable
          testID="diff-image-compare"
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            if (width > 0) setPos(clampPercent((e.nativeEvent.locationX / width) * 100));
          }}
          style={styles.slider}
          {...webProps({ onKeyDown: (event: KeyLike) => { const next = sliderKey(pos, event.key); if (next !== null) { event.preventDefault?.(); setPos(next); } } })}
        >
          <Image source={{ uri: after }} style={styles.sliderImage} resizeMode="contain" accessibilityLabel="After" />
          <View style={[styles.sliderClip, { width: `${pos}%` }]}>
            <Image source={{ uri: before }} style={[styles.sliderImage, { width }]} resizeMode="contain" accessibilityLabel="Before" />
          </View>
          <View style={[styles.sliderHandle, { left: `${pos}%` }]} />
        </Pressable>
      )}
    </View>
  );
}

function SegButton({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable role="button" aria-label={label} aria-pressed={on} testID={testID} onPress={onPress} style={[styles.seg, on && styles.segOn]}>
      <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
    </Pressable>
  );
}

/* ---------- the view ---------- */

export interface DiffTabViewProps extends DiffTabProps {
  changesetId?: string;
  /** When given, Revert and Comment call the capabilities themselves. */
  invoke?: DiffInvoke;
  onRevert?: (path: string, hunk: DiffHunk) => void;
  onComment?: (path: string, hunk: DiffHunk, text: string, mentions: readonly string[]) => void;
  onSelectFile?: (path: string) => void;
  onLayout?: (layout: DiffLayout) => void;
  /** A version compare: no toolbar and no per-change buttons, the changed lines sit in the page between "…" marks with their unchanged neighbours. */
  bare?: boolean;
  testID?: string;
}

export function DiffTab(props: DiffTabViewProps): ReactElement {
  const { density, invoke, changesetId, onRevert, onComment, onSelectFile } = props;
  const bare = props.bare === true;
  const [layout, setLayout] = useState<DiffLayout>(props.layout);
  const [marks, setMarks] = useState(props.wordMarks);
  const [files, setFiles] = useState<readonly DiffFile[]>(props.files);
  const [comments, setComments] = useState<readonly DiffComment[]>(props.comments);
  const [path, setPath] = useState<string | null>(props.selectedPath ?? props.files[0]?.path ?? null);
  const [focus, setFocus] = useState<ChangeRef | null>(null);
  const [replying, setReplying] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"slider" | "side">("slider");
  const [reverted, setReverted] = useState("");
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const { element: menuElement, show } = useMenu();

  useEffect(() => setFiles(props.files), [props.files]);
  useEffect(() => setComments(props.comments), [props.comments]);

  const changes = useMemo(() => changeList(files), [files]);
  const file = files.find((f) => f.path === path) ?? files[0] ?? null;
  const total = useMemo(() => files.reduce((sum, f) => ({ added: sum.added + f.added, removed: sum.removed + f.removed }), { added: 0, removed: 0 }), [files]);

  const pickFile = useCallback((next: string) => {
    setPath(next);
    setFocus(null);
    if (onSelectFile) onSelectFile(next);
  }, [onSelectFile]);

  const changeLayout = useCallback((next: DiffLayout) => {
    setLayout(next);
    if (props.onLayout) props.onLayout(next);
  }, [props]);

  const revert = useCallback((target: ChangeRef) => {
    const found = files.find((f) => f.path === target.path);
    const hunk = found?.hunks.find((h) => h.id === target.hunkId);
    if (found === undefined || hunk === undefined) return;
    if (invoke && changesetId !== undefined) void invoke(REVERT_CAPABILITY, revertInput(changesetId, found.path, hunk.id));
    if (onRevert) onRevert(found.path, hunk);
    setFiles((list) => withoutChange(list, found.path, hunk.id));
    setFocus(null);
    setReverted(`Reverted one change in ${found.path}.`);
  }, [files, invoke, changesetId, onRevert]);

  const sendComment = useCallback((hunk: DiffHunk, text: string) => {
    if (file === null) return;
    const mentions = mentionsOf(text);
    if (invoke && changesetId !== undefined) void invoke(COMMENT_CAPABILITY, commentInput(changesetId, file.path, hunk, text));
    if (onComment) onComment(file.path, hunk, text, mentions);
    setComments((list) => [...list, { id: `local_${list.length + 1}`, hunkId: hunk.id, author: "You", body: text, mentions }]);
    setReplying(null);
  }, [file, invoke, changesetId, onComment]);

  const onKeyDown = (event: KeyLike): void => {
    const action = diffKeyAction(event, isTyping(event));
    if (action === null) return;
    event.preventDefault?.();
    if (action === "next-file" || action === "prev-file") {
      const next = moveFile(files, path, action === "next-file" ? "j" : "k");
      if (next !== null) pickFile(next);
    } else if (action === "next-change" || action === "prev-change") {
      const next = moveChange(changes, focus, action === "next-change" ? "n" : "p");
      if (next !== null) {
        setPath(next.path);
        setFocus(next);
      }
    } else if (focus !== null) {
      revert(focus);
    }
  };

  const hunkMenu = (hunk: DiffHunk): MenuEntry[] => [
    { label: "Comment", icon: "edit", onSelect: () => setReplying(hunk.id) },
    { label: "Revert this change", icon: "x", danger: true, onSelect: () => file !== null && revert({ path: file.path, hunkId: hunk.id }) },
  ];

  const hunks: ReactNode[] = [];
  if (file !== null) {
    for (const hunk of file.hunks) {
      const lit = focus !== null && focus.path === file.path && focus.hunkId === hunk.id;
      const notes: ReactNode[] = [];
      for (const c of commentsFor(comments, hunk.id)) notes.push(<Note key={c.id} comment={c} onReply={() => setReplying(hunk.id)} />);
      hunks.push(
        <View
          key={hunk.id}
          style={[styles.hunk, bare && styles.hunkBare, lit && styles.hunkLit]}
          testID={`diff-hunk-${hunk.id}`}
          aria-current={lit ? true : undefined}
          {...menuTrigger((x, y) => show(hunkMenu(hunk), x, y, "context", { label: "Change" }))}
          {...webProps({ onMouseDown: () => setFocus({ path: file.path, hunkId: hunk.id }) })}
        >
          {bare ? null : (
            <View style={styles.hunkHead}>
              <Text style={styles.ctx} numberOfLines={1}>{`… ${hunk.context}`}</Text>
              <View style={styles.grow} />
              <HunkButton label="Comment" testID={`diff-comment-${hunk.id}`} onPress={() => setReplying(replying === hunk.id ? null : hunk.id)} />
              <HunkButton label="Revert" testID={`diff-revert-${hunk.id}`} onPress={() => revert({ path: file.path, hunkId: hunk.id })} danger />
            </View>
          )}
          {file.body === "image" ? (
            <ImageDiff before={hunk.removed} after={hunk.added} mode={imageMode} onMode={setImageMode} />
          ) : file.body === "paragraph" ? (
            <ParagraphBody hunk={hunk} marks={marks} review={bare} />
          ) : layout === "split" ? (
            <SplitBody hunk={hunk} marks={marks} />
          ) : (
            <UnifiedBody hunk={hunk} marks={marks} bare={bare} />
          )}
          {notes}
          {replying === hunk.id ? (
            <View style={styles.reply}>
              <CommentReply threadId={`${file.path}#${hunk.id}`} value="" placeholder="Comment, @ a person or an agent" disabled={false} density={density} onSend={(text) => sendComment(hunk, text)} testID={`diff-reply-${hunk.id}`} />
            </View>
          ) : null}
        </View>,
      );
    }
  }

  return (
    <View
      style={styles.root}
      testID={props.testID ?? "diff-tab"}
      role="region"
      aria-label={`Changes to ${props.title}`}
      {...webProps({ onKeyDown, tabIndex: 0, dataSet: { keys: DIFF_KEYS.join(","), layout, density } })}
    >
      {bare ? null : <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{props.title}</Text>
        <Text style={styles.counts} testID="diff-total">{countsLabel(total)}</Text>
        <View style={styles.grow} />
        <View style={styles.segs} role="radiogroup" aria-label="Layout">
          <SegButton label="Unified" on={layout === "unified"} onPress={() => changeLayout("unified")} testID="diff-layout-unified" />
          <SegButton label="Split" on={layout === "split"} onPress={() => changeLayout("split")} testID="diff-layout-split" />
        </View>
        <SegButton label="Word marks" on={marks} onPress={() => setMarks((on) => !on)} testID="diff-wordmarks" />
      </View>}
      <View style={[styles.body, density === "compact" && styles.bodyStack]}>
        {files.length > 1 ? (
          <View style={[styles.files, density === "compact" && styles.filesStack]} testID="diff-files" role="listbox" aria-label="Files">
            {files.map((f) => (
              <Row
                key={f.path}
                id={`diff-file-${f.path}`}
                title={f.path}
                selected={file !== null && f.path === file.path}
                trailing={<Text style={styles.fileCounts}>{f.body === "image" ? "image" : countsLabel(f)}</Text>}
                onPress={() => pickFile(f.path)}
              />
            ))}
          </View>
        ) : null}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
          {bare && files.length > 1 && file !== null ? (
            <FileHeader file={file} note={props.title} replies={comments.filter((c) => file.hunks.some((h) => h.id === c.hunkId)).length} shut={shut[file.path] === true} onToggle={() => setShut((m) => ({ ...m, [file.path]: m[file.path] !== true }))} />
          ) : null}
          {file === null || file.hunks.length === 0
            ? <Text style={styles.empty} testID="diff-empty">No differences</Text>
            : shut[file.path] === true ? null : hunks}
          {reverted !== "" ? <Text style={styles.done} role="status" testID="diff-reverted">{reverted}</Text> : null}
        </ScrollView>
      </View>
      {menuElement}
    </View>
  );
}

/** The open file's header row in a review (a bare tab with several files): chevron, name, the versions it spans (the tab's title), comments, +added -removed. */
function FileHeader({ file, note, replies, shut, onToggle }: { file: DiffFile; note: string; replies: number; shut: boolean; onToggle: () => void }): ReactElement {
  return (
    <View style={styles.fileHead} testID="diff-file-header">
      <Pressable role="button" aria-label={`${shut ? "Expand" : "Collapse"} ${file.path}`} aria-expanded={!shut} onPress={onToggle} testID="diff-file-toggle" style={styles.fileChev}>
        <Text style={styles.fileChevText} aria-hidden>{shut ? "\u203a" : "\u2304"}</Text>
      </Pressable>
      <Text style={styles.fileName} numberOfLines={1}>{file.path}</Text>
      {note ? <Text style={styles.fileNote} testID="diff-file-note">{note}</Text> : null}
      <View style={styles.grow} />
      {replies > 0 ? <Text style={styles.fileNote} testID="diff-file-replies">{`\u21a9 ${replies}`}</Text> : null}
      {file.body === "image" ? null : <><Text style={styles.fileAdd}>{`+${file.added}`}</Text><Text style={styles.fileDel}>{`\u2212${file.removed}`}</Text></>}
    </View>
  );
}

function HunkButton({ label, onPress, testID, danger = false }: { label: string; onPress: () => void; testID: string; danger?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      role="button"
      aria-label={label}
      testID={testID}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.hunkBtn, over && styles.hunkBtnOver]}
    >
      <Text style={[styles.hunkBtnText, danger && over && styles.hunkBtnDanger]}>{label}</Text>
    </Pressable>
  );
}

// react-native-web drops a color-mix() colour (it only passes var() through), so the washes are plain rgba that reads on paper and on graphite
const DEL_WASH = "rgba(217, 63, 63, 0.14)" as string;
const ADD_WASH = "rgba(47, 148, 97, 0.16)" as string;

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 44, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, flexWrap: "wrap" },
  title: { color: "var(--ink)" as string, fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  counts: { color: "var(--ink-3)" as string, fontSize: 12 },
  grow: { flex: 1 },
  segs: { flexDirection: "row", gap: 2, padding: 2, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  seg: { height: 24, paddingHorizontal: 10, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "0 0 0 1px var(--line)" as string },
  segText: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "500" },
  segTextOn: { color: "var(--ink)" as string },
  body: { flex: 1, flexDirection: "row", minHeight: 0 },
  bodyStack: { flexDirection: "column" },
  files: { width: 220, padding: 8, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  filesStack: { width: "100%", borderRightWidth: 0, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  fileHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 38, paddingHorizontal: 10 },
  fileChev: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  fileChevText: { fontSize: 14, color: "var(--ink-3)" as string },
  fileName: { flexShrink: 1, fontFamily: MONO, fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
  fileNote: { fontSize: 11.5, color: "var(--ink-3)" as string },
  fileAdd: { fontFamily: MONO, fontSize: 11.5, color: "var(--ok)" as string },
  fileDel: { fontFamily: MONO, fontSize: 11.5, color: "var(--danger)" as string },
  replyLink: { marginTop: 4, fontSize: 12, color: "var(--accent)" as string },
  fileCounts: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  scroll: { flex: 1 },
  scrollBody: { padding: 14, gap: 14 },
  hunk: { borderRadius: 8, overflow: "hidden", boxShadow: "0 0 0 1px var(--line)" as string, backgroundColor: "var(--raised)" as string },
  hunkBare: { borderRadius: 0, boxShadow: "none" as string, backgroundColor: "transparent" },
  gap: { color: "var(--ink-3)" as string, fontFamily: MONO, fontSize: 12.5, lineHeight: 20, paddingLeft: 22 },
  hunkLit: { boxShadow: "0 0 0 2px var(--accent-line)" as string },
  hunkHead: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, minHeight: 30 },
  ctx: { color: "var(--ink-3)" as string, fontSize: 12, flexShrink: 1 },
  hunkBtn: { height: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  hunkBtnOver: { backgroundColor: "var(--hover)" as string },
  hunkBtnText: { color: "var(--ink-3)" as string, fontSize: 12, fontWeight: "500" },
  hunkBtnDanger: { color: "var(--danger)" as string },
  line: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2, paddingRight: 10 },
  lineDel: { backgroundColor: DEL_WASH },
  lineAdd: { backgroundColor: ADD_WASH },
  sign: { width: 22, textAlign: "center", fontFamily: MONO, fontSize: 12.5, lineHeight: 20 },
  signDel: { color: "var(--danger)" as string },
  signAdd: { color: "var(--ok)" as string },
  code: { flex: 1, fontFamily: MONO, fontSize: 12.5, lineHeight: 20, color: "var(--ink)" as string },
  markDel: { backgroundColor: "rgba(217, 63, 63, 0.30)" as string, borderRadius: 3 },
  inlineDel: { backgroundColor: "rgba(217, 63, 63, 0.30)" as string, borderRadius: 3, textDecorationLine: "line-through" },
  markAdd: { backgroundColor: "rgba(47, 148, 97, 0.32)" as string, borderRadius: 3 },
  splitRow: { flexDirection: "row" },
  cell: { flex: 1, flexDirection: "row", alignItems: "flex-start", paddingVertical: 2, paddingRight: 8, minWidth: 0 },
  cellEmpty: { backgroundColor: "var(--sunk)" as string },
  para: { paddingVertical: 8, paddingHorizontal: 14 },
  prose: { color: "var(--ink)" as string, fontSize: 13.5, lineHeight: 21 },
  comment: { flexDirection: "row", gap: 9, marginHorizontal: 14, marginVertical: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)", backgroundColor: "var(--win)" as string },
  commentBody: { flex: 1, minWidth: 0, gap: 2 },
  who: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  whoName: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "600" },
  whoWhen: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  text: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 19 },
  mention: { color: "var(--accent)" as string, fontWeight: "500" },
  reply: { padding: 10, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  empty: { color: "var(--ink-3)" as string, fontSize: 12.5, padding: 16 },
  done: { color: "var(--ok)" as string, fontSize: 12 },
  imageBar: { flexDirection: "row", gap: 4, padding: 8 },
  imageSide: { flexDirection: "row", gap: 10, padding: 10 },
  imageCol: { flex: 1, gap: 4 },
  imageLabel: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  image: { width: "100%", height: 200, backgroundColor: "var(--sunk)" as string, borderRadius: 6 },
  slider: { height: 240, margin: 10, borderRadius: 8, overflow: "hidden", backgroundColor: "var(--sunk)" as string },
  sliderImage: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
  sliderClip: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
  sliderHandle: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: "var(--accent)" as string },
});
