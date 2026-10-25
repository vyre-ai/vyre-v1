// Records views, part A: Board, Gallery and List, and the one component that switches between them and the table.
export { RecordViews } from "./RecordViews.tsx";
export type { ExtraKind, RecordViewsProps } from "./RecordViews.tsx";
export { BoardView } from "./BoardView.tsx";
export { GalleryView } from "./GalleryView.tsx";
export { ListView } from "./ListView.tsx";
export { ViewHead, newRecord, useViewState } from "./view.tsx";
export type { KindDef, ViewCtx, ViewState } from "./view.tsx";
export { moveCard, moveError } from "./actions.ts";
export * from "./model.ts";
