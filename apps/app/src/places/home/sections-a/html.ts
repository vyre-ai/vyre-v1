// String markup helpers for Home sections. Shared ui components render their own boxes.

export function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Reserved block while a live query has no snapshot yet. Height matches a short row list. */
export function skeleton(id: string, rows: number): string {
  return `<div data-skeleton="${esc(id)}" data-rows="${rows}" style="min-height:${rows * 48}px"></div>`;
}

export function section(id: string, title: string, body: string, attrs = ""): string {
  return `<section data-section="${esc(id)}" data-source="replica" data-kbd="Enter" data-hover="section"${attrs}><h2>${esc(title)}</h2>${body}</section>`;
}
