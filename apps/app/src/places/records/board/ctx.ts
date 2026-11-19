// What the parts of the board share: the type and view, the lanes and their stages, the one move machine, the selection and the keys' bookkeeping. One object per render, built by BoardView.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { ViewCtx, ViewState } from "../views-a/view.tsx";
import type { CardFace, FieldDef, Lane, RecordRow } from "../views-a/model.ts";
import type { MoveEvent, MoveState } from "./machine.ts";
import type { StageInfo } from "./stats.ts";

export interface Board {
  ctx: ViewCtx;
  st: ViewState;
  /** The field the lanes run on. */
  field: FieldDef;
  lanes: readonly Lane[];
  stages: Readonly<Record<string, StageInfo>>;
  /** Server late counts per stage. */
  late: Readonly<Record<string, number>>;
  face: CardFace;
  /** The field that makes swimlanes, when one is chosen. */
  swim: FieldDef | null;
  now: number;
  /** The one move machine's state and its input. */
  move: MoveState;
  send: (e: MoveEvent) => void;
  /** The selection (Space, the corner tick, shift-click). */
  selected: ReadonlySet<string>;
  focus: string | null;
  setFocus: (id: string | null) => void;
  toggle: (id: string, on?: boolean) => void;
  range: (id: string) => void;
  clearSelection: () => void;
  /** Cards each lane drew, for the arrow keys; and every row seen, by id. */
  ids: { current: Record<string, string[]> };
  rows: { current: Record<string, RecordRow> };
  /** The field that says who owns a card (the first person field), when the type has one. */
  owner: FieldDef | null;
  /** The cell each card was drawn in (a lane's key, and its band's when there are bands). */
  cellOf: { current: Record<string, string> };
  counts: { current: Record<string, number> };
  /** A move asked for from a menu, the bar or a key (not a drag). */
  moveTo: (rows: readonly RecordRow[], to: Lane, via: "menu" | "bar" | "key") => void;
  open: (id: string) => void;
  show: (items: readonly MenuEntry[], x: number, y: number) => void;
  /** Stage start time of a card; the stand-in is the record's last change until the Journey tells it. */
  enteredAt: (r: RecordRow) => number | undefined;
  /** Whether this card is waiting on a person's typing right now (a form is open on it). */
  names: (id: string) => string;
  /** One capability call as the signed-in person. */
  call: (cap: string, input: unknown) => Promise<unknown>;
  /** May this person change the record type (the Everyone face)? */
  canEditType: boolean;
  /** The menu that sets a stage's WIP limit, opened at a point. */
  limitMenu: (lane: Lane, at: { x: number; y: number }) => void;
  /** A Journey board: the menu of subject records to start at a lane. */
  addAt: (lane: Lane, at: { x: number; y: number }) => void;
  /** Quick add: a name typed at the foot of a lane makes a record in that lane. */
  quickAdd: (lane: Lane, name: string, swim?: string | null) => Promise<void>;
  /** The open expanded finish lines. */
  expanded: ReadonlySet<string>;
  toggleFinish: (key: string) => void;
  /** The stage lanes are drawn collapsed when final and not expanded. */
  drag: { current: RecordRow | null };
  /** Hand the form on a card (stage wants fields) its saved result. */
  fieldsDone: (entered: Record<string, string | boolean>) => Promise<string | null>;
}
