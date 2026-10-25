// ui/Recipients: the one To / Cc / Bcc field for every email composer (spec 2.18, 3.3; prototype VyreUI.recipients).
// Address chips with a picker over records, teammates, agent inboxes, recent addresses and groups; paste splits on commas, semicolons and
// line breaks; Cc and Bcc appear on demand; a token's right-click menu moves it between rows. Reply All never includes you and never repeats an address.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Avatar } from "../Avatar/index.tsx";
import { menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Row } from "../Row/index.tsx";
import { RECIPIENT_ROWS, recipientEmail, replyAll } from "./props.ts";
import type { Recipient, RecipientInput, RecipientKind, RecipientRow, RecipientsProps, ReplySource } from "./props.ts";

export type { Recipient, RecipientInput, RecipientKind, RecipientRow, RecipientsProps, ReplySource } from "./props.ts";
export { RECIPIENT_ROWS, recipientEmail, recipientLabel, replyAll } from "./props.ts";

/* ---------- model ---------- */

export interface DirectoryEntry {
  name: string;
  email: string;
  kind: RecipientKind;
  sub?: string;
  /** Record the address belongs to; its menu offers Open record. */
  rec?: string;
}

export interface RecipientGroup {
  name: string;
  members: readonly string[];
}

/** One chip. A group chip stands for several addresses until expanded. */
export interface Token {
  name: string;
  email: string;
  kind: RecipientKind;
  sub?: string;
  rec?: string;
  /** Name of the group this address came from. */
  g?: string;
  group?: RecipientGroup;
}

export type Rows = Record<RecipientRow, Token[]>;

export const ROW_LABEL: Record<RecipientRow, string> = { to: "To", cc: "Cc", bcc: "Bcc" };
const MAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
const lc = (s: string): string => s.trim().toLowerCase();

export function isValidAddress(email: string): boolean {
  return MAIL.test(email.trim());
}

export function isBad(token: Token): boolean {
  return token.kind !== "group" && !isValidAddress(token.email);
}

export function isExternal(token: Token, internal: readonly string[]): boolean {
  if (token.kind === "group") return false;
  const domain = lc(token.email).split("@")[1];
  return domain !== undefined && domain.length > 0 && !internal.map(lc).includes(domain);
}

/** Addresses in free text: `Name <a@b.co>`, bare addresses, split on commas, semicolons, line breaks and spaces. */
export function parseAddresses(text: string): Recipient[] {
  const out: Recipient[] = [];
  const re = /(?:"?([^"<>,;\n]*?)"?\s*)?<([^>\s]+)>|([^\s,;]+)/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const email = (m[2] ?? m[3] ?? "").trim();
    const name = (m[1] ?? "").trim();
    if (email) out.push(name ? { email, name } : { email });
    m = re.exec(text);
  }
  return out;
}

/** What the field does with typed or pasted text: the finished addresses, and the partial one still being typed. */
export function splitTyped(text: string): { done: Recipient[]; rest: string } {
  if (/\s$/.test(text) && !/[,;\n]/.test(text) && isValidAddress(text)) return { done: parseAddresses(text), rest: "" };
  const delimited = /[,;\n]/.test(text);
  const pieces = delimited ? text.split(/[,;\n]+/) : text.trim().split(/\s+/);
  if (pieces.length < 2) return { done: [], rest: text };
  const tail = pieces[pieces.length - 1] ?? "";
  const keepTail = !isValidAddress(tail) && !/[<>]$/.test(tail.trim()) && (delimited ? tail.trim().length > 0 : true);
  const finished = keepTail ? pieces.slice(0, -1) : pieces;
  const done = finished.flatMap((p) => parseAddresses(p));
  if (!delimited && done.some((r) => !isValidAddress(r.email))) return { done: [], rest: text };
  return { done, rest: keepTail ? tail : "" };
}

export function toToken(value: RecipientInput, directory: readonly DirectoryEntry[]): Token {
  const email = recipientEmail(value);
  const given = typeof value === "string" ? "" : value.name ?? "";
  const known = directory.find((d) => lc(d.email) === lc(email));
  if (known) return { ...known, name: given || known.name };
  if (typeof value !== "string" && value.kind !== undefined) return { name: given, email, kind: value.kind };
  return { name: given, email, kind: "plain", sub: "Typed address" };
}

export function emptyRows(): Rows {
  return { to: [], cc: [], bcc: [] };
}

export function rowsFrom(props: Pick<RecipientsProps, "to" | "cc" | "bcc">, directory: readonly DirectoryEntry[]): Rows {
  const seen = new Set<string>();
  const out = emptyRows();
  for (const row of RECIPIENT_ROWS) {
    for (const value of props[row] ?? []) {
      const token = toToken(value, directory);
      const key = lc(token.email);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out[row].push(token);
    }
  }
  return out;
}

/** Adds a token to a row. An address already in any row moves (never twice). */
export function addToken(rows: Rows, row: RecipientRow, token: Token): Rows {
  const key = lc(token.email);
  const next = emptyRows();
  for (const r of RECIPIENT_ROWS) next[r] = rows[r].filter((t) => lc(t.email) !== key);
  next[row] = [...next[row], token];
  return next;
}

export function removeToken(rows: Rows, row: RecipientRow, index: number): Rows {
  return { ...rows, [row]: rows[row].filter((_, i) => i !== index) };
}

export function moveToken(rows: Rows, from: RecipientRow, index: number, to: RecipientRow): Rows {
  const token = rows[from][index];
  if (token === undefined || from === to) return rows;
  return addToken(removeToken(rows, from, index), to, token);
}

/** Replaces a group chip with its members, each remembering the group. */
export function expandGroup(rows: Rows, row: RecipientRow, index: number, directory: readonly DirectoryEntry[]): Rows {
  const token = rows[row][index];
  if (token?.group === undefined) return rows;
  const group = token.group;
  const members = group.members.map((m) => ({ ...toToken(m, directory), g: group.name }));
  const list = rows[row].slice();
  list.splice(index, 1, ...members);
  return { ...rows, [row]: list };
}

export function addresses(rows: Rows): Record<RecipientRow, string[]> {
  const out: Record<RecipientRow, string[]> = { to: [], cc: [], bcc: [] };
  for (const row of RECIPIENT_ROWS) {
    for (const t of rows[row]) {
      if (t.group !== undefined) out[row].push(...t.group.members);
      else out[row].push(t.email);
    }
  }
  return out;
}

export interface Suggestion {
  /** A directory entry, a group, or the typed address itself. */
  entry: DirectoryEntry | null;
  group: RecipientGroup | null;
  /** The typed address offered as "Add this address". */
  typed: string | null;
  title: string;
  note: string;
  kindLabel: string;
}

const KIND_LABEL: Record<RecipientKind, string> = { record: "Record", team: "Team", agent: "Agent", recent: "Recent", plain: "", group: "Group" };
const KIND_BONUS: Record<string, number> = { team: 6, record: 5, agent: 3, recent: 1 };
const first = (s: string): string => s.trim().split(/\s+/)[0] ?? s;

/** Picker results for a query: name start, word start, address, then anywhere; teammates and records first. Never offers an address already in a row or yours. */
export function suggest(query: string, directory: readonly DirectoryEntry[], groups: readonly RecipientGroup[], rows: Rows, me: string, recent: readonly string[] = []): Suggestion[] {
  const q = lc(query);
  if (!q) return [];
  const have = new Set(RECIPIENT_ROWS.flatMap((r) => rows[r].map((t) => lc(t.email))));
  const wordStart = (s: string): boolean => lc(s).split(/[\s.@_-]+/).some((w) => w.startsWith(q));
  const scored: { s: number; item: Suggestion }[] = [];
  const pool: DirectoryEntry[] = [...directory, ...recent.filter((e) => !directory.some((d) => lc(d.email) === lc(e))).map((email) => ({ name: "", email, kind: "recent" as const, sub: "Recent" }))];
  for (const d of pool) {
    if (have.has(lc(d.email)) || lc(d.email) === lc(me)) continue;
    const nm = lc(d.name);
    const em = lc(d.email);
    let s = 0;
    if (nm.startsWith(q)) s = 100;
    else if (wordStart(d.name)) s = 90;
    else if (em.startsWith(q)) s = 80;
    else if (wordStart(d.email)) s = 60;
    else if (nm.includes(q) || em.includes(q)) s = 40;
    if (s > 0) scored.push({ s: s + (KIND_BONUS[d.kind] ?? 0), item: { entry: d, group: null, typed: null, title: d.name || d.email, note: d.email, kindLabel: KIND_LABEL[d.kind] } });
  }
  for (const g of groups) {
    const nm = lc(g.name);
    const s = nm.startsWith(q) ? 104 : nm.includes(q) ? 45 : 0;
    if (s > 0) {
      const who = g.members.map((m) => first(directory.find((d) => lc(d.email) === lc(m))?.name ?? m)).join(", ");
      scored.push({ s, item: { entry: null, group: g, typed: null, title: g.name, note: who, kindLabel: `${g.members.length} people` } });
    }
  }
  scored.sort((a, b) => b.s - a.s || a.item.title.localeCompare(b.item.title));
  const out = scored.slice(0, 7).map((x) => x.item);
  if (isValidAddress(q) && !have.has(q) && !out.some((x) => x.entry !== null && lc(x.entry.email) === q)) {
    out.push({ entry: null, group: null, typed: q, title: q, note: "Add this address", kindLabel: "" });
  }
  return out;
}

export function suggestionToken(s: Suggestion, directory: readonly DirectoryEntry[]): Token {
  if (s.group !== null) return { name: s.group.name, email: `group:${lc(s.group.name)}`, kind: "group", sub: `${s.group.members.length} people`, group: s.group };
  if (s.entry !== null) return { ...s.entry, name: s.entry.name };
  return toToken(s.typed ?? "", directory);
}

/** "Maya and Omar", or "Maya, Omar and 3 more" when the row is collapsed. */
export function summary(tokens: readonly Token[]): string {
  const names = tokens.map((t) => t.name || t.email);
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/* ---------- component ---------- */

export interface RecipientsViewProps extends RecipientsProps {
  directory?: readonly DirectoryEntry[];
  groups?: readonly RecipientGroup[];
  /** Domains that are yours. Other addresses carry a small external dot. */
  internal?: readonly string[];
  onOpenRecord?: (token: Token) => void;
  testID?: string;
}

interface KeyLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const FIELD_STYLE = { outlineStyle: "none", outlineWidth: 0, backgroundColor: "transparent" } as unknown as TextStyle;
const POP_SHADOW = { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle;
const HOVER = { backgroundColor: "var(--hover)" };

/** A recipient's face: a marble for a person, a pixel face for an agent, the group glyph for a group (the shared Avatar). */
function TokenFace({ token, size = 18 }: { token: Token; size?: number }): ReactElement {
  return <Avatar name={token.name || token.email} kind={token.kind === "group" ? "group" : token.kind === "agent" ? "agent" : "person"} size={size} />;
}

export function Recipients(props: RecipientsViewProps): ReactElement {
  const directory = props.directory ?? [];
  const groups = props.groups ?? [];
  const internal = props.internal ?? [];
  const me = props.me ?? "";
  const [rows, setRows] = useState<Rows>(() => rowsFrom(props, directory));
  const [typed, setTyped] = useState<Record<RecipientRow, string>>({ to: "", cc: "", bcc: "" });
  const [shown, setShown] = useState<Record<RecipientRow, boolean>>({ to: true, cc: false, bcc: false });
  const [focus, setFocus] = useState<RecipientRow | null>(null);
  const [sel, setSel] = useState<{ row: RecipientRow; index: number } | null>(null);
  const [active, setActive] = useState(0);
  const recent = useRef<string[]>([]);
  const inputs = useRef<Partial<Record<RecipientRow, TextInput | null>>>({});
  const menu = useMenu();
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const commit = useCallback((next: Rows) => {
    rowsRef.current = next;
    setRows(next);
    props.onChange?.(addresses(next));
  }, [props.onChange]);

  const list = useMemo(() => (focus === null ? [] : suggest(typed[focus], directory, groups, rows, me, recent.current)), [focus, typed, rows, props.directory, props.groups, me]);
  const at = Math.min(active, Math.max(0, list.length - 1));

  const addAll = (row: RecipientRow, items: readonly Recipient[]): void => {
    let next = rowsRef.current;
    for (const r of items) {
      const token = toToken(r, directory);
      if (token.kind === "plain" && isValidAddress(token.email) && !recent.current.includes(lc(token.email))) recent.current.push(lc(token.email));
      next = addToken(next, row, token);
    }
    commit(next);
  };

  const flush = (row: RecipientRow): void => {
    const text = typed[row].trim();
    if (!text) return;
    setTyped((t) => ({ ...t, [row]: "" }));
    addAll(row, parseAddresses(text));
  };

  const pick = (row: RecipientRow, s: Suggestion | undefined): void => {
    if (s === undefined) return;
    commit(addToken(rowsRef.current, row, suggestionToken(s, directory)));
    setTyped((t) => ({ ...t, [row]: "" }));
    setSel(null);
    setActive(0);
    inputs.current[row]?.focus();
  };

  const reveal = (row: RecipientRow): void => {
    setShown((s) => ({ ...s, [row]: true }));
    setTimeout(() => inputs.current[row]?.focus(), 0);
  };

  const onChangeText = (row: RecipientRow, text: string): void => {
    const split = splitTyped(text);
    if (split.done.length > 0) {
      addAll(row, split.done);
      setTyped((t) => ({ ...t, [row]: split.rest }));
    } else {
      setTyped((t) => ({ ...t, [row]: text }));
    }
    setSel(null);
    setActive(0);
  };

  const onKeyPress = (row: RecipientRow, event: { nativeEvent: KeyLike; preventDefault?: () => void }): void => {
    const k = event.nativeEvent;
    const stop = (): void => event.preventDefault?.();
    const text = typed[row];
    const tokens = rowsRef.current[row];
    if (list.length > 0 && text.length > 0) {
      if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        stop();
        setActive((at + (k.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
        return;
      }
      if (k.key === "Enter" || k.key === "Tab") {
        stop();
        pick(row, list[at]);
        return;
      }
      if (k.key === "Escape") {
        stop();
        setTyped((t) => ({ ...t, [row]: "" }));
        return;
      }
    }
    if ((k.key === "Enter" || k.key === "Tab" || k.key === "," || k.key === ";") && text.trim().length > 0) {
      stop();
      flush(row);
      return;
    }
    if (text.length === 0) {
      if (k.key === "Backspace" || k.key === "Delete") {
        if (sel !== null && sel.row === row) {
          stop();
          commit(removeToken(rowsRef.current, row, sel.index));
          setSel(null);
        } else if (k.key === "Backspace" && tokens.length > 0) {
          stop();
          setSel({ row, index: tokens.length - 1 });
        }
        return;
      }
      if (k.key === "ArrowLeft" && tokens.length > 0) {
        stop();
        setSel({ row, index: sel !== null && sel.row === row ? Math.max(0, sel.index - 1) : tokens.length - 1 });
        return;
      }
      if (k.key === "ArrowRight" && sel !== null && sel.row === row) {
        stop();
        setSel(sel.index + 1 >= tokens.length ? null : { row, index: sel.index + 1 });
        return;
      }
    }
    if ((k.metaKey === true || k.ctrlKey === true) && k.shiftKey === true) {
      if (k.key.toLowerCase() === "c") {
        stop();
        reveal("cc");
      } else if (k.key.toLowerCase() === "b") {
        stop();
        reveal("bcc");
      }
    }
  };

  const tokenMenu = (row: RecipientRow, index: number, x: number, y: number): void => {
    const token = rowsRef.current[row][index];
    if (token === undefined) return;
    const items: MenuEntry[] = [];
    for (const other of RECIPIENT_ROWS) {
      if (other === row) continue;
      items.push({ label: `Move to ${ROW_LABEL[other]}`, icon: "open", onSelect: () => { setShown((s) => ({ ...s, [other]: true })); commit(moveToken(rowsRef.current, row, index, other)); setSel(null); } });
    }
    if (token.group !== undefined) items.push({ label: `Expand to ${token.group.members.length} people`, icon: "plus", onSelect: () => commit(expandGroup(rowsRef.current, row, index, directory)) });
    items.push({ separator: true });
    if (token.group === undefined) {
      items.push({ label: "Copy Address", icon: "copy", onSelect: () => { void (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard?.writeText(token.email); } });
      if (token.rec !== undefined) items.push({ label: "Open Record", icon: "link", onSelect: () => props.onOpenRecord?.(token) });
    }
    items.push({ label: "Remove", icon: "trash", danger: true, onSelect: () => { commit(removeToken(rowsRef.current, row, index)); setSel(null); } });
    menu.show(items, x, y, "context", { label: `${ROW_LABEL[row]} recipient` });
  };

  const visible = RECIPIENT_ROWS.filter((r) => r === "to" || shown[r] || rows[r].length > 0 || focus === r);
  const hidden = RECIPIENT_ROWS.filter((r) => r !== "to" && !visible.includes(r));

  const tokenNodes = (row: RecipientRow): ReactElement[] => {
    const out: ReactElement[] = [];
    const tokens = rows[row];
    for (const [i, t] of tokens.entries()) {
      const selected = sel !== null && sel.row === row && sel.index === i;
      const bad = isBad(t);
      const ext = isExternal(t, internal) && !bad;
      out.push(
        <Pressable
          key={`${t.email}:${i}`}
          accessibilityRole="button"
          accessibilityLabel={t.kind === "group" ? `${t.name}, ${t.group?.members.length ?? 0} people` : `${t.name || t.email}${bad ? ", not a valid address" : ""}`}
          accessibilityState={{ selected }}
          onPress={() => { setSel({ row, index: i }); inputs.current[row]?.focus(); }}
          testID={`recipient-${row}-${i}`}
          {...menuTrigger((x, y) => tokenMenu(row, i, x, y))}
          {...webProps({ title: t.kind === "group" ? `${t.name}\n${t.sub ?? ""}` : `${t.email}\n${t.sub ?? "Typed address"}`, dataSet: { bad: bad ? "true" : "false" } })}
          style={({ hovered }: { hovered?: boolean }) => [styles.token, hovered === true && TOKEN_HOVER, selected && styles.tokenSel]}
        >
          <TokenFace token={t} />
          <Text numberOfLines={1} style={[styles.tokenText, selected && styles.tokenTextSel, bad && styles.tokenBad]}>
            {t.kind === "group" ? `${t.name} \u00b7 ${t.group?.members.length ?? 0}` : t.name || t.email}
          </Text>
          {ext ? <View style={styles.ext} testID="recipient-external" /> : null}
        </Pressable>,
      );
    }
    return out;
  };

  const revealNodes = (): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const h of hidden) {
      out.push(
        <Pressable
          key={h}
          accessibilityRole="button"
          accessibilityLabel={`Add ${ROW_LABEL[h]}`}
          onPress={() => reveal(h)}
          testID={`recipients-add-${h}`}
          {...webProps({ title: `Add ${ROW_LABEL[h]}  \u21e7\u2318${h === "cc" ? "C" : "B"}` })}
          style={({ hovered }: { hovered?: boolean }) => [styles.revealButton, hovered === true && HOVER]}
        >
          <Text style={styles.revealText}>{ROW_LABEL[h]}</Text>
        </Pressable>,
      );
    }
    return out;
  };

  const rowNodes: ReactElement[] = [];
  for (const row of visible) {
    const tokens = rows[row];
    const collapsed = focus !== row && tokens.length > 3;
    const suggestionNodes: ReactElement[] = [];
    if (focus === row && typed[row].length > 0) {
      for (const [i, s] of list.entries()) {
        suggestionNodes.push(<Row key={`${s.title}:${s.note}`} id={`sug-${i}`} title={s.kindLabel ? `${s.title}  \u00b7  ${s.kindLabel}` : s.title} note={s.note} selected={i === at} onPress={() => pick(row, s)} />);
      }
    }
    rowNodes.push(
      <View key={row} style={styles.row} testID={`recipients-row-${row}`} {...webProps({ dataSet: { row } })}>
        <Text style={styles.label}>{ROW_LABEL[row]}</Text>
        <View style={styles.box}>
          {collapsed ? (
            <Pressable style={styles.summary} onPress={() => inputs.current[row]?.focus()} accessibilityLabel={`${ROW_LABEL[row]}: ${summary(tokens)}`}>
              <Text numberOfLines={1} style={styles.summaryText}>{summary(tokens)}</Text>
            </Pressable>
          ) : tokenNodes(row)}
          {!collapsed || focus === row ? (
            <TextInput
              ref={(node) => { inputs.current[row] = node; }}
              value={typed[row]}
              onChangeText={(text) => onChangeText(row, text)}
              onKeyPress={((e: { nativeEvent: KeyLike; preventDefault?: () => void }) => onKeyPress(row, e)) as never}
              onFocus={() => setFocus(row)}
              onBlur={() => { setTimeout(() => { setFocus((f) => (f === row ? null : f)); }, 120); flush(row); }}
              placeholder={tokens.length === 0 && row === "to" ? "Add people, groups or addresses" : ""}
              placeholderTextColor="var(--ink-4)"
              accessibilityLabel={`${ROW_LABEL[row]} recipients`}
              autoCapitalize="none"
              autoCorrect={false}
              testID={`recipients-input-${row}`}
              style={[styles.input, FIELD_STYLE]}
            />
          ) : null}
        </View>
        {row === "to" && hidden.length > 0 ? <View style={styles.reveal}>{revealNodes()}</View> : null}
        {suggestionNodes.length > 0 ? (
          <View style={[styles.pop, POP_SHADOW]} testID="recipients-popup" {...webProps({ role: "listbox", onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() })}>
            {suggestionNodes}
          </View>
        ) : null}
      </View>,
    );
  }

  return (
    <View style={styles.root} testID={props.testID ?? "recipients"} accessibilityLabel="Recipients">
      {rowNodes}
      {menu.element}
    </View>
  );
}

const TOKEN_HOVER = { backgroundColor: "var(--press)" };

const styles = StyleSheet.create({
  root: { width: "100%", position: "relative" },
  row: { position: "relative", flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 2, paddingHorizontal: 4, minHeight: 30, borderRadius: 8 },
  label: { width: 24, paddingTop: 5, color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 20 },
  box: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 3, paddingVertical: 2 },
  token: { flexDirection: "row", alignItems: "center", gap: 5, height: 24, paddingLeft: 3, paddingRight: 9, borderRadius: 12, backgroundColor: "var(--hover)" as string, maxWidth: "100%" },
  tokenSel: { backgroundColor: "var(--accent)" as string },
  tokenText: { color: "var(--ink-2)" as string, fontSize: 13, lineHeight: 18, maxWidth: 220, flexShrink: 1 },
  tokenTextSel: { color: "var(--accent-ink)" as string },
  tokenBad: { color: "var(--danger)" as string, textDecorationLine: "underline" },
  ext: { width: 4, height: 4, borderRadius: 2, backgroundColor: "var(--ink-4)" as string },
  input: { flexGrow: 1, flexShrink: 1, flexBasis: 90, minWidth: 90, height: 24, padding: 0, margin: 0, borderWidth: 0, color: "var(--ink)" as string, fontSize: 13 },
  summary: { flex: 1, height: 24, justifyContent: "center" },
  summaryText: { color: "var(--ink-2)" as string, fontSize: 13 },
  reveal: { flexDirection: "row", paddingTop: 3 },
  revealButton: { height: 22, paddingHorizontal: 7, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  revealText: { color: "var(--ink-3)" as string, fontSize: 12.5 },
  pop: { position: "absolute", left: 28, top: "100%", marginTop: 4, width: 380, maxWidth: "92%", borderRadius: 12, backgroundColor: "var(--raised)" as string, padding: 5, zIndex: 60 },
});

/** Reply All for a message: To gets the sender and the other To, Cc stays Cc, never you, never twice. */
export function replyAllRows(message: ReplySource, me: string): Pick<RecipientsProps, "to" | "cc"> {
  const r = replyAll(message, me);
  return { to: r.to, cc: r.cc };
}

