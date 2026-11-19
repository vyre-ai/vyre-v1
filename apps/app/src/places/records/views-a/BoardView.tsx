// Records > board (spec 3.4, 2.9, rc.41): a type's records as columns of cards, one column per option of a status or choice field. Each column's head says how many cards, against its WIP limit,
// their value, the stage's time limit and how many are late. A card moves by drag (lifted, with a placeholder where it will land), by Alt and the arrows, from its menu, or in a group from the
// bar over a selection; stages that want fields ask for them on the card; a refusal puts its reason on the card; Z puts the last move back. The move itself is one state machine
// (board/machine.ts): two people on one card, a gate that changed mid-drag, and an Automation moving the card during a drag each have one answer. Bands (swimlanes) split the board by owner or
// any field. Every lane asks the local copy for its own page of cards and its own count, and a long lane draws only what is on screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Face, Glyph } from "../sidebar/parts.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { isPhoneWidth } from "../../../../../../ui/src/SidePane/layout.ts";
import { ColumnsSheet } from "./ColumnsSheet.tsx";
import { useLive, useRecordsData } from "../sidebar/data.tsx";
import type { RecordsData } from "../sidebar/data.tsx";
import { useRecordsState } from "../sidebar/state.tsx";
import { toSaved } from "../table/model.ts";
import { fillAndMove, GateError } from "../journey/model.ts";
import type { Entered, MissingField } from "../journey/model.ts";
import {
  cardFaceOf,
  chosenOf,
  each,
  isLaneField,
  LANE_W,
  laneFieldOf,
  laneOfRow,
  lanesOf,
  neighbour,
  shownLine,
  shownSpec,
  stagesOfView,
} from "./model.ts";
import type { CardFace, Clause, FieldDef, Lane, RecordRow } from "./model.ts";
import { ViewHead, useViewState } from "./view.tsx";
import type { ViewCtx } from "./view.tsx";
import { Cell } from "../board/Cell.tsx";
import { Hints, SelectBar, Toast } from "../board/Chrome.tsx";
import type { ToastLine } from "../board/Chrome.tsx";
import type { Board } from "../board/ctx.ts";
import { FacePanel } from "../board/FacePanel.tsx";
import { useSlide } from "../board/flip.ts";
import { ColumnHead, FinishStrip } from "../board/Head.tsx";
import { IDLE, movedWords, popUndo, pushUndo, step } from "../board/machine.ts";
import type { MoveEffect, MoveEvent, MoveState, Mover, Undoable } from "../board/machine.ts";
import { performMove, reasonOf, StaleError } from "../board/move.ts";
import { columnWidth, swimKeys } from "../board/stats.ts";
import { cardsWords } from "../board/face.ts";
import { useBoardStages, wipOf } from "../board/stages.ts";

const SWIM_BAND_H = 460;
/** Fields a board can make bands from. */
const swimmable = (f: FieldDef, lane: FieldDef, title: string): boolean =>
  f.key !== lane.key && f.key !== title && ["person", "choice", "status", "checkbox"].includes(f.type);

// ---------------------------------------------------------------- the people on a board's bands

/** A band's head: the name (a face for a person) and how many cards it holds. */
function BandHead({ board, swim, value }: { board: Board; swim: FieldDef; value: string }): ReactElement {
  const { ctx, st } = board;
  const clause: Clause = value === "" ? { field: swim.key, op: "empty" } : { field: swim.key, op: "eq", value };
  const n = useLive("records.counts", { type: ctx.type, filter: { and: [clause] } });
  void st;
  const count = n.status === "ready" ? n.data.count : 0;
  const title =
    value === ""
      ? `No ${swim.title.toLowerCase()}`
      : swim.type === "person"
        ? board.names(value)
        : ((swim as { options?: { choices?: { key: string; title: string }[] } }).options?.choices?.find(
            (c) => c.key === value,
          )?.title ?? value);
  return (
    <View style={s.bandHead} testID={`band-${value || "none"}`}>
      {swim.type === "person" && value !== "" ? <Face name={title} seedId={value} size={18} /> : null}
      <Text style={s.bandName}>{title}</Text>
      <Text style={s.bandCount}>{count.toLocaleString("en-US")}</Text>
    </View>
  );
}

/** The distinct values the bands are made from, read from the board's own records. */
function useBandKeys(board: Board, swim: FieldDef | null): string[] {
  const { ctx } = board;
  const q = useLive("records.query", { type: ctx.type, fields: swim ? [swim.key] : [ctx.def.titleField], limit: 500 });
  return useMemo(() => (swim && q.status === "ready" ? swimKeys(q.data.rows as RecordRow[], swim) : []), [swim, q]);
}

// ---------------------------------------------------------------- the count line of a board with chosen stages

/** How many of the view's records the chosen stages show. */
function ShownCount({ board, keys }: { board: Board; keys: readonly string[] }): ReactElement {
  const { ctx, st, field } = board;
  const some = useLive("records.counts", shownSpec(ctx.type, st.v, ctx.def.titleField, field, keys));
  const all = useLive("records.counts", shownSpec(ctx.type, st.v, ctx.def.titleField, field, null));
  const ready = some.status === "ready" && all.status === "ready";
  return (
    <Text style={s.shown} testID="board-count">
      {ready ? shownLine(some.data.count, all.data.count, ctx.def.plural, keys.length) : " "}
    </Text>
  );
}

// ---------------------------------------------------------------- the board

/** Who moved a card, read from the Space's directory by the actor's id: an Automation by its kind, never by the look of its id. */
const moverOf = (actor: string, d: RecordsData): Mover => {
  const a = d.actorOf?.(actor);
  if (!a) return { kind: "person", name: "Someone" };
  return a.kind === "automation"
    ? { kind: "automation", name: a.name }
    : { kind: "person", name: a.name.split(" ")[0] ?? a.name };
};

export function BoardView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const { dispatch } = useRecordsState();
  const [picked, setPicked] = useState<string | null>(null);
  // the stages the board draws: edited here, saved with the view; none chosen draws every stage
  const [stages, setStages] = useState<string[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<RecordRow | null>(null);
  const ids = useRef<Record<string, string[]>>({});
  const rows = useRef<Record<string, RecordRow>>({});
  const cellOf = useRef<Record<string, string>>({});
  const counts = useRef<Record<string, number>>({});
  const width = useWindowDimensions().width;
  const root = useRef<unknown>(null);
  const field = ctx.journey?.field ?? laneFieldOf(ctx.def, ctx.saved, picked);
  const savedStages = field ? chosenOf(field, stagesOfView(ctx.saved)) : [];
  const chosen = field && !ctx.journey ? chosenOf(field, stages ?? savedStages) : [];
  // a day is counted from a clock that moves once a minute
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  // the one move machine: its state in a ref (so two events in one tick both see the latest) and in state (so the board draws it)
  const mvRef = useRef<MoveState>(IDLE);
  const [mv, setMv] = useState<MoveState>(IDLE);
  const [toast, setToast] = useState<ToastLine | null>(null);
  const undo = useRef<Undoable[]>([]);
  const undoing = useRef<Undoable | null>(null);
  const groupBusy = useRef(false);
  const toastId = useRef(0);
  const say = useCallback((text: string, canUndo = false): void => {
    toastId.current += 1;
    setToast({ id: toastId.current, text, undo: canUndo });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const t = setTimeout(() => setToast((x) => (x && x.id === id ? null : x)), toast.undo ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);
  // selection, focus, bands, open finish lines, the face being edited, the keys list
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [focus, setFocusId] = useState<string | null>(null);
  const [swimKey, setSwimKey] = useState<string | null>(() => {
    const k = ctx.saved?.config?.["swim"];
    return typeof k === "string" ? k : null;
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [faceOpen, setFaceOpen] = useState(false);
  const [localFace, setLocalFace] = useState<CardFace | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [boxW, setBoxW] = useState(0);
  // a Journey's board starts on the Detailed face (owner, amount, days in the stage); an ordinary board on the plain one
  const face =
    localFace ??
    cardFaceOf(ctx.def, ctx.saved, ctx.journey ? { preset: "detail", fields: null, mark: true } : undefined);
  const own = field ? lanesOf(field, chosen) : [];
  const lanes = useMemo(
    () => [...own.filter((l) => l.none), ...own.filter((l) => !l.none)],
    [own.map((l) => l.key).join("|")],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const wip = wipOf(ctx.saved);
  const bs = useBoardStages(data.call, ctx.journey?.journeyId, lanes, wip);
  const swim =
    field && swimKey
      ? (ctx.def.fields.find((f) => f.key === swimKey && swimmable(f, field, ctx.def.titleField)) ?? null)
      : null;
  // when each drawn card entered its stage (journeys.stage_since): asked for in batches, again every half minute; a card with no answer shows no day and no late mark
  const [since, setSince] = useState<Record<string, number>>({});
  const asked = useRef(new Set<string>());
  const jid = ctx.journey?.journeyId;
  useEffect(() => {
    if (!jid) return;
    const t = setInterval(() => asked.current.clear(), 30_000);
    return () => clearInterval(t);
  }, [jid]);
  useEffect(() => {
    if (!jid) return;
    const miss = Object.keys(rows.current).filter((id) => !asked.current.has(id));
    for (let i = 0; i < miss.length; i += 200) {
      const chunk = miss.slice(i, i + 200);
      for (const id of chunk) asked.current.add(id);
      data
        .call("journeys.stage_since", { journeyId: jid, recordIds: chunk })
        .then((o) => setSince((c) => ({ ...c, ...(o as { since: Record<string, number> }).since })))
        .catch(() => undefined);
    }
  });
  const ownerField = ctx.def.fields.find((f) => f.type === "person") ?? null;
  // ------------------------------------------------ moves
  const send = useCallback((e: MoveEvent): void => {
    const r = step(mvRef.current, e);
    mvRef.current = r.state;
    setMv(r.state);
    if (r.effect) runRef.current(r.effect);
  }, []);
  const runRef = useRef<(ef: MoveEffect) => void>(() => undefined);
  const sendRef = useRef(send);
  sendRef.current = send;
  const ctxRef = useRef({ ctx, field, lanes, data, bs });
  ctxRef.current = { ctx, field, lanes, data, bs };
  const titleOf = (r: RecordRow): string => String(r.fields[ctx.def.titleField] ?? "") || "Untitled";
  /** Find out who moved a card (the last stage change in its activity) and tell the machine. */
  const resolveMover = (id: string, to: string): void => {
    data
      .call("records.activity", { type: ctx.type, recordId: id, limit: 5 })
      .then((o) => {
        const e = (o as { entries: { kind: string; actor: string; field?: string }[] }).entries.find(
          (x) => x.kind === "stage" || x.field === ctxRef.current.field?.key,
        );
        if (e) sendRef.current({ t: "remote", id, to, by: moverOf(e.actor, data) });
      })
      .catch(() => undefined);
  };
  /** The machine's one effect: make the call, then tell the machine what came back. */
  const run = (ef: MoveEffect): void => {
    if (ef.t === "say") {
      say(ef.text);
      return;
    }
    const c = ctxRef.current;
    const row = rows.current[ef.id];
    const to = c.lanes.find((l) => l.key === ef.to);
    if (!row || !c.field || !to) {
      sendRef.current({ t: "refuse", reason: "That card is not on the board any more." });
      return;
    }
    const from = laneOfRow(c.field, row, c.lanes);
    const field = c.field;
    const version = ef.version ?? row.version;
    const pending = ef.via === "undo" ? undoing.current : null;
    // an undo only puts a card back from where the move left it
    if (pending && pending.moves[0] && pending.moves[0].to !== from.key) {
      undo.current = pushUndo(undo.current, pending);
      undoing.current = null;
      sendRef.current({ t: "refuse", reason: "It has moved since. Nothing was put back." });
      return;
    }
    // a call that never answers frees the board after 20 s
    const stuck = setTimeout(() => sendRef.current({ t: "timeout" }), 20_000);
    performMove(c.data, c.ctx.type, field, c.ctx.journey, row, to, version).then(
      (did) => {
        clearTimeout(stuck);
        undoing.current = null;
        sendRef.current({ t: "ok" });
        if (!did) return;
        c.bs.refresh();
        asked.current.delete(row.id);
        if (ef.via !== "undo")
          undo.current = pushUndo(undo.current, { moves: [{ id: row.id, from: from.key, to: to.key }] });
        const info = c.bs.by[to.key];
        const over = info?.wip !== undefined && (counts.current[to.key] ?? 0) >= info.wip;
        say(
          `Moved ${titleOf(row)} to ${to.title}${over ? `. ${to.title} is over its limit of ${info?.wip}` : ""}.`,
          ef.via !== "undo",
        );
      },
      (e: unknown) => {
        clearTimeout(stuck);
        // a refused undo is not lost: it goes back on the stack
        if (pending) undo.current = pushUndo(undo.current, pending);
        undoing.current = null;
        if (e instanceof GateError) sendRef.current({ t: "gate", missing: e.missing });
        else if (e instanceof StaleError && e.kind === "moved") {
          sendRef.current({ t: "remote", id: row.id, to: e.stage, by: { kind: "person", name: "Someone" } });
          resolveMover(row.id, e.stage);
          sendRef.current({ t: "refuse", reason: e.message });
        } else sendRef.current({ t: "refuse", reason: reasonOf(e) });
      },
    );
  };
  runRef.current = run;
  /** Moves from a menu, the bar, or a key: one card goes through the machine, a group goes one after another and stops at the first refusal. */
  const moveTo = (list: readonly RecordRow[], to: Lane, via: "menu" | "bar" | "key"): void => {
    if (!field || list.length === 0) return;
    setError(null);
    if (list.length === 1) {
      const row = list[0]!;
      send({ t: "start", id: row.id, from: laneOfRow(field, row, lanes).key, to: to.key, via, version: row.version });
      return;
    }
    if (groupBusy.current || mvRef.current.kind === "committing" || mvRef.current.kind === "needs") {
      say("One move at a time. Try again in a moment.");
      return;
    }
    groupBusy.current = true;
    const done: { id: string; from: string; to: string }[] = [];
    void (async () => {
      try {
        for (const row of list) {
          const from = laneOfRow(field, row, lanes);
          try {
            if (await performMove(data, ctx.type, field, ctx.journey, row, to))
              done.push({ id: row.id, from: from.key, to: to.key });
          } catch (e) {
            const why =
              e instanceof GateError
                ? `${titleOf(row)} needs ${e.missing.map((m) => m.title.toLowerCase()).join(", ")} first.`
                : reasonOf(e);
            if (done.length > 0) undo.current = pushUndo(undo.current, { moves: done });
            bs.refresh();
            say(`Moved ${done.length} of ${list.length}. ${why}`, done.length > 0);
            return;
          }
        }
        if (done.length > 0) undo.current = pushUndo(undo.current, { moves: done });
        bs.refresh();
        setSelected(new Set());
        say(`Moved ${cardsWords(list.map(titleOf), ctx.def.plural)} to ${to.title}.`, done.length > 0);
      } finally {
        groupBusy.current = false;
      }
    })();
  };
  const undoLast = (): void => {
    const p = popUndo(undo.current);
    undo.current = p.rest;
    if (!p.top || !field) {
      say("Nothing to undo.");
      return;
    }
    setToast(null);
    const list = p.top.moves;
    const rowsBack = list
      .map((m) => ({ m, row: rows.current[m.id], lane: lanes.find((l) => l.key === m.from) }))
      .filter((x) => x.row && x.lane);
    if (rowsBack.length === 1) {
      const x = rowsBack[0]!;
      undoing.current = p.top;
      send({
        t: "start",
        id: x.row!.id,
        from: laneOfRow(field, x.row!, lanes).key,
        to: x.lane!.key,
        via: "undo",
        version: x.row!.version,
      });
      return;
    }
    if (groupBusy.current || mvRef.current.kind === "committing" || mvRef.current.kind === "needs") {
      undo.current = pushUndo(undo.current, p.top);
      say("One move at a time. Try again in a moment.");
      return;
    }
    groupBusy.current = true;
    void (async () => {
      let ok = 0;
      const left: { id: string; from: string; to: string }[] = [];
      try {
        for (const x of rowsBack) {
          // a card that has moved since is left where it is
          if (laneOfRow(field, x.row!, lanes).key !== x.m.to) {
            left.push(x.m);
            continue;
          }
          try {
            if (await performMove(data, ctx.type, field, ctx.journey, x.row!, x.lane!)) ok++;
          } catch {
            left.push(x.m);
          }
        }
      } finally {
        groupBusy.current = false;
      }
      if (left.length > 0) undo.current = pushUndo(undo.current, { moves: left });
      bs.refresh();
      say(
        left.length === 0 ? "Undone." : `Put back ${ok} of ${rowsBack.length}. The others changed first.`,
        left.length > 0,
      );
    })();
  };
  /** The fields a card's form saved: write them and move the card, in one step. */
  const fieldsDone = async (entered: Entered): Promise<string | null> => {
    const m = mvRef.current;
    if (m.kind !== "needs" || !field) return null;
    const row = rows.current[m.id];
    if (!row) return "That card is not on the board any more.";
    const res = await fillAndMove(data.call, {
      ...(ctx.journey ? { journeyId: ctx.journey.journeyId } : { plainField: field.key }),
      type: ctx.type,
      row,
      def: ctx.def,
      missing: m.missing as readonly MissingField[],
      entered,
      toStage: m.to,
    });
    if (res.ok) {
      send({ t: "ok" });
      bs.refresh();
      undo.current = pushUndo(undo.current, { moves: [{ id: row.id, from: m.from, to: m.to }] });
      say(`Moved ${titleOf(row)} to ${lanes.find((l) => l.key === m.to)?.title ?? m.to}.`, true);
      return null;
    }
    if (res.missing) mvRef.current = { ...m, missing: res.missing };
    setMv(mvRef.current);
    return res.message;
  };
  // someone else (or an Automation) moved the card we hold or are moving: tell the machine, then find out who
  useEffect(() => {
    const m = mvRef.current;
    if (m.kind === "idle" || m.kind === "refused" || m.kind === "conflict" || !field) return;
    const row = rows.current[m.id];
    if (!row) return;
    const actual = laneOfRow(field, row, lanes).key;
    const seen =
      (m.kind === "lifted" && actual !== m.from && m.moved === null) ||
      (m.kind === "committing" && actual !== m.from && actual !== m.to && m.remote === null) ||
      (m.kind === "needs" && actual !== m.from);
    if (!seen) return;
    const first: Mover = { kind: "person", name: "Someone" };
    send({ t: "remote", id: m.id, to: actual, by: first });
    resolveMover(m.id, actual);
  });
  useSlide(root, cellOf);
  // a card someone else moved says so on the card, and in the toast too: the card may sit in a closed finish line where it has no face to say it on
  useEffect(() => {
    if (mv.kind !== "conflict") return;
    say(movedWords(mv.by, lanes.find((l) => l.key === mv.at)?.title ?? "another stage"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mv]);
  // ------------------------------------------------ selection and keys
  const setFocus = (id: string | null): void => setFocusId(id);
  const toggle = (id: string, on?: boolean): void => {
    anchor.current = id;
    setSelected((cur) => {
      const next = new Set(cur);
      const want = on ?? !cur.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const range = (id: string): void => {
    const a = anchor.current;
    const cell = cellOf.current[id];
    const list = cell ? (ids.current[cell] ?? []) : [];
    const from = a ? list.indexOf(a) : -1;
    const to = list.indexOf(id);
    if (from < 0 || to < 0) {
      toggle(id, true);
      return;
    }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelected((cur) => new Set([...cur, ...list.slice(lo, hi + 1)]));
  };
  const clearSelection = (): void => {
    setSelected(new Set());
    anchor.current = null;
  };
  const addAt = (lane: Lane, at: { x: number; y: number }): void => {
    setError(null);
    ctx.journey
      ?.addChoices(lane.key, (message) => {
        if (message) setError(message);
        else bs.refresh();
      })
      .then((items) => menu.show(items, at.x, at.y, "other"))
      .catch(() => setError("Could not load the records to add."));
  };
  const quickAdd = async (lane: Lane, name: string, band?: string | null): Promise<void> => {
    if (!field) return;
    setError(null);
    const fields: Record<string, unknown> = {
      [ctx.def.titleField]: name,
      [field.key]: lane.key,
      ...(swim && band ? { [swim.key]: band } : {}),
    };
    try {
      await data.call("records.create", {
        type: ctx.type,
        fields,
        idempotencyKey: `board-new-${ctx.type}-${Date.now()}`,
      });
      say(`Added ${name} to ${lane.title}.`);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not add it. Try again.");
    }
  };
  const enteredAt = (r: RecordRow): number | undefined => since[r.id];
  const toggleFinish = (key: string): void =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // what the view keeps of this board, written once (the face, the bands, the WIP limits)
  const mine = useRef<Record<string, unknown>>({});
  const ownView = useRef<string | undefined>(ctx.saved?.shared === true ? undefined : ctx.saved?.viewId);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saveSeq = useRef(0);
  const faceOpenRef = useRef(false);
  faceOpenRef.current = faceOpen;
  const persist = (extra: Record<string, unknown>): void => {
    mine.current = { ...mine.current, ...extra };
    const payload = toSaved(st.v);
    const keep: Record<string, unknown> = {};
    for (const k of ["card", "swim", "wip"]) if (ctx.saved?.config?.[k] !== undefined) keep[k] = ctx.saved.config[k];
    // saves go one after another, so the first one's id is there for the second (never two views from two quick changes); a shared (team) view is never rewritten: the person's own is made beside it
    const base = ctx.saved?.shared === true ? undefined : ctx.saved?.viewId;
    const cfg = { ...payload.config, ...keep, ...mine.current };
    saving.current = saving.current.then(() =>
      data
        .call("views.save", {
          type: ctx.type,
          ...((ownView.current ?? base) ? { viewId: ownView.current ?? base } : {}),
          kind: "board",
          title:
            ctx.saved?.shared === true
              ? `My ${ctx.def.plural.toLowerCase()} board`
              : (ctx.saved?.title ?? `${ctx.def.plural} board`),
          ...payload,
          config: cfg,
          idempotencyKey: `view-${ctx.type}-${++saveSeq.current}-${Date.now()}`,
        })
        .then((out) => {
          const id = (out as { view?: { viewId?: string } } | undefined)?.view?.viewId;
          if (id && !ownView.current) {
            ownView.current = id;
            if (!faceOpenRef.current && (!ctx.saved || ctx.saved.shared === true))
              dispatch({ type: "view", viewId: id });
          }
        })
        .catch(() => setError("Could not save the view.")),
    );
  };
  // the board the person is looking at becomes their own view once the editor is closed, so the face they chose is what opens next time
  useEffect(() => {
    if (!faceOpen && ownView.current && (!ctx.saved || ctx.saved.shared === true))
      dispatch({ type: "view", viewId: ownView.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceOpen]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // a change made just before leaving is kept
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        persistRef.current({});
      }
    },
    [],
  );
  const persistSoon = (extra: Record<string, unknown>): void => {
    mine.current = { ...mine.current, ...extra };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist({}), 400);
  };
  const setWip = (lane: Lane, n: number | null): void => {
    const next = { ...wip };
    if (n === null) delete next[lane.key];
    else next[lane.key] = n;
    persist({ wip: next });
  };
  const assign = (who: string | null): void => {
    if (!ownerField) return;
    const list = [...selected].map((id) => rows.current[id]).filter((r): r is RecordRow => r !== undefined);
    void (async () => {
      for (const r of list)
        await data.call("records.update", {
          type: ctx.type,
          recordId: r.id,
          patch: { [ownerField.key]: who },
          baseVersion: r.version,
        });
    })().then(
      () => {
        clearSelection();
        say(who ? `Assigned ${list.length} to ${data.nameOf(who)}.` : `Took the owner off ${list.length}.`);
      },
      (e: unknown) => setError(reasonOf(e)),
    );
  };

  const swimEntries = (): MenuEntry[] =>
    !field
      ? []
      : [
          { head: "Swimlanes" },
          {
            label: "None",
            checked: swim === null,
            onSelect: () => {
              setSwimKey(null);
              persistSoon({ swim: null });
            },
          },
          ...each(
            ctx.def.fields.filter((f) => swimmable(f, field, ctx.def.titleField)),
            (f): MenuEntry => ({
              label: f.title,
              checked: swim?.key === f.key,
              onSelect: () => {
                setSwimKey(f.key);
                persistSoon({ swim: f.key });
              },
            }),
          ),
        ];
  const headTools = field ? (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={swim ? `Swimlanes by ${swim.title}` : "Swimlanes"}
        testID="board-swim"
        onPress={(e) => {
          const p = (e as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
          menu.show(swimEntries(), p?.pageX ?? 0, p?.pageY ?? 0, "other");
        }}
        style={({ hovered }: { hovered?: boolean }) => [s.tool, swim && s.toolOn, hovered === true && s.toolOver]}
      >
        <Glyph name="lanes" size={14} color="var(--ink-2)" />
        <Text style={s.toolText}>{swim ? `Swimlanes: ${swim.title}` : "Swimlanes"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="board-face"
        onPress={() => setFaceOpen((o) => !o)}
        style={({ hovered }: { hovered?: boolean }) => [s.tool, faceOpen && s.toolOn, hovered === true && s.toolOver]}
      >
        <Glyph name="card" size={14} color="var(--ink-2)" />
        <Text style={s.toolText}>Card face</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo the last move"
        testID="board-undo-button"
        onPress={undoLast}
        style={({ hovered }: { hovered?: boolean }) => [s.tool, hovered === true && s.toolOver]}
      >
        <Glyph name="undo" size={14} color="var(--ink-2)" />
      </Pressable>
    </>
  ) : null;
  const head = (
    <ViewHead
      ctx={ctx}
      st={st}
      extra={headTools}
      lanes={{
        field,
        choices: ctx.journey ? [ctx.journey.field] : ctx.def.fields.filter(isLaneField),
        pick: (key) => {
          setPicked(key);
          setStages([]);
        },
        ...(field && !ctx.journey
          ? {
              stages: {
                chosen,
                total: lanesOf(field).filter((l) => !l.none).length,
                edited: JSON.stringify(chosen) !== JSON.stringify(savedStages),
                open: () => setChoosing(true),
                reset: () => setStages(null),
              },
            }
          : {}),
      }}
    />
  );
  if (!field) {
    const choices = ctx.def.fields.filter(isLaneField);
    return (
      <View style={s.main} testID="records-board">
        {head}
        <States
          kind="empty"
          title={
            choices.length > 0
              ? "Pick a field to group by."
              : `${ctx.def.plural} have no status or choice field to make lanes from.`
          }
          icon="records"
        />
      </View>
    );
  }
  const isFinish = (l: Lane): boolean => !l.none && bs.by[l.key]?.final === true && !expanded.has(l.key);
  // columns share the width the board has, between 184 and 280 px each; a phone shows one column and a peek of the next
  const strips = lanes.filter(isFinish).length;
  const laneWidth = isPhoneWidth(width)
    ? Math.max(220, width - 56)
    : columnWidth(boxW, lanes.filter((l) => !l.none || (counts.current[l.key] ?? 0) > 0).length, strips);
  const board: Board = {
    ctx,
    st,
    field,
    lanes,
    stages: bs.by,
    late: bs.late,
    face,
    swim,
    now,
    move: mv,
    send,
    selected,
    focus,
    setFocus,
    toggle,
    range,
    clearSelection,
    ids,
    rows,
    cellOf,
    counts,
    moveTo,
    open: data.nav.openRecord,
    show: menu.show,
    enteredAt,
    names: data.nameOf,
    addAt,
    quickAdd,
    expanded,
    toggleFinish,
    drag,
    fieldsDone,
    call: data.call,
    canEditType: data.canEditSchema === true,
    owner: ownerField,
    limitMenu: (l, at) => menu.show(wipEntries(l), at.x, at.y, "other"),
  };

  const cellsOf = (band: string | null, h?: number): ReactElement[] =>
    each(lanes, (l) =>
      isFinish(l) ? (
        <FinishStrip key={l.key} board={board} lane={l} />
      ) : (
        <Cell
          key={l.key || "none"}
          board={board}
          lane={l}
          width={laneWidth}
          swimKey={band}
          {...(h ? { maxHeight: h } : {})}
        />
      ),
    );
  const heads = each(lanes, (l) =>
    isFinish(l) ? (
      <View key={l.key} style={s.stripGap} />
    ) : (
      <ColumnHead key={l.key || "none"} board={board} lane={l} width={laneWidth} />
    ),
  );
  const bands = swim ? <Bands board={board} swim={swim} cellsOf={cellsOf} /> : null;

  const onKeyDown = (ev: {
    key?: string;
    altKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    target?: unknown;
    preventDefault?: () => void;
  }): void => {
    const t = ev.target as { tagName?: string; isContentEditable?: boolean } | undefined;
    if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable === true) return;
    const key = ev.key;
    if (key === "?") {
      setKeysOpen((o) => !o);
      return;
    }
    if (key === "z" || key === "Z") {
      ev.preventDefault?.();
      undoLast();
      return;
    }
    if (key === "Escape") {
      if (mvRef.current.kind === "refused" || mvRef.current.kind === "conflict") send({ t: "dismiss" });
      else if (selected.size > 0) clearSelection();
      return;
    }
    const arrows = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (key !== " " && key !== "Enter" && !(key && arrows.includes(key))) return;
    const here = focus ? cellOf.current[focus] : undefined;
    if (!focus || !here) {
      const id = Object.values(ids.current).find((l) => l.length > 0)?.[0];
      if (id && key !== "Enter") {
        ev.preventDefault?.();
        setFocus(id);
      }
      return;
    }
    const [laneKey, band] = here.split("\u0001") as [string, string | undefined];
    const list = ids.current[here] ?? [];
    const at = list.indexOf(focus);
    ev.preventDefault?.();
    if (key === " ") {
      toggle(focus);
      return;
    }
    if (key === "Enter") {
      data.nav.openRecord(focus);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      const next = list[Math.max(0, Math.min(list.length - 1, at + (key === "ArrowDown" ? 1 : -1)))];
      if (next) setFocus(next);
      return;
    }
    const dir = key === "ArrowRight" ? 1 : -1;
    if (ev.altKey === true) {
      const to = neighbour(lanes, laneKey, dir, () => true);
      const row = rows.current[focus];
      if (!to || !row) return;
      moveTo(
        selected.has(focus) && selected.size > 1
          ? [...selected].map((i) => rows.current[i]).filter((r): r is RecordRow => !!r)
          : [row],
        to,
        "key",
      );
      return;
    }
    const shown = (l: Lane): boolean => !l.none || (counts.current[l.key] ?? 0) > 0;
    const keyOf = (l: Lane): string => (band === undefined ? l.key : `${l.key}\u0001${band}`);
    let to = neighbour(lanes, laneKey, dir, shown);
    while (to && (ids.current[keyOf(to)] ?? []).length === 0) to = neighbour(lanes, to.key, dir, shown);
    const next = to
      ? (ids.current[keyOf(to)] ?? [])[Math.min(at, (ids.current[keyOf(to)] ?? []).length - 1)]
      : undefined;
    if (next) setFocus(next);
  };

  const wipEntries = (l: Lane): MenuEntry[] => [
    { head: `${l.title} limit` },
    ...each(
      [3, 5, 8, 10, 15, 20],
      (n): MenuEntry => ({ label: `${n} cards`, checked: wip[l.key] === n, onSelect: () => setWip(l, n) }),
    ),
    { separator: true },
    { label: "No limit", checked: wip[l.key] === undefined, onSelect: () => setWip(l, null) },
  ];

  return (
    <View style={s.main} testID="records-board" accessibilityLabel={`${ctx.def.plural} board`}>
      {head}
      {error ? (
        <Text style={s.error} accessibilityRole="alert" testID="board-error">
          {error}
        </Text>
      ) : null}
      {chosen.length > 0 ? <ShownCount board={board} keys={chosen} /> : null}
      <SelectBar board={board} onAssign={ownerField ? assign : null} />
      <View
        ref={root as never}
        testID="board-sheet"
        style={s.sheet}
        onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}
        {...({ onKeyDown } as object)}
      >
        <ScrollView horizontal style={s.lanes} contentContainerStyle={s.lanesIn} testID="board-lanes">
          <View style={s.inner}>
            <View style={s.headRow} testID="board-heads">
              {heads}
            </View>
            {swim ? bands : <View style={s.row}>{cellsOf(null)}</View>}
          </View>
        </ScrollView>
        {faceOpen ? (
          <FacePanel
            board={board}
            onClose={() => setFaceOpen(false)}
            onDraft={setLocalFace}
            onPersist={(next, who) => {
              if (who === "me")
                persistSoon({ card: { preset: next.preset, fields: next.fields ?? [], mark: next.mark } });
            }}
          />
        ) : null}
        <Toast line={toast} onUndo={undoLast} onClose={() => setToast(null)} />
      </View>
      <Hints open={keysOpen} onToggle={() => setKeysOpen((o) => !o)} />
      {menu.element}
      {choosing ? (
        <ColumnsSheet field={field} chosen={chosen} onChange={setStages} onClose={() => setChoosing(false)} />
      ) : null}
    </View>
  );
}

/** One band of cards per value of the swimlane field, each with its own row of columns. */
function Bands({
  board,
  swim,
  cellsOf,
}: {
  board: Board;
  swim: FieldDef;
  cellsOf: (band: string | null, h?: number) => ReactElement[];
}): ReactElement {
  const keys = useBandKeys(board, swim);
  return (
    <ScrollView style={s.bands} testID="board-bands">
      {each(keys, (k) => (
        <View key={k || "none"}>
          <BandHead board={board} swim={swim} value={k} />
          <View style={s.row}>{cellsOf(k, SWIM_BAND_H)}</View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  sheet: { flex: 1, minHeight: 0 },
  lanes: { flex: 1 },
  lanesIn: { padding: 16, height: "100%", minWidth: "100%" },
  inner: { flex: 1, minHeight: 0 },
  headRow: { flexDirection: "row", gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, flexShrink: 1, minHeight: 0, flex: 1 },
  bands: { flex: 1, minHeight: 0 },
  bandHead: { flexDirection: "row", alignItems: "center", gap: 8, height: 30, marginTop: 6, marginBottom: 4 },
  bandName: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  bandCount: { fontSize: 12, color: "var(--ink-3)" as string },
  stripGap: { width: 88 },
  tools: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 6 },
  tool: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 8 },
  toolOn: { backgroundColor: "var(--hover)" as string },
  toolOver: { backgroundColor: "var(--hover)" as string },
  toolText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string, paddingHorizontal: 18, paddingVertical: 6 },
  shown: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingHorizontal: 18, paddingTop: 8 },
});
