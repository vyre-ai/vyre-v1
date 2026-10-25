// Draws the blocks of a streaming message. A final block is a memoised component keyed by its position and handed the same object every frame, so React skips it; only the open block (and its
// caret) is drawn again. Typography is the prototype's message body: 15 px on a 24 px line, 10 px between blocks, code in the mono face on `--sunk`.
import { Fragment, memo } from "react";
import type { ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { Block, Inline } from "./markdown.ts";
import { BLOCK_GAP, BODY_LINE, BODY_SIZE } from "./Reserved.tsx";

function inlineNodes(items: readonly Inline[], onLink?: (href: string) => void): ReactNode {
  return items.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "code":
        return <Text key={i} style={styles.code}>{n.v}</Text>;
      case "strong":
        return <Text key={i} style={styles.strong}>{inlineNodes(n.c, onLink)}</Text>;
      case "em":
        return <Text key={i} style={styles.em}>{inlineNodes(n.c, onLink)}</Text>;
      case "link":
        return (
          <Text key={i} accessibilityRole="link" onPress={() => (onLink ? onLink(n.href) : void Linking.openURL(n.href))} style={styles.link}>
            {inlineNodes(n.c, onLink)}
          </Text>
        );
    }
  });
}

/** The blinking block at the end of the open text. A fixed 7 by 16 box, so its arrival and its moves do not change the line it sits on. */
export const Caret = memo(function Caret() {
  return <View testID="stream-caret" aria-hidden style={styles.caret} />;
});

export interface BlockViewProps {
  block: Block;
  /** The caret follows the last inline of this block. Only the open block gets it. */
  caret?: boolean;
  onLink?: (href: string) => void;
}

export const BlockView = memo(function BlockView({ block, caret = false, onLink }: BlockViewProps) {
  const tail = caret ? <Caret /> : null;
  switch (block.kind) {
    case "p":
      return <Text testID={`block-${block.key}`} style={styles.p}>{inlineNodes(block.inline, onLink)}{tail}</Text>;
    case "h":
      return <Text testID={`block-${block.key}`} accessibilityRole="header" style={[styles.p, styles.h, HEADING[block.level]]}>{inlineNodes(block.inline, onLink)}{tail}</Text>;
    case "quote":
      return (
        <View testID={`block-${block.key}`} style={styles.quote}>
          <Text style={styles.quoteText}>{inlineNodes(block.inline, onLink)}{tail}</Text>
        </View>
      );
    case "hr":
      return <View testID={`block-${block.key}`} style={styles.rule} />;
    case "code":
      return (
        <View testID={`block-${block.key}`} style={styles.pre}>
          <Text style={styles.preText}>{block.text}{tail}</Text>
        </View>
      );
    case "ul":
    case "ol":
      return (
        <View testID={`block-${block.key}`} style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.item}>
              <Text style={styles.marker}>{block.kind === "ul" ? "•" : `${block.start + i}.`}</Text>
              <Text style={styles.itemText}>{inlineNodes(item, onLink)}{caret && i === block.items.length - 1 ? <Caret /> : null}</Text>
            </View>
          ))}
        </View>
      );
  }
});

export interface MarkdownBlocksProps {
  blocks: readonly Block[];
  /** Show the caret after the last block (the message is still streaming). */
  streaming?: boolean;
  onLink?: (href: string) => void;
}

/** Final blocks first (same objects every frame, so they do not re-render), then the open ones. */
export function MarkdownBlocks({ blocks, streaming = false, onLink }: MarkdownBlocksProps) {
  const last = blocks.length - 1;
  return (
    <View testID="markdown-blocks" style={styles.root}>
      {blocks.map((b, i) => (
        <BlockView key={b.key} block={b} caret={streaming && i === last} {...(onLink ? { onLink } : {})} />
      ))}
      {streaming && blocks.length === 0 ? <View style={styles.firstCaret}><Caret /></View> : null}
    </View>
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

const MONO = "var(--mono)";

const styles = StyleSheet.create({
  root: { width: "100%" },
  p: { color: "var(--ink)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE, marginBottom: BLOCK_GAP },
  h: { fontWeight: "600", marginTop: 4 },
  strong: { fontWeight: "600" },
  em: { fontStyle: "italic" },
  link: { color: "var(--accent)" as string },
  code: { fontFamily: MONO, fontSize: 13, backgroundColor: "var(--sunk)" as string },
  caret: { width: 7, height: 16, marginLeft: 2, borderRadius: 1, backgroundColor: "var(--ink)" as string },
  firstCaret: { height: BODY_LINE, justifyContent: "center", marginBottom: BLOCK_GAP },
  quote: { borderLeftWidth: 2, borderLeftColor: "var(--line-2)" as string, paddingLeft: 12, marginBottom: BLOCK_GAP },
  quoteText: { color: "var(--ink-2)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  rule: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 12 },
  pre: { backgroundColor: "var(--sunk)" as string, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: BLOCK_GAP },
  preText: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 13, lineHeight: 20 },
  list: { marginBottom: BLOCK_GAP },
  item: { flexDirection: "row", paddingLeft: 4, marginVertical: 3 },
  marker: { width: 22, color: "var(--ink-2)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
  itemText: { flex: 1, minWidth: 0, color: "var(--ink)" as string, fontSize: BODY_SIZE, lineHeight: BODY_LINE },
});
