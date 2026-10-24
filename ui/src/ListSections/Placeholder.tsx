// Labelled box for ui/ListSections. Three sections, each row full width.

import { sectionsInOrder } from "./props.ts";
import type { ListSectionsProps } from "./props.ts";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function labelledBox(name: string, label: string, body: string): string {
  return `<div data-placeholder="${esc(name)}" data-label="${esc(label)}" aria-label="${esc(label)}"><span data-label>${esc(label)}</span>${body}</div>`;
}

export function ListSectionsPlaceholder(props: ListSectionsProps): string {
  const sections = sectionsInOrder(props.sections).map((section) => {
    const rows = section.rows.map((row) => {
      const note = row.note ? `<span data-note>${esc(row.note)}</span>` : "";
      return `<div data-row="ui/Row" data-id="${esc(row.id)}" data-width="100%">${esc(row.title)}${note}</div>`;
    }).join("");
    return `<section data-section="${esc(section.name)}" data-count="${section.rows.length}"><h2>${esc(section.name)}</h2>${rows}</section>`;
  }).join("");
  return labelledBox("ListSections", props.type, `<div data-type="${esc(props.type)}">${sections}</div>`);
}
