// The Chats sidebar of the 13 Nov design, drawn from ONE read (chats.sidebar) and the small presence read. It owns what a person does here (open, pin, mute, mark, archive, the "+" and filter menus, folds, keys) and hands drawing to
// SidebarList. Pins and mutes are the server's answer; folds are kept on this device through the one port (side-state.ts), so the per-person state module replaces that line and nothing else.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useContextMenu } from "../../../../../../ui/src/Menu/context.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Quiet } from "../../../../../../ui/src/States/Quiet.tsx";
import { LoadFailed, failureOf } from "../../../../../../ui/src/States/Loads.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useResume } from "../../../onboarding/resume-context.ts";
import { claimResumeFoot } from "../../../onboarding/resume-place.ts";
import { portalInto } from "../../../shell/sidebar/portal.ts";
import type { SidebarSlotApi } from "../../../shell/sidebar/index.ts";
import { GATE, allows, useOptionalShellRuntime } from "../../../shell/providers/runtime.tsx";
import { matchShortcut } from "../../../shell/keyboard/map.ts";
import { detectPlatform } from "../../../shell/keyboard/useShellKeys.ts";
import { importedRows } from "../imported/model.ts";
import type { ImportedRow } from "../imported/model.ts";
import { lastNotesTab } from "../notes/notes-tab.ts";
import { TextAsk } from "../menus/TextAsk.tsx";
import { askedCall } from "../goals/goal-menu.ts";
import { useAddSheet } from "../addsheet/index.ts";
import { nameOr } from "../names.ts";
import { ChannelSheets } from "../channels/Sheets.tsx";
import { onChannelRequest, takeChannelRequest } from "../channels/request.ts";
import type { ChannelSheetKind } from "../channels/request.ts";
import { createMenuApi } from "../menus/actions.ts";
import { copyToClipboard } from "../menus/actions-b.ts";
import { itemLink } from "../../../share/rows.ts";
import { createSidebarApi } from "./actions.ts";
import { useScreenQuery, useSidebarData } from "./data.tsx";
import { Glyph, Tool } from "./parts.tsx";
import { NO_PRESENCE, itemsOf, namesOf, openKeyFor, pinsOf } from "./side-data.ts";
import type { Presence, SideOut, SideRow } from "./side-data.ts";
import { buildLayout, filterChoices, FILTER_CHOICES } from "./layout.ts";
import type { FilterId, Item, SectionId } from "./layout.ts";
import { deviceSideState } from "./side-state.ts";
import { SidebarList } from "./SidebarList.tsx";
import { filterMenu, newMenu, notesMenu } from "./side-menus.ts";
import type { RowDo } from "./side-menus.ts";
import { refetch } from "./model.ts";
import { draftThreads, scopeOf, subscribeDrafts } from "../conversation/drafts.ts";
import { MoreRow } from "../../../../../../ui/src/MoreRow/index.tsx";

const SECTIONS_PAGED = ["goals", "pinned", "chats", "channels", "team"] as const;
export const SIDE_SCREEN = "chats.sidebar";
export const SIDE_QUERY = "side";
const MUTE_MINUTES = 525_600;
const STAR_TYPE: Record<SideRow["kind"], "thread" | "channel" | "project" | "agent" | null> = {
  chat: "thread",
  channel: "channel",
  project: "project",
  agent: "agent",
  person: "thread",
  goal: null,
};

const store = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null => {
  try {
    return (
      (
        globalThis as unknown as {
          localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
        }
      ).localStorage ?? null
    );
  } catch {
    return null;
  }
};

function usePresence(): Presence {
  const data = useSidebarData();
  const [p, setP] = useState<Presence>(NO_PRESENCE);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void Promise.resolve(data.call("chats.presence", {})).then(
        (o) => {
          const r = o as {
            people?: { personId: string; state: "online" | "away" }[];
            working?: { agentId: string }[];
          } | null;
          if (live)
            setP({
              people: new Map((r?.people ?? []).map((x) => [x.personId, x.state])),
              working: new Set((r?.working ?? []).map((w) => w.agentId)),
            });
        },
        () => undefined,
      );
    };
    read();
    const off = data.changes?.subscribe(read);
    return () => {
      live = false;
      off?.();
    };
  }, [data]);
  return p;
}

export function SideChats({
  slot,
  open,
  window,
  startFilter,
}: {
  query?: string;
  slot: SidebarSlotApi | undefined;
  open?: string | null;
  window?: VirtualWindow;
  startFilter?: FilterId;
}): ReactElement {
  const data = useSidebarData();
  const menu = useMenu();
  const ctx = useContextMenu(menu);
  const rt = useOptionalShellRuntime();
  const canChat = allows(rt, GATE.newChat);
  const canChannel = allows(rt, GATE.newChannel);
  const manageAgents = allows(rt, "agents.manage");
  const [filter, setFilter] = useState<FilterId>(startFilter ?? "all");
  const q = useScreenQuery<SideOut>(SIDE_SCREEN, SIDE_QUERY, { filter });
  const presence = usePresence();
  const port = useMemo(() => deviceSideState(data.space.name, store()), [data.space.name]);
  const [, tick] = useState(0);
  useEffect(() => port.subscribe(() => tick((n) => n + 1)), [port]);
  const [draftTick, setDraftTick] = useState(0);
  useEffect(() => subscribeDrafts(() => setDraftTick((n) => n + 1)), []);
  const meId = data.me?.id;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const drafts = useMemo(() => draftThreads(scopeOf(meId)), [meId, draftTick]);
  const [pages, setPages] = useState<Partial<Record<(typeof SECTIONS_PAGED)[number], SideRow[]>>>({});
  const [more, setMore] = useState<ReadonlySet<SectionId>>(new Set());
  const [sheet, setSheet] = useState<ChannelSheetKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<
    { kind: "rename"; threadId: string; title: string } | { kind: "stuck" | "report"; goalId: string } | null
  >(null);
  const api = useMemo(
    () =>
      createSidebarApi(
        data,
        () => undefined,
        () => undefined,
      ),
    [data],
  );
  const menuApi = useMemo(() => createMenuApi(data), [data]);
  const resume = useResume();
  useEffect(() => claimResumeFoot(), []);
  const personal = data.space.personal === true;
  const leave = (): void => slot?.openBody();
  useEffect(() => {
    const k = takeChannelRequest();
    if (k && !personal) setSheet(k);
    return onChannelRequest(() => {
      const kind = takeChannelRequest();
      if (kind && !personal) setSheet(kind);
    });
  }, [personal]);

  const first = q.status === "ready" ? q.data : null;
  // the rows past the first page, fetched when a section is opened with "N more" (the answer carries 50 of each and says how many there are)
  const out = useMemo(() => {
    if (!first) return null;
    const o = { ...first } as SideOut;
    for (const k of SECTIONS_PAGED) {
      const extra = pages[k];
      if (extra?.length)
        o[k] = {
          ...first[k],
          rows: [...first[k].rows, ...extra.filter((r) => !first[k].rows.some((x) => x.key === r.key))],
        };
    }
    return o;
  }, [first, pages]);
  useEffect(() => setPages({}), [filter, first]);
  const loadRest = (s: (typeof SECTIONS_PAGED)[number]): void => {
    if (!first || first[s].next === undefined) return;
    void (async () => {
      let after: string | undefined = first[s].next;
      const got: SideRow[] = [];
      for (let n = 0; after !== undefined && n < 20; n++) {
        const r = (await data.call("chats.sidebar", {
          ...(filter === "all" ? {} : { filter }),
          more: { section: s, after, limit: 100 },
        })) as SideOut;
        got.push(...r[s].rows);
        after = r[s].next;
      }
      setPages((p) => ({ ...p, [s]: got }));
    })().catch(() => say("Could not load the rest. Try again."));
  };
  const names = useMemo(() => (out ? namesOf(out) : new Map<string, string>()), [out]);
  const agentName = useCallback((id: string) => nameOr(names.get(id), "Someone"), [names]);
  const seq = useRef(0);
  const add = useAddSheet(
    {
      call: data.call,
      me: { id: data.me?.id ?? "me", name: "You" },
      nameOf: agentName,
      newKey: () => `sb2-add-${++seq.current}`,
      toast: (t: string) => say(t),
      ...(allows(rt, "console.access") ? { admin: true } : {}),
    },
    { copy: (t: string) => copyToClipboard(t) },
  );
  const assistantId = data.space.assistant.agentId;
  // imported coding sessions (a Personal Space): read on open and when the Space changes; they are the Imported filter's rows
  const [imported, setImported] = useState<ImportedRow[]>([]);
  useEffect(() => {
    if (!personal) {
      setImported([]);
      return undefined;
    }
    let live = true;
    const read = (): void => {
      void Promise.resolve(data.call("sessions.list", {})).then(
        (r) => live && setImported(importedRows((r as { sessions?: Partial<ImportedRow>[] } | null)?.sessions)),
        () => live && setImported([]),
      );
    };
    read();
    const off = data.changes?.subscribe(read);
    return () => {
      live = false;
      off?.();
    };
  }, [data, personal]);
  const importedItems = useMemo(
    () =>
      imported.map(
        (r): Item => ({
          key: `i:${r.conversationId}`,
          kind: "chat",
          shape: "agent",
          title: r.title,
          faces: [{ id: r.conversationId, name: r.title }],
          unread: 0,
          mentions: 0,
          muted: false,
          draft: false,
          working: false,
          archived: r.archived === true,
          ask: false,
          ended: false,
          lastAt: r.importedAt,
        }),
      ),
    [imported],
  );
  const serverBuilt = useMemo(
    () => (out ? itemsOf(out, assistantId, presence, drafts) : null),
    [out, assistantId, presence, drafts],
  );
  const built = useMemo(
    () => (filter === "imported" ? { items: importedItems, refs: new Map<string, SideRow>() } : serverBuilt),
    [filter, importedItems, serverBuilt],
  );
  const pins = useMemo(() => (out ? pinsOf(out) : []), [out]);
  const openKey = built ? openKeyFor(open, built.refs) : null;
  const layout = useMemo(
    () =>
      buildLayout({
        items: built?.items ?? [],
        pins,
        filter,
        folded: port.folds(),
        more,
        open: openKey,
        totals: out
          ? {
              goals: out.goals.total,
              pinned: out.pinned.total,
              chats: out.chats.total,
              channels: out.channels.total,
              team: out.team.total,
            }
          : {},
        personal,
        guest: !canChat,
        loading: q.status === "loading" && failureOf(q) === undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [built, pins, filter, port.folds(), more, openKey, personal, canChat, q.status],
  );
  const reread = useCallback((): void => void refetch(data.screens), [data.screens]);
  const say = (text: string): void => {
    setNote(text);
    setTimeout(() => setNote(null), 3500);
  };
  const guard = (p: Promise<unknown>): void => void p.then(reread, () => say("That did not work. Try again."));
  const refOf = (x: Item): SideRow | undefined => built?.refs.get(x.key);

  const openItem = (x: Item, how: "here" | "tab"): void => {
    if (x.key.startsWith("i:")) {
      const s = imported.find((i) => `i:${i.conversationId}` === x.key);
      if (s?.continuedThreadId) data.nav.openChat(s.continuedThreadId);
      else if (s) data.nav.openImported?.(s.conversationId);
      leave();
      return;
    }
    const r = refOf(x);
    if (x.kind === "task") data.nav.openNeedsYou(x.key.slice(2));
    else if (!r) return;
    else if (r.kind === "goal") data.nav.openGoal?.(x.key.slice(2));
    else if (r.kind === "project") data.nav.openProject?.(x.key.slice(3));
    else if (r.kind === "channel") data.nav.openChannel(x.key.slice(3));
    else if (r.kind === "agent") data.nav.openAgentChat(r.agentId!);
    else if (r.kind === "person" && !r.threadId) void api.chatWithPerson(r.personId!);
    else if (r.threadId) (how === "tab" ? (data.nav.openChatTab ?? data.nav.openChat) : data.nav.openChat)(r.threadId);
    leave();
  };
  const star = (x: Item, on: boolean): void => {
    const r = refOf(x);
    const type = r ? STAR_TYPE[r.kind] : null;
    const id = !r || !type ? null : type === "thread" ? r.threadId : x.key.slice(x.key.indexOf(":") + 1);
    if (id && (type === "thread" || type === "channel" || type === "agent" || type === "project"))
      guard(api.star(type as "thread" | "agent" | "channel", id, on));
  };
  const muteTarget = (r: SideRow): { kind: "thread" | "channel" | "agent" | "person"; id: string } | null =>
    r.kind === "agent"
      ? { kind: "agent", id: r.agentId! }
      : r.kind === "person" && !r.threadId
        ? { kind: "person", id: r.personId! }
        : r.kind === "channel"
          ? { kind: "channel", id: r.key.slice(3) }
          : r.threadId
            ? { kind: "thread", id: r.threadId }
            : null;
  const rowDo = (x: Item): RowDo => {
    const r = refOf(x);
    if (!r) return {};
    const t = r.threadId;
    const mt = muteTarget(r);
    const pinnable = STAR_TYPE[r.kind] !== null;
    return {
      ...(pinnable ? { pin: () => star(x, true), unpin: () => star(x, false) } : {}),
      ...(mt
        ? {
            mute: () => guard(menuApi.setMute(mt.kind, mt.id, true, MUTE_MINUTES)),
            unmute: () => guard(menuApi.setMute(mt.kind, mt.id, false)),
          }
        : {}),
      ...(t ? { markRead: () => guard(api.markRead(t)), markUnread: () => guard(api.markUnread(t)) } : {}),
      ...(r.kind === "chat" && t
        ? { archive: () => guard(api.archive(t)), unarchive: () => guard(api.unarchive(t)) }
        : {}),
      ...(r.kind === "chat" && t
        ? r.withPeople
          ? { leave: () => guard(api.leaveChat(t)) }
          : { deleteChat: () => guard(api.deleteChat(t)) }
        : {}),
      ...(r.kind === "channel" ? { leave: () => guard(menuApi.leaveChannel(x.key.slice(3))) } : {}),
      ...(r.kind === "chat" && t ? { rename: () => setAsk({ kind: "rename", threadId: t, title: x.title }) } : {}),
      ...(t && (r.kind === "chat" || r.kind === "person")
        ? { addPeople: () => add.open({ threadId: t, name: x.title }) }
        : {}),
      ...(r.kind === "channel" && t ? { invite: () => add.open({ threadId: t, name: x.title }) } : {}),
      ...(r.kind === "goal"
        ? {
            reportProgress: () => setAsk({ kind: "report", goalId: x.key.slice(2) }),
            markStuck: () => setAsk({ kind: "stuck", goalId: x.key.slice(2) }),
            pauseGoal: () => guard(data.call("goals.pause", { goalId: x.key.slice(2) })),
          }
        : {}),
      ...(r.kind === "agent" && data.nav.openAgent ? { viewProfile: () => data.nav.openAgent!(r.agentId!) } : {}),
      ...(r.kind === "agent" && !x.assistant ? { pause: () => guard(menuApi.pause(r.agentId!)) } : {}),
      copyLink: () =>
        copyToClipboard(
          itemLink(
            r.kind === "chat" || r.kind === "person" ? "thread" : r.kind,
            r.kind === "chat" || r.kind === "person" ? (t ?? "") : x.key.slice(x.key.indexOf(":") + 1),
          ),
        ),
    };
  };
  const startChat = (): void => {
    (data.nav.openNew ?? (() => void api.newChat()))();
    leave();
  };
  const newItems = (): ReturnType<typeof newMenu> =>
    newMenu({
      ...(canChat ? { newChat: startChat } : {}),
      ...(canChannel && !personal ? { newChannel: () => setSheet("new") } : {}),
      ...(data.nav.takeNote
        ? {
            newNote: () => {
              data.nav.takeNote!();
              leave();
            },
          }
        : {}),
    });
  const filterItems = (): ReturnType<typeof filterMenu> =>
    filterMenu(
      filterChoices(serverBuilt?.items ?? [])
        .filter((r) => r.id !== "imported" || imported.length > 0)
        .map((r) => (r.id === "imported" ? { ...r, count: imported.length } : r)),
      filter,
      { pick: setFilter },
    );

  // the keys of the shell table that act on this list: new chat and channel, the nth pinned row, next and previous unread, hide
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (
      globalThis as {
        document?: {
          addEventListener(t: string, f: (e: KeyboardEvent) => void): void;
          removeEventListener(t: string, f: (e: KeyboardEvent) => void): void;
        };
      }
    ).document;
    if (!doc) return undefined;
    const on = (e: KeyboardEvent): void => {
      const m = matchShortcut(e, detectPlatform());
      if (!m) return;
      const run = (f: () => void): void => {
        e.preventDefault();
        f();
      };
      if (m.id === "chat.new" && canChat) run(startChat);
      else if (m.id === "channel.new" && canChannel && !personal) run(() => setSheet("new"));
      else if (m.id === "note.new" && data.nav.takeNote) run(() => data.nav.takeNote!());
      else if (m.id === "sidebar.hide") run(() => data.nav.toggleSidebar?.());
      else if (m.id === "agent.jump" && m.arg) {
        const key = layout.digits ? [...layout.digits.entries()].find(([, n]) => n === m.arg)?.[0] : undefined;
        const it = key ? built?.items.find((x) => x.key === key) : undefined;
        if (it) run(() => openItem(it, "here"));
      } else if (m.id === "chats.unread.next" || m.id === "chats.unread.prev") {
        const un = (built?.items ?? []).filter(
          (x) => x.kind !== "task" && !x.muted && !x.archived && x.unread + x.mentions > 0,
        );
        const at = un.findIndex((x) => x.key === openKey);
        const pick =
          un[
            (at +
              (m.id === "chats.unread.next" ? 1 : un.length - 1) +
              (at < 0 && m.id === "chats.unread.next" ? 0 : 0)) %
              Math.max(1, un.length)
          ] ?? un[0];
        if (pick) run(() => openItem(pick, "here"));
      }
    };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  });

  const failure = failureOf(q);
  const showAll = (): void => setFilter("all");
  const head = (
    <>
      <Tool
        icon="filter"
        label="Filter (F)"
        active={filter !== "all"}
        onPress={(x, y) => menu.show(filterItems(), x, y, "other")}
        testID="filter-chats"
      />
      <Tool icon="plus" label="New (⌘N)" onPress={(x, y) => menu.show(newItems(), x, y, "other")} testID="new-menu" />
    </>
  );
  const showing = layout.filter.showing;
  return (
    <View testID="chats-sidebar" style={st.root}>
      {slot?.actionsOutlet ? portalInto(slot.actionsOutlet, head) : <View style={st.top}>{head}</View>}
      {showing ? (
        <View testID="sidebar-showing" style={st.showing}>
          <Text style={st.showingText}>{showing.text}</Text>
          <Pressable accessibilityRole="button" onPress={showAll}>
            <Text style={st.showAll}>Show all</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={st.list}>
        {failure && !out ? (
          <LoadFailed what="chats" failure={failure} />
        ) : !out ? (
          <Quiet />
        ) : layout.empty ? (
          <EmptyInvite canChat={canChat} onStart={startChat} />
        ) : (
          <SidebarList
            layout={layout}
            selected={openKey}
            rowDo={rowDo}
            can={{ manageAgent: manageAgents }}
            headDo={(s) => ({
              ...(s === "chats"
                ? {
                    markAllRead: () =>
                      guard(
                        Promise.all(
                          (built?.items ?? [])
                            .filter((x) => x.kind === "chat" && x.unread > 0 && refOf(x)?.threadId)
                            .map((x) => api.markRead(refOf(x)!.threadId!)),
                        ),
                      ),
                    ...(canChat ? { newChat: startChat } : {}),
                  }
                : {}),
              ...(s === "channels"
                ? {
                    ...(canChannel ? { newChannel: () => setSheet("new") } : {}),
                    browseChannels: () => setSheet("browse"),
                  }
                : {}),
              ...(s === "pinned"
                ? {
                    unpinAll: () =>
                      (built?.items ?? []).filter((x) => pins.includes(x.key)).forEach((x) => star(x, false)),
                  }
                : {}),
              ...(s === "team"
                ? {
                    newAgent: () => {
                      (data.nav.openNewAgent ?? data.nav.openAllAgents)();
                      leave();
                    },
                  }
                : {}),
            })}
            tasksDo={{ ...(data.nav.openTasks ? { openTab: () => data.nav.openTasks!() } : {}) }}
            open={openItem}
            openTasks={() => {
              data.nav.openTasks?.();
              leave();
            }}
            fold={(s) => port.setFold(s, !port.folds().has(s))}
            toggleMore={(s) => {
              if (!more.has(s) && s !== "needs") loadRest(s as (typeof SECTIONS_PAGED)[number]);
              setMore((m) => new Set(m.has(s) ? [...m].filter((x) => x !== s) : [...m, s]));
            }}
            retry={reread}
            showAll={showAll}
            newGoal={() => data.nav.openGoal?.("new")}
            openPinned={(n) => {
              const key = [...layout.digits.entries()].find(([, d]) => d === n)?.[0];
              const it = key ? built?.items.find((x) => x.key === key) : undefined;
              if (it) openItem(it, "here");
            }}
            nextUnread={(dir) => {
              const un = (built?.items ?? []).filter(
                (x) => x.kind !== "task" && !x.muted && !x.archived && x.unread + x.mentions > 0,
              );
              const at = un.findIndex((x) => x.key === openKey);
              const pick = un[(at + (dir === 1 ? 1 : un.length - 1)) % Math.max(1, un.length)] ?? un[0];
              if (pick) openItem(pick, "here");
            }}
            openFilter={() => menu.show(filterItems(), 24, 80, "other")}
            copyLink={(x) => rowDo(x).copyLink?.()}
            search={() => data.nav.openSearch()}
            leave={leave}
            {...(window ? { window } : {})}
          />
        )}
      </View>
      {out && !layout.empty && (data.nav.openNotes || data.nav.openArtifacts) ? (
        <View style={st.foot}>
          <Row
            id="notes"
            title="Notes & artifacts"
            selected={open === "notes" || open === "artifacts"}
            leading={
              <View style={{ width: 20, marginRight: 8, alignItems: "center" }}>
                <Glyph name="note" size={16} color="var(--ink-2)" />
              </View>
            }
            onPress={() => {
              (lastNotesTab() === "artifacts" && data.nav.openArtifacts
                ? data.nav.openArtifacts
                : (data.nav.openNotes ?? data.nav.openArtifacts))?.();
              leave();
            }}
            domProps={ctx.on(
              () =>
                notesMenu({
                  ...(data.nav.openNotes ? { open: data.nav.openNotes, openNotes: data.nav.openNotes } : {}),
                  ...(data.nav.openArtifacts ? { openArtifacts: data.nav.openArtifacts } : {}),
                  ...(data.nav.takeNote ? { newNote: data.nav.takeNote } : {}),
                }),
              { label: "Notes and artifacts" },
            )}
          />
        </View>
      ) : null}
      {resume?.pill ? (
        <View testID="sidebar-setup" style={st.setup}>
          {resume.pill}
        </View>
      ) : null}
      {note ? (
        <Text accessibilityRole="alert" style={st.note}>
          {note}
        </Text>
      ) : null}
      {menu.element}
      {add.element}
      {ask ? (
        <TextAsk
          title={
            ask.kind === "rename" ? "Rename chat" : ask.kind === "stuck" ? "Why is this goal stuck?" : "Report progress"
          }
          label={
            ask.kind === "rename"
              ? "Name"
              : ask.kind === "stuck"
                ? "What is in the way"
                : "What changed and what is next"
          }
          action={ask.kind === "rename" ? "Rename" : ask.kind === "stuck" ? "Mark stuck" : "Report"}
          {...(ask.kind === "rename" ? { initial: ask.title } : { multiline: true })}
          onClose={() => setAsk(null)}
          onDone={(text) => {
            const a = ask;
            setAsk(null);
            if (a.kind === "rename") guard(menuApi.renameThread(a.threadId, text.trim()));
            else {
              const c = askedCall(a.kind, text);
              guard(data.call(c.cap, { goalId: a.goalId, ...c.input }).then(() => say(c.done)));
            }
          }}
        />
      ) : null}
      {sheet ? <SheetHost kind={sheet} onSwitch={setSheet} onClose={() => setSheet(null)} /> : null}
    </View>
  );
}

function SheetHost({
  kind,
  onSwitch,
  onClose,
}: {
  kind: ChannelSheetKind;
  onSwitch(k: ChannelSheetKind): void;
  onClose(): void;
}): ReactElement {
  const channels = useScreenQuery<{ channels: never[] }>(SIDE_SCREEN, "channels", {});
  const agents = useScreenQuery<{ agents: never[] }>("chats.all-agents", "agents", {});
  return (
    <ChannelSheets
      kind={kind}
      channels={(channels.status === "ready" ? channels.data.channels : []) as never}
      agents={(agents.status === "ready" ? agents.data.agents : []) as never}
      onSwitch={onSwitch}
      onClose={onClose}
    />
  );
}

/** The first minute: no headings, one invitation. */
function EmptyInvite({ canChat, onStart }: { canChat: boolean; onStart(): void }): ReactElement {
  return (
    <View testID="sidebar-empty" style={st.empty}>
      <Text style={st.emptyTitle}>Ask your Assistant</Text>
      <Text style={st.emptyText}>
        Start a chat. It keeps what you decide, and your team joins when you invite them.
      </Text>
      {canChat ? (
        <Pressable accessibilityRole="button" testID="start-chat" onPress={onStart} style={st.go}>
          <Text style={st.goText}>Start a chat</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export { FILTER_CHOICES, MoreRow };

const st = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  top: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 2,
    paddingHorizontal: 8,
    height: 28,
    alignItems: "center",
  },
  list: { flex: 1, minHeight: 0 },
  foot: { paddingHorizontal: 0, paddingTop: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  setup: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4, alignItems: "flex-start" },
  showing: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, height: 26 },
  showingText: { flex: 1, fontSize: 12, color: "var(--ink-3)" as string },
  showAll: { fontSize: 12, fontWeight: "600", color: "var(--accent)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string, padding: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  emptyText: { fontSize: 12.5, textAlign: "center", color: "var(--ink-3)" as string },
  go: {
    marginTop: 8,
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 8,
    backgroundColor: "var(--accent)" as string,
    justifyContent: "center",
  },
  goText: { color: "var(--accent-ink)" as string, fontWeight: "600", fontSize: 13 },
});
