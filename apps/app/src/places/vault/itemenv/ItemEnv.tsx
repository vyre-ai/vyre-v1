// Vault ItemEnv: one item as a .env block (spec 3.8, 2.17). Names and metadata only until a person reveals: the card shows KEY=•••••••• for every field, and a reveal or a copy is
// one logged vault.item.reveal call. Fields / .env switch, hover tools on every line, rotation line, recent use, and Move to Trash confirmed in place with Undo.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { copyText, useOnline, usePrincipals, useScreenQuery, useVaultData } from "../layout/data.tsx";
import { accessLine, agoLabel, KIND_LABEL, rotation } from "../layout/model.ts";
import type { Folder, Item } from "../layout/model.ts";
import { Btn, Glyph, IconBtn, LogoTile, Mono } from "../layout/parts.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { MASK, keysOf } from "./env.ts";
import { createRevealStore } from "./reveal.ts";
import type { RevealStore } from "./reveal.ts";

type GetOut = CapMap["vault.item.get"]["out"];
type HistoryOut = CapMap["vault.item.history"]["out"];
type Entry = HistoryOut["entries"][number];

export const ITEM_SCREEN = "vault.item";
export const LAYOUT_SCREEN = "vault.layout";

const VERB: Record<Entry["action"], string> = {
  created: "created it", used: "used", revealed: "revealed", edited: "edited", moved: "moved it", rotated: "rotated it", shared: "shared it", unshared: "stopped sharing it",
  exported: "exported it", deleted: "moved it to Trash", restored: "brought it back",
};

const SEP: MenuEntry = { separator: true };

export interface ItemEnvProps {
  itemId: string;
  onEdit: () => void;
  /** After the item went to Trash (the list picks the next row). */
  onGone: () => void;
  /** The quiet line for a change, with its Undo. */
  onNote: (text: string, undo: () => Promise<void> | void) => void;
  /** A narrow window shows a back arrow in the header. */
  onBack?: (() => void) | undefined;
  /** Bumps when the Delete key is pressed in the list: asks to move this item to Trash. */
  askDelete?: number | undefined;
  /** The view the card opens in; by default .env for keys and Fields for logins and cards. The parent keys this component by item, so a new item starts fresh. */
  initialMode?: "env" | "fields" | undefined;
}

/** One reveal store per open item; it is dropped when the item closes or changes. */
export function useRevealStore(itemId: string): RevealStore {
  const data = useVaultData();
  const store = useMemo(() => createRevealStore({ itemId, call: data.call, copy: (t) => copyText(data, t) }), [itemId, data]);
  useEffect(() => () => store.dispose(), [store]);
  return store;
}

export function ItemEnv({ itemId, onEdit, onGone, onNote, onBack, askDelete, initialMode }: ItemEnvProps): ReactElement {
  const data = useVaultData();
  const online = useOnline();
  const names = usePrincipals();
  const got = useScreenQuery<GetOut>(ITEM_SCREEN, "item", { itemId });
  const hist = useScreenQuery<HistoryOut>(ITEM_SCREEN, "history", { itemId });
  const folders = useScreenQuery<CapMap["vault.folders.list"]["out"]>(LAYOUT_SCREEN, "folders", {});
  const store = useRevealStore(itemId);
  const rv = useSyncExternalStore(store.subscribe, store.get, store.get);
  const menu = useMenu();
  const [mode, setMode] = useState<"env" | "fields" | null>(initialMode ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { if (askDelete) setConfirmDelete(true); }, [askDelete]);

  if (got.status !== "ready") return <DetailSkeleton />;
  const item = got.data.item;
  const fields = got.data.fields;
  const folder: Folder | undefined = folders.status === "ready" ? folders.data.folders.find((f) => f.id === item.folderId) : undefined;
  const view = mode ?? (item.kind === "login" || item.kind === "card" ? "fields" : "env");
  const clock = data.clock();
  const rot = rotation(item as Item, clock);
  const canEdit = item.yourLevel === "edit" || item.yourLevel === "manage";
  const canSee = item.yourLevel !== "use";
  const entries = hist.status === "ready" ? hist.data.entries : [];
  const shownEntries = showAll ? entries : entries.slice(0, 5);

  const fail = (e: unknown): void => setFailure(e instanceof Error ? e.message : "That did not work. Try again.");
  const trash = async (): Promise<void> => {
    try {
      await data.call("vault.item.delete", { itemId });
      setConfirmDelete(false);
      onNote(`Moved ${item.name} to Trash`, async () => { await data.call("vault.item.restore", { itemId }); });
      onGone();
    } catch (e) { fail(e); }
  };
  const rotate = async (): Promise<void> => {
    try { await data.call("vault.item.mark_rotated", { itemId }); onNote(`Marked ${item.name} rotated`, () => undefined); } catch (e) { fail(e); }
  };
  const lockSpace = async (): Promise<void> => {
    const to = !item.spaceOnly;
    try {
      await data.call("vault.item.update", { itemId, spaceOnly: to });
      onNote(to ? `${item.name} now fills on the Space only` : `${item.name} can fill on your computer again`, async () => { await data.call("vault.item.update", { itemId, spaceOnly: !to }); });
    } catch (e) { fail(e); }
  };

  const moreItems: MenuEntry[] = [
    ...(canEdit ? [{ label: "Edit…", onSelect: onEdit }] : []),
    { label: "Copy handle", onSelect: () => { void copyText(data, item.handle); } },
    ...(item.yourLevel === "manage" ? [{ label: "Share…", onSelect: () => data.nav.openShare(itemId) }] : []),
    SEP,
    ...(canEdit ? [{ label: "Mark as rotated", onSelect: () => { void rotate(); } }, { label: "Fill on the Space only", checked: item.spaceOnly, onSelect: () => { void lockSpace(); } }] : []),
    ...(item.yourLevel === "manage" && item.scope === "shared" ? [{ label: "Export .env…", onSelect: () => data.nav.openExport(item.folderId) }] : []),
    ...(item.yourLevel === "manage" ? [SEP, { label: "Move to Trash", danger: true, onSelect: () => setConfirmDelete(true) }] : []),
  ];

  const fieldLines: ReactElement[] = [];
  for (const f of fields) {
    fieldLines.push(
              <FieldLine key={f.key} view={view} fieldKey={f.key} secret={f.secret} hasValue={f.hasValue} value={rv.shown.get(f.key)} canSee={canSee} online={online} busy={rv.busy}
                onReveal={() => { void store.reveal([f.key]); }} onHide={() => store.hide([f.key])} onCopy={() => { void store.copy(f.key); }} />
    );
  }
  const historyLines: ReactElement[] = [];
  for (let i = 0; i < shownEntries.length; i++) {
    const e = shownEntries[i]!;
    historyLines.push(
                <View key={`${e.at}-${i}`} style={s.hist}>
                  <Text style={s.histText} numberOfLines={1}>{`${names.name(e.onBehalfOf ? e.onBehalfOf.id : e.actor.id)} ${VERB[e.action]}${e.field ? ` ${e.field}` : ""}${e.onBehalfOf ? ` (through ${names.name(e.actor.id)})` : ""}`}</Text>
                  <Text style={s.histWhen}>{agoLabel(e.at, clock)}</Text>
                </View>
    );
  }

  return (
    <View style={s.pane} testID="item-env" accessibilityLabel={item.name} {...menuTrigger((x, y) => menu.show(moreItems, x, y))}>
      {menu.element}
      <View style={s.bar}>
        {onBack ? <IconBtn icon="back" label="Back to the list" onPress={onBack} testID="item-back" /> : null}
        <View style={{ flex: 1 }} />
        {canEdit ? <Btn label="Edit" icon="edit" onPress={onEdit} testID="item-edit" /> : null}
        <IconBtn icon="more" label="More" testID="item-more" onPress={(e) => { const r = rectOf(e); menu.show(moreItems, r.x, r.y); }} />
      </View>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.col}>
          <View style={s.head}>
            <LogoTile name={item.name} size={64} />
            <View style={s.headText}>
              <Text accessibilityRole="header" aria-level={1} style={s.h1} numberOfLines={2}>{item.name}</Text>
              <View style={s.chips}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Copy handle ${item.handle}`} onPress={() => { void copyText(data, item.handle); }} style={s.handle} testID="item-handle">
                  <Mono size={12}>{item.handle}</Mono>
                </Pressable>
                <Text style={s.kind}>{KIND_LABEL[item.kind]}</Text>
              </View>
            </View>
          </View>
          <Text style={s.access} testID="item-access">{accessLine(item as Item, folder)}</Text>

          <View style={s.card} testID="env-card">
            <View style={s.cardTop}>
              <View style={s.seg} accessibilityRole="tablist">
                <SegBtn label="Fields" on={view === "fields"} onPress={() => setMode("fields")} testID="env-mode-fields" />
                <SegBtn label=".env" on={view === "env"} onPress={() => setMode("env")} testID="env-mode-env" />
              </View>
              <View style={{ flex: 1 }} />
              {fields.length > 0 && canSee ? (
                <Btn label={rv.shown.size > 0 ? "Hide values" : "Reveal all"} icon={rv.shown.size > 0 ? "eyeOff" : "eye"} disabled={!online || rv.busy} testID="env-reveal-all"
                  onPress={() => { if (rv.shown.size > 0) store.hide(); else void store.reveal(keysOf(fields)); }} />
              ) : null}
            </View>
            {view === "env" ? <Text style={s.comment} testID="env-comment">{`# ${item.name} · agents ask for ${item.handle}`}</Text> : null}
            {fields.length === 0 ? <Text style={s.empty} testID="env-empty">No fields yet. Edit the item to add one.</Text> : null}
            {fieldLines}
            {rv.asking ? (
              <View style={s.agree} testID="env-agree" accessibilityRole="alert">
                <Glyph name="eye" size={15} />
                <Text style={s.agreeText}>{rv.asking.then === "copy" ? "Copy this value?" : "Show this value?"} It is logged under your name, and it hides again after a minute.</Text>
                <Btn label={rv.asking.then === "copy" ? "Reveal and copy" : "Reveal"} primary onPress={() => { void store.agree(); }} testID="env-agree-yes" />
                <Btn label="Not now" onPress={store.decline} testID="env-agree-no" />
              </View>
            ) : null}
            {!online ? <Text style={s.note} testID="env-offline">Revealing needs a connection. Names stay available offline.</Text> : null}
            {rv.error ? <Text style={s.error} accessibilityRole="alert" testID="env-error">{rv.error}</Text> : null}
          </View>

          {rot ? (
            <View style={s.row} testID="item-rotation">
              <Glyph name="clock" size={14} color={rot.due ? "var(--warn)" : "var(--ink-3)"} />
              <Text style={[s.rowText, rot.due && { color: "var(--warn)" as string }]}>{`Rotated ${rot.days} days ago · every ${rot.every} days${rot.due ? " · due" : ""}`}</Text>
              {canEdit ? <Btn label="Rotated now" onPress={() => { void rotate(); }} testID="item-rotate" /> : null}
            </View>
          ) : null}

          {confirmDelete ? (
            <View style={s.confirm} testID="item-confirm-delete" accessibilityRole="alert">
              <Text style={s.confirmText}>{`Move ${item.name} to Trash? Agents and Automations that ask for ${item.handle} lose it until you bring it back.`}</Text>
              <Btn label="Move to Trash" danger onPress={() => { void trash(); }} testID="item-delete-yes" />
              <Btn label="Cancel" onPress={() => setConfirmDelete(false)} testID="item-delete-no" />
            </View>
          ) : null}
          {failure ? <Text style={s.error} accessibilityRole="alert" testID="item-error">{failure}</Text> : null}

          <View style={s.sectionHead}><Text style={s.h2}>Recent use</Text></View>
          {hist.status !== "ready" ? <Text style={s.note}>Loading</Text> : entries.length === 0 ? <Text style={s.note} testID="history-empty">Nothing has used this item yet.</Text> : (
            <View testID="item-history">
              {historyLines}
              {!showAll && entries.length > 5 ? <Btn label={`Show all ${entries.length}`} onPress={() => setShowAll(true)} testID="history-all" /> : null}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

function SegBtn({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID: string }): ReactElement {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={onPress} testID={testID} style={[s.segBtn, on && s.segOn]}>
      <Text style={[s.segText, on && { color: "var(--ink)" as string }]}>{label}</Text>
    </Pressable>
  );
}

interface FieldLineProps {
  view: "env" | "fields"; fieldKey: string; secret: boolean; hasValue: boolean; value: string | undefined; canSee: boolean; online: boolean; busy: boolean;
  onReveal: () => void; onHide: () => void; onCopy: () => void;
}

/** One field. Hover, focus or a revealed value shows the tools; on a phone they always show. */
function FieldLine({ view, fieldKey, secret, hasValue, value, canSee, online, busy, onReveal, onHide, onCopy }: FieldLineProps): ReactElement {
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState(false);
  const shown = value !== undefined;
  const tools = canSee && (over || focus || shown);
  const text = shown ? value : hasValue ? MASK : "";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${fieldKey}${shown ? "" : ", hidden"}`} testID={`env-line-${fieldKey}`}
      onPress={canSee ? onCopy : undefined} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={[s.line, over && { backgroundColor: "var(--hover)" as string }]}
    >
      {view === "env" ? (
        <View style={s.lineMain}>
          <Mono size={13}>{fieldKey}</Mono>
          <Text style={s.eq}>=</Text>
          <Text numberOfLines={1} style={[s.val, !shown && { color: "var(--ink-3)" as string, letterSpacing: 1 }]} testID={`env-value-${fieldKey}`}>{text}</Text>
        </View>
      ) : (
        <View style={s.lineMain}>
          <View style={{ width: 190 }}>
            <Mono size={12.5}>{fieldKey}</Mono>
            <View style={s.badge}><Glyph name={secret ? "lock" : "eye"} size={11} /><Text style={s.badgeText}>{secret ? "Secret" : "Plain"}</Text></View>
          </View>
          <Text numberOfLines={1} style={[s.val, !shown && { color: "var(--ink-3)" as string, letterSpacing: 1 }]} testID={`env-value-${fieldKey}`}>{text}</Text>
        </View>
      )}
      <View style={[s.tools, { opacity: tools ? 1 : 0, pointerEvents: tools ? "auto" : "none" }]}>
        <IconBtn icon={shown ? "eyeOff" : "eye"} label={shown ? `Hide ${fieldKey}` : `Reveal ${fieldKey}`} testID={`env-reveal-${fieldKey}`} onPress={shown ? onHide : onReveal} color={!online || busy ? "var(--ink-4)" : "var(--ink-3)"} />
        <IconBtn icon="copy" label={`Copy ${fieldKey}`} testID={`env-copy-${fieldKey}`} onPress={onCopy} />
      </View>
    </Pressable>
  );
}

/** The pane before data arrives: the same header and card size, so nothing moves when it lands. */
export function DetailSkeleton(): ReactElement {
  return (
    <View style={s.pane} testID="item-loading" accessibilityLabel="Loading">
      <View style={s.bar} />
      <View style={s.col}>
        <View style={s.head}><View style={[s.sk, { width: 64, height: 64, borderRadius: 18 }]} /><View style={{ gap: 10, flex: 1 }}><View style={[s.sk, { width: "50%", height: 22 }]} /><View style={[s.sk, { width: "30%", height: 14 }]} /></View></View>
        <View style={[s.card, { minHeight: 150 }]} />
      </View>
    </View>
  );
}

/** Nothing selected: one calm line. */
export function NoItem({ text = "Select an item to see its fields" }: { text?: string }): ReactElement {
  return <View style={[s.pane, { alignItems: "center", justifyContent: "center" }]} testID="item-none"><Text style={s.note}>{text}</Text></View>;
}

const s = StyleSheet.create({
  pane: { flex: 1, backgroundColor: "var(--win)" as string },
  bar: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14 },
  scroll: { flexGrow: 1 },
  col: { width: "100%", maxWidth: 560, alignSelf: "center", paddingHorizontal: 24, paddingBottom: 48 },
  head: { flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 8, marginBottom: 14 },
  headText: { flex: 1, minWidth: 0 },
  h1: { margin: 0, fontSize: 26, lineHeight: 32, fontWeight: "500", letterSpacing: -0.4, color: "var(--ink)" as string },
  chips: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  handle: { paddingHorizontal: 8, height: 22, borderRadius: 6, justifyContent: "center", backgroundColor: "var(--sel)" as string },
  kind: { fontSize: 12.5, color: "var(--ink-3)" as string },
  access: { fontSize: 14, lineHeight: 21, color: "var(--ink-2)" as string, marginBottom: 20 },
  card: { borderRadius: 14, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 18 },
  cardTop: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  seg: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sel)" as string },
  segBtn: { height: 24, paddingHorizontal: 11, borderRadius: 6, justifyContent: "center" },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-1)" as string },
  segText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  comment: { fontFamily: "var(--mono)" as string, fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 8 },
  empty: { fontSize: 13, color: "var(--ink-3)" as string, padding: 10 },
  line: { minHeight: 34, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  lineMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  eq: { color: "var(--ink-3)" as string, fontFamily: "var(--mono)" as string, fontSize: 13 },
  val: { flex: 1, minWidth: 0, fontFamily: "var(--mono)" as string, fontSize: 13, color: "var(--ink)" as string },
  tools: { flexDirection: "row", gap: 2, marginLeft: 8 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  badgeText: { fontSize: 11.5, color: "var(--ink-3)" as string },
  agree: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: "var(--accent-wash)" as string },
  agreeText: { flex: 1, minWidth: 180, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 8, paddingVertical: 6 },
  error: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 8, paddingVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14, paddingHorizontal: 4 },
  rowText: { flex: 1, fontSize: 13, color: "var(--ink-3)" as string },
  confirm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, marginBottom: 14, backgroundColor: "var(--sel)" as string },
  confirmText: { flex: 1, minWidth: 200, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  sectionHead: { flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 6 },
  h2: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  hist: { flexDirection: "row", alignItems: "center", height: 30, paddingHorizontal: 4, gap: 10 },
  histText: { flex: 1, fontSize: 13, color: "var(--ink-2)" as string },
  histWhen: { fontSize: 12, color: "var(--ink-3)" as string },
  sk: { borderRadius: 8, backgroundColor: "var(--sel)" as string },
});
