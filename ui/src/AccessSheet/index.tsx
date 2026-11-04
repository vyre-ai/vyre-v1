// ui/AccessSheet: the one "Add people and agents" and "Share" sheet. Every place that adds someone to a chat, channel, thread or project, and every place that shares an item, opens this sheet.
// It holds no data and makes no call: the host passes the directory and the item, and takes the picks back (onAdd, onShare, onUnshare, onPoke). The capability inputs are built in model.ts.
// Desktop: a centred card. Under 640 px: a bottom sheet, role controls wrap under the name, and the main button is short ("Add 3").
// Escape leaves the settings popover, then a sub-view, then the sheet. Enter in the search adds the top match; Backspace on an empty search removes the last chip.
// Colours are skin tokens (CSS variables on web), so paper and graphite both work.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { Overlay } from "../Overlay/index.tsx";
import {
  NO_MATCH,
  NO_OUTSIDE,
  OUTSIDE_NOTE,
  accessCount,
  EVERYONE_IDS,
  levelDefs,
  accessView,
  redundantVia,
  accessSubtitle,
  actionLabel,
  addLines,
  firstName,
  idleLine,
  isAgentKind,
  isPhoneWidth,
  isViewOnly,
  noMatch,
  outsideSub,
  pickFromEmail,
  pickFromEntry,
  pickFromNew,
  roleLabel,
  roleName,
  roleOptions,
  sections,
  settingsSummary,
  shareCalls,
  shareLines,
  showsEarlier,
  takenFromRows,
  targetNoun,
  targetOwn,
  topMatch,
  entryKey,
} from "./model.ts";
import type { NewAgentDraft, RoleContext } from "./model.ts";
import {
  AccessList,
  AssistantNotice,
  ExportMore,
  Face,
  Icon,
  IconButton,
  LinkView,
  NewAgentView,
  Notes,
  Picker,
  PokeButton,
  Pill,
  each,
  SettingsPopover,
  Switch,
  ViewHead,
  itemLabelOf,
  pickHowLabel,
  st,
  t,
  useCopied,
  webProps,
} from "./parts.tsx";
import { DEFAULT_AGENT_SETTINGS } from "./props.ts";
import type { AccessEntry, AccessPick, AccessSheetProps, AgentSettings, ShareSheetProps } from "./props.ts";

export type {
  AccessDirectory,
  AccessEntry,
  AccessPick,
  AccessSheetProps,
  AddSheetProps,
  AddTarget,
  AddTargetKind,
  AgentHow,
  AgentSettings,
  AgentStyle,
  AgentWhen,
  Audience,
  Density,
  EntryKind,
  Exporters,
  LinkInfo,
  PickKind,
  RecordsMode,
  RowFlag,
  ShareInput,
  ShareOpts,
  ShareItemType,
  ShareLevel,
  ShareResourceType,
  ShareRow,
  ShareSheetProps,
  ShareSubjectKind,
  ShareVia,
  UnshareInput,
} from "./props.ts";
export { DEFAULT_AGENT_SETTINGS, frozenAddSheetProps, frozenShareSheetProps } from "./props.ts";
export * from "./model.ts";
export { Face as AccessFace, Icon as AccessIcon, IconButton as AccessIconButton, PokeButton as AccessPokeButton, SettingsPopover as AgentSettingsPopover, SheetShell as AccessSheetShell, ViewHead as AccessViewHead } from "./parts.tsx";

const DEFAULT_MODELS = ["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "GPT-5 Codex"] as const;

type Pop = { src: "pick"; key: string; x: number; y: number } | { src: "here"; id: string; x: number; y: number };

interface KeyLike { nativeEvent?: { key?: string }; key?: string; preventDefault?: () => void; stopPropagation?: () => void }
const keyOf = (e: KeyLike): string => e.nativeEvent?.key ?? e.key ?? "";

export function AccessSheet(props: AccessSheetProps): ReactElement {
  const add = props.mode === "add" ? props : null;
  const share: ShareSheetProps | null = props.mode === "share" ? props : null;
  const win = useWindowDimensions();
  const phone = isPhoneWidth(win.width);
  const compactLabel = props.density === "compact" || phone;
  const menu = useMenu();

  const [view, setView] = useState<"main" | "new" | "link">("main");
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<AccessPick[]>([]);
  const [earlier, setEarlier] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [draft, setDraft] = useState<NewAgentDraft>({ name: "", brief: "", model: (props.models ?? DEFAULT_MODELS)[1] ?? (props.models ?? DEFAULT_MODELS)[0] ?? "Sonnet 5.5" });
  const [made, setMade] = useState(0);
  const [cleared, setCleared] = useState<string[]>([]);
  const [hereSettings, setHereSettings] = useState<Record<string, AgentSettings>>({ ...(props.agentSettings ?? {}) });
  const [copied, markCopied] = useCopied();
  const searchRef = useRef<{ focus?: () => void } | null>(null);

  const models = props.models ?? DEFAULT_MODELS;
  const type = share?.itemType;
  const giving = { maxLevel: props.maxLevel, canGive: props.canGive };
  const generalLevel = share ? accessView({ shares: share.shares.filter((r) => !cleared.includes(`${r.subjectKind}:${r.subjectId}`)), itemType: share.itemType, resourceId: share.resourceId, ownerId: share.ownerId, ownerName: share.ownerName, folderName: share.folderName, agentsOn: share.agentsOn }).general.level : null;
  const ctx: RoleContext = { mode: props.mode, itemType: type, offered: share?.levels, giving, general: generalLevel };
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const spaceName = share?.spaceName ?? "the Space";
  const viewOnly = add !== null && isViewOnly(giving);
  const assistantItem = share !== null && share.itemKind === "assistant";

  const taken = useMemo(() => {
    const s = share ? takenFromRows(props.directory, share.shares.filter((r) => !cleared.includes(`${r.subjectKind}:${r.subjectId}`))) : new Set<string>((props.here ?? []).map((e) => entryKey(e.kind, e.id)));
    for (const p of picks) s.add(p.key);
    if (share) {
      // already shown above: the owner and the viewer are in People, Everyone is the General access row
      if (share.ownerId) s.add(entryKey("person", share.ownerId));
      if (share.meId) s.add(entryKey("person", share.meId));
      for (const id of EVERYONE_IDS) s.add(entryKey("group", id));
    }
    return s;
  }, [props.directory, props.here, share, picks, cleared]);
  const secs = sections({ directory: props.directory, query: q, mode: props.mode, itemType: type, taken });

  // the search keeps the focus after a pick, and gets it back when a sub-view closes
  useEffect(() => {
    if (view === "main" && !assistantItem) searchRef.current?.focus?.();
  }, [picks.length, view, assistantItem]);

  // Escape: the popover first, then a sub-view, then the sheet. The latest state is read through a ref so one listener serves every render.
  const escape = useRef<() => void>(() => undefined);
  escape.current = () => {
    if (pop !== null) setPop(null);
    else if (view !== "main") setView("main");
    else props.onClose();
  };
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(n: string, f: (e: { key: string; stopPropagation(): void }) => void): void; removeEventListener(n: string, f: (e: { key: string; stopPropagation(): void }) => void): void } }).document;
    if (!doc) return undefined;
    const key = (e: { key: string; stopPropagation(): void }): void => { if (e.key === "Escape") { e.stopPropagation(); escape.current(); } };
    doc.addEventListener("keydown", key);
    return () => doc.removeEventListener("keydown", key);
  }, []);

  /* ---------- picking ---------- */

  const addPick = (p: AccessPick): void => setPicks((all) => (all.some((x) => x.key === p.key) ? all : [...all, p]));
  const pickEntry = (e: AccessEntry): void => { addPick(pickFromEntry(e, ctx)); setQ(""); };
  const pickInvite = (email: string): void => { addPick(pickFromEmail(email, ctx)); setQ(""); };
  const unpick = (key: string): void => { setPicks((all) => all.filter((p) => p.key !== key)); setPop((o) => (o !== null && o.src === "pick" && o.key === key ? null : o)); };
  const patchPick = (key: string, patch: Partial<AccessPick>): void => setPicks((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const confirm = (): void => {
    if (picks.length === 0) return;
    if (add) add.onAdd(picks, { earlier });
    else if (share) {
      // a person who already holds this level or more through Everyone gains nothing from their own grant: refused, with the reason
      const same = picks.find((p) => p.kind === "person" && share.itemType !== undefined && redundantVia(share.itemType, generalLevel, p.role as ShareLevel, spaceName) !== null);
      if (same !== undefined) { setRefusal(`${same.name}: ${redundantVia(share.itemType, generalLevel, same.role as ShareLevel, spaceName)}. Pick a higher level, or remove them.`); return; }
      const opts: ShareOpts = { notify: share.notifyPeople === true && notify, ...(message.trim() !== "" ? { message: message.trim() } : {}) };
      for (const input of shareCalls(share, picks, share.newKey)) share.onShare?.(input, opts);
      for (const g of picks.filter((p) => p.kind === "guest")) if (g.email !== undefined) share.onInviteGuest?.({ email: g.email, level: g.role as "view" });
    }
    props.onClose();
  };

  const onSearchKey = (e: KeyLike): void => {
    const k = keyOf(e);
    if (k === "Enter") {
      e.preventDefault?.();
      const top = topMatch(secs);
      // a second Enter on an empty search adds the picks
      if (picks.length > 0 && q.trim() === "") confirm();
      else if (top === null) return;
      else if ("invite" in top) pickInvite(top.invite);
      else pickEntry(top.entry);
    } else if (k === "Backspace" && q === "" && picks.length > 0) {
      setPicks((all) => all.slice(0, -1));
    }
  };

  /* ---------- menus and the popover ---------- */

  const roleMenu = (p: AccessPick, x: number, y: number): void => {
    const items: MenuEntry[] = roleOptions(p.kind, ctx).map((o) => ({ label: roleLabel(o), checked: o.id === p.role, disabled: o.locked, reason: "A person can give only what they have", ...(o.locked ? {} : { onSelect: () => patchPick(p.key, { role: o.id }) }) }));
    menu.show(items, x, y, "context", { label: `Role for ${p.name}` });
  };
  const modelMenu = (x: number, y: number): void => {
    menu.show(models.map((m) => ({ label: m, checked: m === draft.model, onSelect: () => setDraft((d) => ({ ...d, model: m })) })), x, y, "context", { label: "Model" });
  };
  const openPop = (next: Pop): void => setPop(next);

  const popView = ((): ReactElement | null => {
    if (pop === null) return null;
    if (pop.src === "pick") {
      const p = picks.find((x) => x.key === pop.key);
      if (!p) return null;
      return (
        <SettingsPopover
          name={p.name} face={<Face kind={p.kind} id={p.id} name={p.name} assistant={p.assistant} size={26} />} value={p.settings ?? DEFAULT_AGENT_SETTINGS} outside={p.kind === "outside"} anchor={pop}
          onChange={(settings) => patchPick(p.key, { settings })} onClose={() => setPop(null)}
        />
      );
    }
    const e = (props.here ?? []).find((x) => x.id === pop.id);
    if (!e) return null;
    return (
      <SettingsPopover
        name={e.name} face={<Face kind={e.kind} id={e.id} name={e.name} assistant={e.assistant} size={26} />} value={hereSettings[e.id] ?? DEFAULT_AGENT_SETTINGS} outside={e.kind === "outside"} anchor={pop}
        onChange={(next) => { setHereSettings((all) => ({ ...all, [e.id]: next })); props.onAgentSettings?.(e.id, next); }} {...(props.onPoke ? { onPoke: () => props.onPoke?.(e.id) } : {})} onClose={() => setPop(null)}
      />
    );
  })();

  /* ---------- rows ---------- */

  const verb = add ? "Add" : "Share with";
  const entryRow = (e: AccessEntry): ReactElement => {
    const key = entryKey(e.kind, e.id);
    const name = e.assistant === true ? "Assistant" : e.name;
    const sub = e.sub ?? (e.assistant === true ? "Yours, private to you" : e.kind === "outside" ? "Outside agent" : undefined);
    return (
      <View key={key} style={st.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${verb} ${name}`} testID={`as-row-${key}`} onPress={() => pickEntry(e)} style={({ hovered }: { hovered?: boolean }) => [st.rowMain, { borderRadius: 10 }, hovered === true && st.hover]}>
          <Face kind={e.kind} id={e.id} name={e.name} assistant={e.assistant} />
          <View style={st.rowText}>
            <Text style={st.name} numberOfLines={1}>{name}</Text>
            {sub === undefined ? null : <Text style={st.sub} numberOfLines={1}>{sub}</Text>}
          </View>
          <View style={st.plusBox}><Icon name="plus" size={13} color={t("ink-4")} /></View>
        </Pressable>
      </View>
    );
  };
  const section = (title: string, rows: readonly AccessEntry[], note?: string): ReactElement | null => rows.length === 0 ? null : (
    <View key={title}>
      <View style={st.sectRow}><Text style={st.sectText}>{title}</Text>{note === undefined ? null : <Text style={st.sectText}>{note}</Text>}</View>
      {rows.map(entryRow)}
    </View>
  );

  const pickRow = (p: AccessPick): ReactElement => {
    const agent = isAgentKind(p.kind);
    const settings = p.settings ?? DEFAULT_AGENT_SETTINGS;
    const sub = p.kind === "outside" ? outsideSub(p.name, props.ownerName) : p.sub;
    const open = (x: number, y: number): void => openPop({ src: "pick", key: p.key, x, y });
    return (
      <View key={p.key} style={st.pick} testID={`as-pick-${p.key}`}>
        <View style={st.pickTop}>
          <View style={[st.rowMain, { minWidth: 160 }]}>
            <Face kind={p.kind} id={p.id} name={p.name} assistant={p.assistant} />
            <View style={st.rowText}>
              <Text style={st.name} numberOfLines={1}>{p.name}</Text>
              {sub === undefined ? null : <Text style={st.sub} numberOfLines={1}>{sub}</Text>}
            </View>
          </View>
          <View style={[st.pickCtl, phone && st.pickCtlPhone]}>
            {agent && add
              ? <Picker label={`How ${p.name} responds`} value={pickHowLabel(p)} testID={`as-settings-${p.key}`} onPress={open} />
              : agent ? null : <Picker label={`Role for ${p.name}`} value={roleName(p.kind, p.role, ctx)} testID={`as-role-${p.key}`} onPress={(x, y) => roleMenu(p, x, y)} />}
            <IconButton icon="x" label={`Remove ${p.name}`} testID={`as-unpick-${p.key}`} size={12} onPress={() => unpick(p.key)} />
          </View>
        </View>
        {agent && add ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Settings for ${p.name}`} testID={`as-summary-${p.key}`} onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number } }) => open(e.nativeEvent?.pageX ?? 0, e.nativeEvent?.pageY ?? 0)} style={st.summary}>
            <Icon name="gear" size={12} />
            <Text style={st.summaryText} numberOfLines={1}>{settingsSummary(settings)}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const hereRows = (props.here ?? []).filter((e) => e.id !== "me");
  const hereBlock = add && q.trim() === "" && hereRows.length > 0 ? (
    <View testID="as-here">
      <View style={st.sectRow}><Text style={st.sectText}>Here now</Text><Text style={st.sectText}>{hereRows.length}</Text></View>
      {each(hereRows, (e) => {
        const agent = isAgentKind(e.kind);
        const name = e.assistant === true ? "Assistant" : e.name;
        return (
          <View key={entryKey(e.kind, e.id)} style={st.row}>
            <View style={st.rowMain}>
              <Face kind={e.kind} id={e.id} name={e.name} assistant={e.assistant} />
              <View style={st.rowText}><Text style={st.name} numberOfLines={1}>{name}</Text>{e.sub === undefined ? null : <Text style={st.sub} numberOfLines={1}>{e.sub}</Text>}</View>
            </View>
            {agent && props.onPoke ? <PokeButton name={name} testID={`as-here-poke-${e.id}`} onPress={() => props.onPoke?.(e.id)} /> : null}
            {agent ? <IconButton icon="gear" label="How and when it responds" testID={`as-gear-${e.id}`} onPress={(x, y) => openPop({ src: "here", id: e.id, x, y })} /> : null}
            {e.kind === "outside" && props.onRemoveHere ? <IconButton icon="x" label={`Remove ${name} from here`} testID={`as-here-remove-${e.id}`} size={12} onPress={() => props.onRemoveHere?.(e)} /> : null}
          </View>
        );
      })}
    </View>
  ) : null;

  /* ---------- the footer ---------- */

  const lines = add
    ? addLines({ target: add.target, picks, earlier, ownerName: props.ownerName, limited: viewOnly })
    : share ? shareLines({ type: share.itemType, name: share.itemName, label: share.itemLabel, picks, ownerName: props.ownerName, limited: !canGiveAll(share, props) }) : [];
  const idle = lines.length === 0 ? idleLine(props.mode, share?.itemType, share?.itemName) : "";

  const noOutside = (props.directory.outside ?? []).length === 0;
  const showEarlier = add !== null && add.earlierMessages !== false && showsEarlier(picks);
  const label = actionLabel(props.mode, picks, compactLabel);

  /* ---------- the views ---------- */

  const title = add ? "Add people and agents" : `Share “${share?.itemName ?? ""}”`;
  const subtitle = add ? `to ${add.target.name}` : share ? (share.records?.subtitle ?? share.subtitle ?? accessSubtitle(share.itemType, accessCount({ shares: share.shares, itemType: share.itemType, resourceId: share.resourceId, ownerId: share.ownerId, ownerName: share.ownerName, folderName: share.folderName }), share.itemLabel)) : "";
  const placeholder = picks.length > 0 ? "Add another" : add ? "Add people or agents" : type === "agent" ? "Add people or teams" : "Add people, teams or agents";

  const main = (
    <>
      <ViewHead title={title} sub={subtitle} onClose={props.onClose} />
      <View style={st.searchBox}>
        <Icon name="search" size={15} />
        {each(picks, (p) => (
          <View key={p.key} style={st.chip} testID={`as-chip-${p.key}`}>
            <Face kind={p.kind} id={p.id} name={p.name} assistant={p.assistant} size={18} />
            <Text style={st.chipText}>{firstName(p)}</Text>
            <IconButton icon="x" label={`Remove ${p.name}`} testID={`as-chip-x-${p.key}`} size={9} onPress={() => unpick(p.key)} />
          </View>
        ))}
        <TextInput
          ref={searchRef as never} testID="as-search" accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={t("ink-3")} value={q} onChangeText={setQ} autoFocus
          autoCorrect={false} autoCapitalize="none" blurOnSubmit={false} onKeyPress={onSearchKey as never} style={st.searchIn}
        />
      </View>
      {add ? (
        <View style={st.makers}>
          <Pill label={`New agent for ${targetNoun(add.target.kind)}`} icon="plus" testID="as-new" onPress={() => setView("new")} />
          <Pill label="Link an outside agent" icon="term" testID="as-link" onPress={() => setView("link")} />
        </View>
      ) : null}
      <ScrollView style={st.body} keyboardShouldPersistTaps="handled" testID="as-body">
        {picks.length > 0 ? <><View style={st.sectRow}><Text style={st.sectText}>{add ? "Adding" : "Sharing with"}</Text></View>{picks.map(pickRow)}</> : null}
        {share ? <AccessList p={share} compact={compactLabel} offered={share.levels} cleared={cleared} onCleared={(k) => setCleared((c) => [...c, k])} /> : null}
        {section("Suggested", secs.suggested, share ? undefined : "You work with these most")}
        {secs.invite === null ? null : (
          <View>
            <View style={st.sectRow}><Text style={st.sectText}>Invite</Text></View>
            <View style={st.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Invite ${secs.invite} as a guest`} testID="as-invite" onPress={() => pickInvite(secs.invite as string)} style={({ hovered }: { hovered?: boolean }) => [st.rowMain, { borderRadius: 10 }, hovered === true && st.hover]}>
                <Face kind="guest" id={secs.invite} name={secs.invite} />
                <View style={st.rowText}>
                  <Text style={st.name} numberOfLines={1}>{`Invite ${secs.invite} as a guest`}</Text>
                  <Text style={st.sub} numberOfLines={1}>{share ? `Sees only this ${itemLabelOf(share.itemType, share.itemLabel)}` : `Sees only what ${targetNoun(add?.target.kind ?? "chat")} allows`}</Text>
                </View>
                <View style={st.plusBox}><Icon name="plus" size={13} color={t("ink-4")} /></View>
              </Pressable>
            </View>
          </View>
        )}
        {secs.space === null ? null : section("Everyone", [secs.space])}
        {section("People", secs.people)}
        {section("Groups and roles", secs.groups)}
        {section("Agents", secs.agents)}
        {secs.outside.length > 0 ? section("Your outside agents", secs.outside, OUTSIDE_NOTE(props.ownerName)) : (share || type === "agent" || q.trim() !== "" || !noOutside ? null : (
          <View>
            <View style={st.sectRow}><Text style={st.sectText}>Your outside agents</Text></View>
            <Text style={st.empty} testID="as-no-outside">{NO_OUTSIDE}</Text>
          </View>
        ))}
        {noMatch(secs, q) ? <Text style={st.empty} testID="as-none">{NO_MATCH}</Text> : null}
        {hereBlock}
      </ScrollView>
      <View style={st.footTop}>
        {lines.length > 0 ? <Notes lines={lines} /> : idle === "" ? null : <Text style={st.note} testID="as-idle">{idle}</Text>}
        {refusal ? <Text style={st.refusal} accessibilityRole="alert" testID="as-refused">{refusal}</Text> : null}
        {share && share.notifyPeople === true && picks.length > 0 ? (
          <View style={{ gap: 6 }} testID="as-notify">
            <Switch label="Notify people" on={notify} onChange={setNotify} testID="as-notify-switch" />
            {notify ? <TextInput value={message} onChangeText={setMessage} placeholder="Add a message (optional)" placeholderTextColor={t("ink-3")} accessibilityLabel="Message to the people you share with" testID="as-message" style={st.message} /> : null}
          </View>
        ) : null}
        {showEarlier ? <Switch label="Include earlier messages" on={earlier} onChange={setEarlier} testID="as-earlier" /> : null}
        <View style={st.footBtns}>
          {share?.records ? <ExportMore rec={share.records} /> : null}
          {share?.onCopyLink ? <Pill label={copied ? "Link copied" : "Copy link"} icon="link" testID="as-copy-link" onPress={() => { share.onCopyLink?.(); markCopied(); }} /> : null}
          {share?.onCopyLink && copied ? <Text style={st.note} testID="as-copied-note">Only people with access can open it</Text> : null}
          <View style={{ flex: 1 }} />
          <Pill label="Cancel" testID="as-cancel" onPress={props.onClose} />
          <Pill label={label} primary disabled={picks.length === 0} testID="as-add" onPress={confirm} />
        </View>
      </View>
    </>
  );

  const body = assistantItem
    ? <AssistantNotice onClose={props.onClose} onNewAgent={share?.onNewAgent} />
    : view === "new" && add
      ? (
        <NewAgentView
          noun={targetNoun(add.target.kind)} own={targetOwn(add.target.kind)} title={add.target.name} draft={draft} models={models}
          onDraft={setDraft} onPickModel={modelMenu} onBack={() => setView("main")} onClose={props.onClose}
          onCreate={() => {
            if (draft.name.trim() === "") return;
            const n = made + 1;
            setMade(n);
            addPick(pickFromNew(n, draft));
            setDraft((d) => ({ name: "", brief: "", model: d.model }));
            setView("main");
          }}
        />
      )
      : view === "link" && add
        ? <LinkView link={props.link} copied={copied} ownerName={props.ownerName} onBack={() => setView("main")} onClose={props.onClose} onCopy={() => { props.link?.onCopy?.(); markCopied(); }} />
        : main;

  const labelFor = assistantItem ? "Share Assistant" : add ? "Add people and agents" : `Share ${share?.itemName ?? ""}`;
  return (
    <Overlay>
      <View style={[st.veil, phone && st.veilPhone]}>
        <Pressable accessibilityLabel="Close" accessible={false} onPress={props.onClose} testID="as-veil" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as ViewStyle} />
        <View
          role="dialog" aria-modal accessibilityLabel={labelFor} testID={props.testID ?? "as-sheet"}
          style={[st.card, phone && st.cardPhone, { boxShadow: "var(--sh-pop)" } as unknown as ViewStyle]}
          {...webProps({ dataSet: { sheet: phone ? "phone" : "card" }, onKeyDown: (e: KeyLike) => { if (keyOf(e) === "Escape") { e.stopPropagation?.(); escape.current(); } } })}
        >
          {body}
          {menu.element}
          {popView}
        </View>
      </View>
    </Overlay>
  );
}

/** True when the person can give every level the item offers. */
function canGiveAll(share: ShareSheetProps, props: Pick<AccessSheetProps, "maxLevel" | "canGive">): boolean {
  // a level above the giver's own is not offered, so the person can give everything only when every level of the item is on offer
  return roleOptions("person", { mode: "share", itemType: share.itemType, offered: share.levels, giving: { maxLevel: props.maxLevel, canGive: props.canGive } }).length === levelDefs(share.itemType, share.levels).length;
}
