// Draws the blocks of a streaming message. A final block is a memoised component keyed by its position and handed the same object every frame, so React skips it; only the open block (and its
// caret) is drawn again. Typography is the prototype's message body: 15 px on a 24 px line, 10 px between blocks, code in the mono face on `--sunk`.
import { Fragment, createContext, memo, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Block, Inline } from "./markdown.ts";
import { CODE_TINT, HIGHLIGHT, RADIUS } from "../tokens/calm.ts";
import { BLOCK_GAP, BODY_LINE, BODY_SIZE } from "./Reserved.tsx";
import { CalloutBlock, ChartBlock, CodeBlock, DetailsBlock, DiagramBlock, FootnoteLine, ImageBlock, MathBlock, MathInline } from "./Blocks.tsx";

/** Draws a link its own way (a known subject with its hover card) or returns null to draw it as the plain link. */
/** Draws something under a fenced code block (a Run bar), or null for nothing. Only called for a block that is finished. */
export type RenderCode = (block: Extract<Block, { kind: "code" }>) => ReactNode | null;

export type RenderLink = (href: string, children: ReactNode, key: number) => ReactNode | null;

/** Draws a run of plain words its own way (a note turns the file names in it into links); return the words unchanged to leave them. */
export type RenderText = (text: string) => ReactNode;

const TextCtx = createContext<RenderText | null>(null);
/** A run of plain words: as written, or as the page's renderText draws it. */
function RunText({ v }: { v: string }): ReactNode {
  const r = useContext(TextCtx);
  return <Fragment>{r ? r(v) : v}</Fragment>;
}

function inlineNodes(items: readonly Inline[], onLink?: (href: string) => void, renderLink?: RenderLink): ReactNode {
  // Plain loops, not .map: these are runs of text inside one block, not list rows (lint ui-rows is about lists of rows).
  const out: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const n = items[i];
    if (!n) continue;
    switch (n.t) {
      case "text":
        out.push(<RunText key={i} v={n.v} />);
        break;
      case "code":
        out.push(<Text key={i} style={styles.code}>{n.v}</Text>);
        break;
      case "strong":
        out.push(<Text key={i} style={styles.strong}>{inlineNodes(n.c, onLink, renderLink)}</Text>);
        break;
      case "del":
        out.push(<Text key={i} style={styles.del}>{inlineNodes(n.c, onLink, renderLink)}</Text>);
        break;
      case "br":
        out.push(<Fragment key={i}>{"\n"}</Fragment>);
        break;
      case "fnref":
        out.push(<Text key={i} accessibilityLabel={`Footnote ${n.id}`} testID={`fnref-${n.id}`} style={styles.fnref}>{`[${n.id}]`}</Text>);
        break;
      case "math":
        out.push(<MathInline key={i} tex={n.v} />);
        break;
      case "html":
        out.push(<Text key={i} style={n.tag === "kbd" ? styles.kbd : n.tag === "mark" ? styles.mark : n.tag === "sup" ? styles.sup : styles.sub}>{inlineNodes(n.c, onLink, renderLink)}</Text>);
        break;
      case "em":
        out.push(<Text key={i} style={styles.em}>{inlineNodes(n.c, onLink, renderLink)}</Text>);
        break;
      case "link": {
        const href = n.href;
        const own = renderLink ? renderLink(href, inlineNodes(n.c, onLink, renderLink), i) : null;
        if (own !== null && own !== undefined) { out.push(own); break; }
        // a reference address nothing resolved: the words it has (none), never a link to an address
        if (/^https:\/\/ref\.vyre\.invalid\//i.test(href)) { out.push(<Fragment key={i}>{inlineNodes(n.c, onLink, renderLink)}</Fragment>); break; }
        out.push(
          <Text key={i} accessibilityRole="link" onPress={() => (onLink ? onLink(href) : void Linking.openURL(href))} style={styles.link}>
            {inlineNodes(n.c, onLink, renderLink)}
          </Text>,
        );
        break;
      }
    }
  }
  return out;
}

/**
 * The caret at the end of the open text is a character, not a box. A box (a View or a nested Text) that sits after text which grows moves every frame, and the browser counts each move as a layout
 * shift; a character is part of the text it follows, so adding it and moving it change no element's position (perf layout_shift stays 0). It is a plain bar of the text face: a glyph from
 * another font (a block character) makes the line a pixel or two taller and every block that loses it shifts the one below.
 */
export const CARET = " |";

export interface BlockViewProps {
  block: Block;
  /** The caret follows the last inline of this block. Only the open block gets it. */
  caret?: boolean;
  onLink?: (href: string) => void;
  renderLink?: RenderLink;
  renderCode?: RenderCode;
}

/** The inline runs with the caret written into the last text run (or after the last non-text run), so it is part of an existing text node and never a node of its own. */
function withCaret(items: readonly Inline[]): readonly Inline[] {
  const last = items[items.length - 1];
  if (last && last.t === "text") return [...items.slice(0, -1), { t: "text", v: last.v + CARET }];
  return [...items, { t: "text", v: CARET }];
}

function listItems(block: Extract<Block, { kind: "ul" | "ol" }>, caret: boolean, onLink?: (href: string) => void, renderLink?: RenderLink): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < block.items.length; i++) {
    out.push(
      <View key={i} style={styles.item}>
        {block.checks && block.checks[i] !== null && block.checks[i] !== undefined
          ? <View testID={`check-${block.key}-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked: block.checks[i] === true, disabled: true }} accessibilityLabel={block.checks[i] === true ? "Done" : "Not done"} style={[styles.box, block.checks[i] === true && styles.boxOn]}>{block.checks[i] === true ? <Text style={styles.tick}>{"\u2713"}</Text> : null}</View>
          : <Text style={styles.marker}>{block.kind === "ul" ? "\u2022" : `${block.start + i}.`}</Text>}
        <Text style={styles.itemText}>{inlineNodes(caret && i === block.items.length - 1 ? withCaret(block.items[i] ?? []) : (block.items[i] ?? []), onLink, renderLink)}</Text>
      </View>,
    );
  }
  return out;
}

/** The plain words of inline runs: what a sort compares and what Copy as CSV writes. */
export function inlineText(items: readonly Inline[]): string {
  let out = "";
  for (const n of items) {
    if (n.t === "text" || n.t === "code") out += n.v;
    else if (n.t === "math") out += n.v;
    else if (n.t === "br") out += " ";
    else if (n.t === "fnref") out += `[${n.id}]`;
    else if (n.t === "strong" || n.t === "em" || n.t === "del" || n.t === "link" || n.t === "html") out += inlineText(n.c);
  }
  return out;
}

const asNumber = (s: string): number | null => {
  const t = s.replace(/[$\u20AC\u00A3%,\s]/g, "");
  return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/** The row order after sorting on a column: numbers by value (with $, % and commas set aside), anything else by its words; the same click again reverses it. */
export function sortRows(rows: readonly (readonly (readonly Inline[])[])[], col: number, dir: 1 | -1): number[] {
  const idx = rows.map((_, i) => i);
  const cell = (i: number): string => inlineText(rows[i]?.[col] ?? []);
  idx.sort((a, b) => {
    const x = asNumber(cell(a));
    const y = asNumber(cell(b));
    const c = x !== null && y !== null ? x - y : cell(a).localeCompare(cell(b), undefined, { numeric: true, sensitivity: "base" });
    return (c === 0 ? a - b : c) * dir;
  });
  return idx;
}

/** A table: sortable on a header press, Copy as CSV, and its own horizontal scroll inside the message, so a wide table never widens the page. The header is bold on a quiet ground, columns keep a readable width, and each column aligns as the separator row said. */
function TableView({ block, onLink, renderLink }: { block: Extract<Block, { kind: "table" }>; onLink?: (href: string) => void; renderLink?: RenderLink }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [copied, setCopied] = useState(false);
  const order = sort ? sortRows(block.rows, sort.col, sort.dir) : block.rows.map((_, i) => i);
  const press = (c: number): void => setSort(sort && sort.col === c ? (sort.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 });
  const row = (cs: readonly (readonly Inline[])[], head: boolean, r: number): ReactNode => {
    const out: ReactNode[] = [];
    for (let c = 0; c < block.head.length; c++) {
      const cell = (
        <Text style={[styles.cellText, head && styles.cellTextHead, { textAlign: block.align[c] ?? "left" }]}>
          {inlineNodes(cs[c] ?? [], onLink, renderLink)}{head && sort && sort.col === c ? (sort.dir === 1 ? " \u25B2" : " \u25BC") : ""}
        </Text>
      );
      out.push(
        head
          ? <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Sort by ${inlineText(cs[c] ?? [])}`} testID={`sort-${block.key}-${c}`} onPress={() => press(c)} style={[styles.cell, styles.cellHead, c === block.head.length - 1 && styles.cellLast]}>{cell}</Pressable>
          : <View key={c} testID={`cell-${block.key}-${r}-${c}`} style={[styles.cell, c === block.head.length - 1 && styles.cellLast]}>{cell}</View>,
      );
    }
    return <View key={head ? "h" : r} style={[styles.tr, head && styles.trHead, !head && r % 2 === 1 && styles.trAlt]} testID={head ? `thead-${block.key}` : `row-${block.key}-${r}`} accessibilityRole={head ? "header" : undefined}>{out}</View>;
  };
  const body: ReactNode[] = [];
  order.forEach((ri, pos) => body.push(row(block.rows[ri] ?? [], false, pos)));
  const csv = (): string => [block.head, ...block.rows.map((r) => block.head.map((_, c) => r[c] ?? []))].map((r) => r.map((c) => `"${inlineText(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const copy = (): void => {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
    void clip?.writeText?.(csv())?.catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View testID={`block-${block.key}`} style={styles.tableWrap} accessibilityRole={Platform.OS === "web" ? ("table" as never) : undefined}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll} testID={`table-scroll-${block.key}`}>
        <View style={styles.table}>{row(block.head, true, 0)}{body}</View>
      </ScrollView>
      <View style={styles.tableFoot}><Pressable accessibilityRole="button" accessibilityLabel="Copy as CSV" testID={`csv-${block.key}`} onPress={copy} style={styles.csvBtn}><Text style={styles.csvText}>{copied ? "Copied" : "Copy as CSV"}</Text></Pressable></View>
    </View>
  );
}

export const BlockView = memo(function BlockView({ block, caret = false, onLink, renderLink, renderCode }: BlockViewProps) {
  switch (block.kind) {
    case "p":
      return <Text testID={`block-${block.key}`} style={styles.p}>{inlineNodes(caret ? withCaret(block.inline) : block.inline, onLink, renderLink)}</Text>;
    case "h":
      return <Text testID={`block-${block.key}`} accessibilityRole="header" style={[styles.p, styles.h, HEADING[block.level]]}>{inlineNodes(caret ? withCaret(block.inline) : block.inline, onLink, renderLink)}</Text>;
    case "quote":
      return (
        <View testID={`block-${block.key}`} style={styles.quote}>
          <Text style={styles.quoteText}>{inlineNodes(caret ? withCaret(block.inline) : block.inline, onLink, renderLink)}</Text>
        </View>
      );
    case "hr":
      return <View testID={`block-${block.key}`} style={styles.rule} />;
    case "code":
      return (
        <View testID={`code-${block.key}`}>
          <CodeBlock id={block.key} lang={block.lang} text={block.text} caret={caret || !block.closed} />
          {renderCode && !caret && block.closed ? renderCode(block) : null}
        </View>
      );
    case "mermaid":
      return <DiagramBlock id={block.key} source={block.text} />;
    case "chart":
      return <ChartBlock id={block.key} spec={block.spec} error={block.error} source={block.text} />;
    case "math":
      return <MathBlock id={block.key} tex={block.text} />;
    case "img":
      return <ImageBlock id={block.key} src={block.src} alt={block.alt} />;
    case "fn":
      return <FootnoteLine id={block.id} blockId={block.key}>{inlineNodes(block.inline, onLink, renderLink)}</FootnoteLine>;
    case "callout":
      return <CalloutBlock id={block.key} variant={block.variant} title={block.title}>{block.inline.length > 0 ? <Text style={styles.quoteText}>{inlineNodes(caret ? withCaret(block.inline) : block.inline, onLink, renderLink)}</Text> : null}</CalloutBlock>;
    case "details":
      return (
        <DetailsBlock id={block.key} open={block.open} summary={inlineNodes(block.summary, onLink, renderLink)}>
          {/* ui-rows-lint: not a list (the blocks of a collapsible section: paragraphs, lists, code) */}
          {block.blocks.map((b) => <BlockView key={b.key} block={b} {...(onLink ? { onLink } : {})} {...(renderLink ? { renderLink } : {})} {...(renderCode ? { renderCode } : {})} />)}
        </DetailsBlock>
      );
    case "table":
      return <TableView block={block} {...(onLink ? { onLink } : {})} {...(renderLink ? { renderLink } : {})} />;
    case "ul":
    case "ol":
      return (
        <View testID={`block-${block.key}`} style={styles.list}>{listItems(block, caret, onLink, renderLink)}</View>
      );
  }
});

export interface MarkdownBlocksProps {
  blocks: readonly Block[];
  /** Show the caret after the last block (the message is still streaming). */
  streaming?: boolean;
  onLink?: (href: string) => void;
  /** Draws some links its own way (memory underlines known subjects with it); leave it out and every link is the plain accent link. */
  renderLink?: RenderLink;
  /** Draws a bar under a finished code block (Run); leave it out and a code block is just the code. */
  renderCode?: RenderCode;
  /** Draws plain words its own way (file names that open a tab); leave it out and words are words. */
  renderText?: RenderText;
}

/** Final blocks first (same objects every frame, so they do not re-render), then the open ones. */
export function MarkdownBlocks({ blocks, streaming = false, onLink, renderLink, renderCode, renderText }: MarkdownBlocksProps) {
  const last = blocks.length - 1;
  const views: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b) views.push(<BlockView key={b.key} block={b} caret={streaming && i === last} {...(onLink ? { onLink } : {})} {...(renderLink ? { renderLink } : {})} {...(renderCode ? { renderCode } : {})} />);
  }
  return (
    <TextCtx.Provider value={renderText ?? null}>
      <View testID="markdown-blocks" style={styles.root}>
        {views}
        {streaming && blocks.length === 0 ? <Text style={styles.p}>{CARET}</Text> : null}
      </View>
    </TextCtx.Provider>
  );
}

const HEADING = {
  1: { fontSize: 22, lineHeight: 30 },
  2: { fontSize: 19, lineHeight: 28 },
  3: { fontSize: 17, lineHeight: 26 },
  4: { fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  5: { fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  6: { fontSize: BODY_SIZE, lineHeight: BODY_LINE },
} as const;

const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const styles = StyleSheet.create({
  root: { width: "100%" },
  p: { color: "var(--ink)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE, marginBottom: BLOCK_GAP },
  h: { fontWeight: "600", marginTop: 4 },
  strong: { fontWeight: "600" },
  del: { textDecorationLine: "line-through", color: "var(--ink-3)" as string },
  fnref: { color: "var(--accent)" as string, fontSize: 11 },
  kbd: { fontFamily: MONO, fontSize: 12, backgroundColor: CODE_TINT, color: "var(--ink)" as string },
  mark: { backgroundColor: HIGHLIGHT, borderRadius: 4 },
  sup: { fontSize: 11 },
  sub: { fontSize: 11 },
  em: { fontStyle: "italic" },
  link: { color: "var(--accent)" as string },
  code: { fontFamily: MONO, fontSize: 13, backgroundColor: CODE_TINT },
  quote: { borderLeftWidth: 2, borderLeftColor: "var(--line-2)" as string, paddingLeft: 12, marginBottom: BLOCK_GAP },
  quoteText: { color: "var(--ink-2)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  rule: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 12 },
  pre: { backgroundColor: CODE_TINT, borderRadius: RADIUS, paddingHorizontal: 12, paddingVertical: 10, marginBottom: BLOCK_GAP },
  preText: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 13, lineHeight: 20 },
  list: { marginBottom: BLOCK_GAP },
  box: { width: 16, height: 16, borderRadius: 6, borderWidth: 1.5, borderColor: "var(--ink-4)" as string, marginRight: 6, marginTop: 4, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  tick: { color: "var(--accent-ink)" as string, fontSize: 11, lineHeight: 13, fontWeight: "700" },
  codeHead: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  lang: { flex: 1, color: "var(--ink-3)" as string, fontSize: 11.5 },
  copy: { paddingHorizontal: 8, height: 24, borderRadius: RADIUS, justifyContent: "center" },
  copyText: { color: "var(--ink-3)" as string, fontSize: 12 },
  tableWrap: { marginBottom: BLOCK_GAP, maxWidth: "100%", borderRadius: RADIUS, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  tableScroll: { flexGrow: 1 },
  table: { minWidth: "100%" as unknown as number },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  trHead: { borderTopWidth: 0 },
  tableFoot: { flexDirection: "row", justifyContent: "flex-end", borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  csvBtn: { paddingHorizontal: 10, height: 26, justifyContent: "center" },
  csvText: { color: "var(--ink-3)" as string, fontSize: 12 },
  trAlt: { backgroundColor: "var(--sunk)" as string },
  cell: { flexGrow: 1, flexShrink: 0, flexBasis: 120, minWidth: 96, paddingHorizontal: 12, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  cellLast: { borderRightWidth: 0 },
  cellHead: { backgroundColor: "var(--sunk)" as string },
  cellText: { color: "var(--ink)" as string, fontSize: 14, lineHeight: 20 },
  cellTextHead: { fontWeight: "600" },
  item: { flexDirection: "row", paddingLeft: 4, marginVertical: 3 },
  marker: { width: 22, color: "var(--ink-2)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  itemText: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
});
