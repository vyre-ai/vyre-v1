// The mount sheet (spec 2.16 Mounts, 3.5 Files > mount a folder; screen files.mount-sheet). Three steps in one dialog:
//   1 pick a source: Google Drive, Microsoft 365, This computer, GitHub (keys 1 to 4);
//   2 browse the provider's tree, or search repositories, and pick one thing (a folder row opens with its chevron or a double press);
//   3 options: Name, Who can see it, Copy (this computer only: Synced copy or Live only), Branch (GitHub), Into. Mount makes the folder and starts its first sync; Review changes is on for cloud folders
//     and repositories and is changed later in the folder's sync line.
// Reads come from mounts.browse and mounts.list; the one write is mounts.add, then access.share for the people chosen. Rows are ui/Row with leading and trailing slots (ruling 36).
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { browse, mountedRows, submitMount } from "./actions.ts";
import type { Listing } from "./actions.ts";
import { useMountsData } from "./data.tsx";
import { Glyph, Mark } from "./icons.tsx";
import type { MarkKind } from "./icons.tsx";
import {
  SOURCES, back, canMount, canNext, chooseSource, crumbs, defaultName, emptyDraft, isMounted, metaOf, next, pathKey as pathKeyOf, pick, setQuery, sourceOf, togglePerson, walkInto, walkTo, whoLabel,
} from "./model.ts";
import type { BrowseItem, Draft, MountKind, MountRow, SourceId } from "./model.ts";
import { Actions, Btn, ErrorLine, Field, IconButton, MenuButton, Segmented, Sheet, SheetHead, TextField, anchorOf } from "./parts.tsx";

export interface MountedInfo { mountId: string; folderId: string; runId: string; name: string; warning?: string }

export interface MountSheetProps {
  onClose(): void;
  onMounted(info: MountedInfo): void;
  /** The folder the mount goes into when the sheet opens from a folder; the Into field can change it. */
  into?: string;
  /** Start somewhere other than step 1 (a link from a "Mount a Repository" button starts at GitHub). */
  initial?: Partial<Draft>;
  /** A listing already in hand (tests and the first paint of a restored sheet); the first fetch is skipped. */
  preload?: { listing: Listing; mounted?: MountRow[] };
}

const DOUBLE_MS = 450;

const markKind = (k: MountKind | SourceId): MarkKind => (k === "sharepoint" || k === "onedrive" ? "microsoft" : (k as MarkKind));

type ListState = { status: "loading" } | { status: "ready"; items: BrowseItem[]; next?: string } | { status: "error" };

export function MountSheet({ onClose, onMounted, into, initial, preload }: MountSheetProps): ReactElement {
  const data = useMountsData();
  const dataRef = useRef(data);
  dataRef.current = data;
  const menu = useMenu();
  const [d, setD] = useState<Draft>(() => ({ ...emptyDraft(into ?? data.folders[0]?.id ?? ""), ...initial }));
  const [list, setList] = useState<ListState>(() => (preload ? { status: "ready", items: preload.listing.items, ...(preload.listing.next !== undefined ? { next: preload.listing.next } : {}) } : { status: "loading" }));
  const [mounted, setMounted] = useState<MountRow[]>(preload?.mounted ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipFirst = useRef(preload !== undefined);
  const last = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void mountedRows(dataRef.current.call).then((rows) => { if (live && !preload) setMounted(rows); });
    return () => { live = false; };
  }, []);

  const pathKey = pathKeyOf(d);
  useEffect(() => {
    if (d.step !== 2 || d.source === null) return;
    if (skipFirst.current) { skipFirst.current = false; return; }
    let live = true;
    setList({ status: "loading" });
    const t = setTimeout(() => {
      const cur = dataRef.current;
      void browse(cur.call, d, cur.accounts).then(
        (l) => { if (live) setList({ status: "ready", items: l.items, ...(l.next !== undefined ? { next: l.next } : {}) }); },
        () => { if (live) setList({ status: "error" }); },
      );
    }, d.q ? 180 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [d.step, d.source, pathKey, d.q, attempt]);

  const upd = (patch: Partial<Draft>): void => setD((x) => ({ ...x, ...patch }));
  const source = d.source === null ? null : sourceOf(d.source);

  const more = (): void => {
    if (list.status !== "ready" || list.next === undefined) return;
    const cursor = list.next;
    const keep = list.items;
    void browse(data.call, d, data.accounts, cursor).then(
      (l) => setList({ status: "ready", items: [...keep, ...l.items], ...(l.next !== undefined ? { next: l.next } : {}) }),
      () => setList({ status: "error" }),
    );
  };

  const press = (it: BrowseItem): void => {
    const key = `${it.kind}:${it.ref}`;
    const now = Date.now();
    const twice = last.current.key === key && now - last.current.at < DOUBLE_MS;
    last.current = { key, at: now };
    if (twice) { if (d.source === "github") setD((x) => next(pick(x, it))); else if (it.isFolder) setD((x) => walkInto(x, it)); else setD((x) => next(pick(x, it))); return; }
    setD((x) => pick(x, it));
  };

  const mount = (): void => {
    if (busy || !canMount(d)) return;
    setBusy(true);
    setError(null);
    void submitMount(data.call, d, data.accounts, data.space.everyoneGroupId).then((r) => {
      setBusy(false);
      if (r.ok) onMounted({ mountId: r.mountId, folderId: r.folderId, runId: r.runId, name: r.name, ...(r.warning !== undefined ? { warning: r.warning } : {}) });
      else setError(r.error);
    });
  };

  const choose = (id: SourceId): void => {
    if (!data.accounts[id].connected) { data.connect(id); return; }
    setList({ status: "loading" });
    setD((x) => chooseSource(x, id));
  };

  const onKey = (e: { key: string; target?: { tagName?: string } }): boolean => {
    if (d.step === 1 && /^[1-4]$/.test(e.key)) { const s = SOURCES[Number(e.key) - 1]; if (s) choose(s.id); return true; }
    return false;
  };

  const whoMenu = (e: unknown): void => {
    const { x, y } = anchorOf(e);
    const items: MenuEntry[] = [{ label: "Only you", checked: d.who.mode === "me", onSelect: () => upd({ who: { mode: "me" } }) }];
    if (data.space.everyoneGroupId) items.push({ label: `Everyone in ${data.space.name}`, checked: d.who.mode === "everyone", onSelect: () => upd({ who: { mode: "everyone" } }) });
    if (data.people.length) items.push({ separator: true });
    for (const p of data.people) items.push({ label: p.name, checked: d.who.mode === "people" && d.who.ids.includes(p.id), onSelect: () => upd({ who: togglePerson(d.who, p.id) }) });
    menu.show(items, x, y, "other");
  };
  const intoMenu = (e: unknown): void => {
    const { x, y } = anchorOf(e);
    const items: MenuEntry[] = [];
    for (const f of data.folders) items.push({ label: f.name, checked: f.id === d.into, onSelect: () => upd({ into: f.id }) });
    menu.show(items, x, y, "other");
  };

  let title = "Mount a folder";
  let mark: ReactElement | undefined;
  if (d.step >= 2 && source) { title = source.name; mark = <Mark kind={markKind(source.id)} size={16} />; }
  if (d.step === 3 && d.picked && source) title = source.id === "github" ? d.picked.ref : d.picked.name;

  return (
    <Sheet label="Mount a folder" onClose={onClose} onKey={onKey} testID="mount-sheet">
      <SheetHead title={title} mark={mark} onBack={d.step > 1 ? () => setD((x) => back(x)) : undefined} onClose={onClose} />
      {d.step === 1 ? <SourceStep onChoose={choose} /> : null}
      {d.step === 2 && source ? (
        <PickStep
          d={d}
          list={list}
          mounted={mounted}
          onQuery={(q) => setD((x) => setQuery(x, q))}
          onPress={press}
          onInto={(it) => setD((x) => walkInto(x, it))}
          onCrumb={(i) => setD((x) => walkTo(x, i))}
          onMore={more}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : null}
      {d.step === 3 && d.picked && source ? (
        <View testID="mount-options">
          <Field label="Name" first>
            <TextField value={d.name !== null ? d.name : defaultName(d)} onChange={(v) => upd({ name: v })} label="Name" onSubmit={mount} testID="mount-name" />
          </Field>
          <Field label="Who can see it">
            <MenuButton value={whoLabel(d.who, data.space.name, data.people)} label="Who can see it" onPress={whoMenu} testID="mount-who" />
          </Field>
          {source.id === "local" ? (
            <Field label="Copy">
              <Segmented label="Copy" testID="mount-copy" value={d.copy} onChange={(v) => upd({ copy: v })} options={[{ id: "server_copy", label: "Synced copy" }, { id: "live_only", label: "Live only" }]} />
            </Field>
          ) : null}
          {source.id === "github" ? (
            <Field label="Branch">
              <View style={st.branch}><Glyph name="branch" size={14} /><TextField value={d.branch} onChange={(v) => upd({ branch: v })} label="Branch" onSubmit={mount} testID="mount-branch" width={150} /></View>
            </Field>
          ) : null}
          <Field label="Into">
            <MenuButton value={data.folders.find((f) => f.id === d.into)?.name ?? "Choose a folder"} label="Into" onPress={intoMenu} testID="mount-into" />
          </Field>
        </View>
      ) : null}
      {error ? <ErrorLine text={error} /> : null}
      {d.step === 2 ? (
        <Actions>
          <Btn label="Cancel" onPress={onClose} testID="mount-cancel" />
          <Btn label="Next" primary disabled={!canNext(d)} onPress={() => setD((x) => next(x))} testID="mount-next" />
        </Actions>
      ) : null}
      {d.step === 3 ? (
        <Actions>
          <Btn label="Back" onPress={() => setD((x) => back(x))} testID="mount-back" />
          <Btn label={busy ? "Mounting…" : "Mount"} primary disabled={busy || !canMount(d)} onPress={mount} testID="mount-go" />
        </Actions>
      ) : null}
      {menu.element}
    </Sheet>
  );
}

// ---------------------------------------------------------------- step 1

function SourceStep({ onChoose }: { onChoose: (id: SourceId) => void }): ReactElement {
  const data = useMountsData();
  const rows: ReactElement[] = [];
  for (const s of SOURCES) {
    const acc = data.accounts[s.id];
    rows.push(
      <Row
        key={s.id}
        id={`source:${s.id}`}
        title={s.name}
        note={acc.connected ? acc.label : "Not connected"}
        leading={<View style={st.markSlot}><Mark kind={markKind(s.id)} size={24} /></View>}
        trailing={acc.connected ? <Glyph name="chev" size={12} /> : <Text style={st.meta}>Connect</Text>}
        onPress={() => onChoose(s.id)}
      />,
    );
  }
  return <View testID="mount-sources" accessibilityRole="list">{rows}</View>;
}

// ---------------------------------------------------------------- step 2

interface PickProps {
  d: Draft;
  list: ListState;
  mounted: readonly MountRow[];
  onQuery(q: string): void;
  onPress(it: BrowseItem): void;
  onInto(it: BrowseItem): void;
  onCrumb(i: number): void;
  onMore(): void;
  onRetry(): void;
}

function PickStep({ d, list, mounted, onQuery, onPress, onInto, onCrumb, onMore, onRetry }: PickProps): ReactElement {
  const github = d.source === "github";
  const trail = crumbs(d);
  const crumbViews: ReactElement[] = [];
  for (let i = 0; i < trail.length; i++) {
    const name = trail[i] as string;
    crumbViews.push(
      <View key={`${i}:${name}`} style={st.crumbWrap}>
        {i > 0 ? <Glyph name="chev" size={9} /> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => onCrumb(i)} testID={`crumb-${i}`} style={st.crumb}>
          <Text style={[st.crumbText, i === trail.length - 1 && st.crumbCur]}>{name}</Text>
        </Pressable>
      </View>,
    );
  }
  const browseRows: ReactElement[] = [];
  if (list.status === "ready") {
    for (const it of list.items) browseRows.push(<BrowseRow key={`${it.kind}:${it.ref}`} d={d} it={it} done={isMounted(it, mounted)} onPress={onPress} onInto={onInto} />);
  }
  return (
    <View style={st.pick} testID="mount-pick">
      {github ? <SearchBox value={d.q} onChange={onQuery} /> : null}
      {trail.length ? <View style={st.crumbs} role="navigation" aria-label="Path" testID="mount-crumbs">{crumbViews}</View> : null}
      <ScrollView style={st.listBox} keyboardShouldPersistTaps="handled" testID="mount-list">
        {list.status === "loading" ? <ListSkeleton /> : null}
        {list.status === "error" ? (
          <View style={st.none} testID="mount-list-error">
            <Text style={st.noneText}>Could not load that.</Text>
            <Btn label="Try again" onPress={onRetry} testID="mount-retry" />
          </View>
        ) : null}
        {list.status === "ready" && list.items.length === 0 ? (
          <View style={st.none} testID="mount-list-empty">
            <Text style={st.noneText}>{github && d.q.trim() ? `No repositories match “${d.q.trim()}”` : github ? "No repositories yet" : d.q.trim() ? `Nothing matches “${d.q.trim()}”` : "Nothing in this folder"}</Text>
          </View>
        ) : null}
        {browseRows}
        {list.status === "ready" && list.next !== undefined ? (
          <Row id="mount-more" title="Show more" onPress={onMore} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function BrowseRow({ d, it, done, onPress, onInto }: { d: Draft; it: BrowseItem; done: boolean; onPress: (it: BrowseItem) => void; onInto: (it: BrowseItem) => void }): ReactElement {
  const github = d.source === "github";
  const on = d.picked !== null && d.picked.kind === it.kind && d.picked.ref === it.ref;
  const atRoot = d.path.length === 0;
  const meta = metaOf(it, done);
  const leading = github || (atRoot && d.source !== "local")
    ? <Mark kind={github ? "github" : markKind(it.kind)} size={20} />
    : <Glyph name="folder" size={18} />;
  const walkable = !github && it.isFolder;
  return (
    <View style={done ? st.dis : undefined} {...(done ? { pointerEvents: "none" as const } : {})}>
      <Row
        id={`browse:${it.kind}:${it.ref}`}
        title={it.name}
        selected={on}
        leading={<View style={st.markSlot}>{leading}</View>}
        trailing={(
          <View style={st.trail}>
            {meta ? <Text numberOfLines={1} style={st.meta}>{meta}</Text> : null}
            {on ? <Glyph name="check" size={14} color="var(--accent)" width={1.6} /> : null}
            {walkable ? <IconButton glyph="chev" label={`Open ${it.name}`} onPress={() => onInto(it)} testID={`browse-into-${it.ref}`} /> : null}
          </View>
        )}
        onPress={() => onPress(it)}
      />
    </View>
  );
}

function ListSkeleton(): ReactElement {
  const rows: ReactElement[] = [];
  for (let i = 0; i < 4; i++) rows.push(<View key={i} style={st.skRow}><View style={st.skMark} /><View style={[st.skBar, { width: `${48 - i * 7}%` }]} /></View>);
  return <View testID="mount-list-loading" accessibilityLabel="Loading" accessibilityRole="progressbar">{rows}</View>;
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }): ReactElement {
  const [focus, setFocus] = useState(false);
  return (
    <View style={[st.search, focus && st.searchFocus]}>
      <Glyph name="search" size={14} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        accessibilityLabel="Search repositories"
        placeholder="Search repositories"
        placeholderTextColor="var(--ink-4)"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        testID="mount-search"
        style={st.searchInput}
      />
    </View>
  );
}

const sx = (o: Record<string, unknown>) => o as never;

const st = StyleSheet.create({
  pick: { gap: 8 },
  markSlot: { width: 28, alignItems: "flex-start", justifyContent: "center" },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { fontSize: 12, color: "var(--ink-3)" as string },
  branch: { flexDirection: "row", alignItems: "center", gap: 8 },
  crumbs: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2 },
  crumbWrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  crumb: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  crumbText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  crumbCur: { color: "var(--ink)" as string, fontWeight: "500" },
  listBox: { maxHeight: 340, minHeight: 112 },
  dis: { opacity: 0.5 },
  none: { padding: 18, alignItems: "center", gap: 8 },
  noneText: { fontSize: 13, color: "var(--ink-3)" as string, textAlign: "center" },
  skRow: { height: 28, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  skMark: { width: 20, height: 20, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  skBar: { height: 10, borderRadius: 5, backgroundColor: "var(--hover)" as string },
  search: sx({ height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, borderRadius: 8, backgroundColor: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line)" }),
  searchFocus: sx({ boxShadow: "inset 0 0 0 1px var(--accent-line), 0 0 0 3px var(--accent-wash)" }),
  searchInput: sx({ flex: 1, minWidth: 0, height: 34, color: "var(--ink)", fontSize: 13.5, outlineStyle: "none" }),
});

