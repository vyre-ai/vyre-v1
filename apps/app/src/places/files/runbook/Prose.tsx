// The words around a runbook's code blocks: headings, paragraphs, bullet lists, `code` and **bold**. The Files viewer draws a note's full markdown; this draws what a runbook
// needs between its blocks, in the same type (14.5 px on 22, 20 px title, 16 px section heads) so the two read as one page.
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";

export type Piece = { kind: "text" | "code" | "bold"; text: string };

/** Inline spans of one line of markdown: `code` and **bold** pieces, the rest as text. */
export function inline(line: string): Piece[] {
  const out: Piece[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] }); else out.push({ kind: "bold", text: m[2] ?? "" });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ kind: "text", text: line.slice(last) });
  return out;
}

export type Block = { kind: "h1" | "h2" | "h3" | "p"; text: string } | { kind: "ul"; items: string[] };

/** Blocks of a markdown chunk: a heading line, a paragraph (lines joined), a bullet list. */
export function blocks(md: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = (): void => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    if (list) out.push({ kind: "ul", items: list });
    para = [];
    list = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: (`h${h[1]?.length ?? 1}`) as "h1" | "h2" | "h3", text: h[2] ?? "" }); }
    else if (li) { if (para.length) { out.push({ kind: "p", text: para.join(" ") }); para = []; } (list ??= []).push(li[1] ?? ""); }
    else if (line.trim() === "") flush();
    else { if (list) { out.push({ kind: "ul", items: list }); list = null; } para.push(line.trim()); }
  }
  flush();
  return out;
}

function Spans({ text, style }: { text: string; style?: TextStyle }): ReactElement {
  const parts: ReactNode[] = [];
  const pieces = inline(text);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i] as Piece;
    if (p.kind === "code") parts.push(<Text key={i} style={s.code}>{p.text}</Text>);
    else if (p.kind === "bold") parts.push(<Text key={i} style={s.bold}>{p.text}</Text>);
    else parts.push(p.text);
  }
  return <Text style={[s.p, style]}>{parts}</Text>;
}

export function Prose({ text }: { text: string }): ReactElement {
  const out: ReactElement[] = [];
  const all = blocks(text);
  for (let i = 0; i < all.length; i++) {
    const b = all[i] as Block;
    if (b.kind === "ul") {
      const items: ReactElement[] = [];
      for (let j = 0; j < b.items.length; j++) {
        items.push(<View key={j} style={s.li} accessibilityRole="listitem"><Text style={s.dot}>{"\u2022"}</Text><View style={s.liText}><Spans text={b.items[j] as string} /></View></View>);
      }
      out.push(<View key={i} style={s.ul} accessibilityRole="list">{items}</View>);
    } else if (b.kind === "p") {
      out.push(<Spans key={i} text={b.text} style={s.para} />);
    } else {
      const style = b.kind === "h1" ? s.h1 : b.kind === "h2" ? s.h2 : s.h3;
      out.push(<Text key={i} accessibilityRole="header" aria-level={Number(b.kind.slice(1))} style={style}>{b.text}</Text>);
    }
  }
  return <View>{out}</View>;
}

const s = StyleSheet.create({
  h1: { fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string, marginTop: 4, marginBottom: 10 },
  h2: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: "var(--ink)" as string, marginTop: 20, marginBottom: 4 },
  h3: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "var(--ink)" as string, marginTop: 14, marginBottom: 2 },
  p: { fontSize: 14.5, lineHeight: 22, color: "var(--ink)" as string },
  para: { marginVertical: 5 },
  bold: { fontWeight: "600" },
  code: { fontFamily: "var(--mono)" as string, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--hover)" as string },
  ul: { marginVertical: 5, gap: 2 },
  li: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  dot: { fontSize: 14.5, lineHeight: 22, color: "var(--ink-3)" as string },
  liText: { flex: 1, minWidth: 0 },
});
