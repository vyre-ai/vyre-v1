// Records sidebar (spec 3.4, ARCH 7.4).
// Grouped record types, a Sites group for site tables, and saved views.
// Agents, Projects and Journeys list only the ones the caller is in.
// Record types and Schema map are read-only here. Sync from an app opens in the Console.

import { liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import { ListSectionsPlaceholder } from "../../../../../../ui/src/ListSections/Placeholder.tsx";
import { RowPlaceholder } from "../../../../../../ui/src/Row/Placeholder.tsx";
import { isMembershipType, sidebarSections } from "./model.ts";
import type { MemberKind, SidebarMember, SidebarSection, SidebarType } from "./model.ts";

export interface SidebarState {
  type: string;
}

export const SIDEBAR_LINKS = [
  { screen: "records.types", label: "Record types" },
  { screen: "records.schema-map", label: "Schema map" },
] as const;

export const SYNC_LABEL = "Sync from an app";

const SECTIONS: readonly SidebarSection[] = ["personal", "shared", "space"];

export function renderSidebar(replica: FakeReplica, state: SidebarState): string {
  const types: SidebarType[] = [];
  const members: SidebarMember[] = [];
  let loading = false;

  for (const section of SECTIONS) {
    const listed = readTypes(replica, section);
    if (listed === null) loading = true;
    else {
      for (const type of listed) types.push(type);
    }
    const agents = readAgents(replica, section);
    if (agents === null) loading = true;
    else {
      for (const agent of agents) members.push(agent);
    }
  }

  const projects = readProjects(replica);
  if (projects === null) loading = true;
  else {
    for (const project of projects) members.push(project);
  }

  const journeys = readJourneys(replica);
  if (journeys === null) loading = true;
  else {
    for (const journey of journeys) members.push(journey);
  }

  const sections = sidebarSections(types, members);
  const status = loading ? "loading" : "ready";
  const list = ListSectionsPlaceholder({ type: "records", sections });
  const views = savedViews(replica, state.type);
  const links = readonlyLinks();
  return `<nav data-records-sidebar data-type="records" data-status="${status}" data-selected="${esc(state.type)}">${list}${views}${links}</nav>`;
}

function readTypes(replica: FakeReplica, section: SidebarSection): SidebarType[] | null {
  const snap = liveQuery(replica, "schema.types.list", { section }).getSnapshot();
  if (snap.status !== "ready") return null;
  const out: SidebarType[] = [];
  for (const type of snap.data.types) {
    const row: SidebarType = {
      key: type.key,
      title: type.title,
      section,
    };
    if (type.group !== undefined) row.group = type.group;
    if (type.scope !== undefined) row.scope = type.scope;
    if (isMembershipType(row)) continue;
    out.push(row);
  }
  return out;
}

function readAgents(replica: FakeReplica, section: SidebarSection): SidebarMember[] | null {
  const snap = liveQuery(replica, "agents.list", { section }).getSnapshot();
  if (snap.status !== "ready") return null;
  const out: SidebarMember[] = [];
  for (const agent of snap.data.agents) {
    out.push({ id: agent.agentId, title: agent.name, kind: "agent", section });
  }
  return out;
}

function readProjects(replica: FakeReplica): SidebarMember[] | null {
  const snap = liveQuery(replica, "projects.list", { mine: true }).getSnapshot();
  if (snap.status !== "ready") return null;
  const out: SidebarMember[] = [];
  for (const project of snap.data.projects) {
    out.push(member(project.projectId, project.title, "project"));
  }
  return out;
}

function readJourneys(replica: FakeReplica): SidebarMember[] | null {
  const snap = liveQuery(replica, "journeys.list", {}).getSnapshot();
  if (snap.status !== "ready") return null;
  const out: SidebarMember[] = [];
  for (const journey of snap.data.journeys) {
    out.push(member(journey.id, journey.name, "journey"));
  }
  return out;
}

function member(id: string, title: string, kind: MemberKind): SidebarMember {
  return { id, title, kind, section: "space" };
}

function savedViews(replica: FakeReplica, type: string): string {
  if (type.length === 0) {
    return `<section data-saved-views data-status="empty"><h2>Saved views</h2><p>No saved views</p></section>`;
  }
  const snap = liveQuery(replica, "views.list", { type }).getSnapshot();
  if (snap.status !== "ready") {
    return `<section data-saved-views data-status="loading" data-for="${esc(type)}"><h2>Saved views</h2></section>`;
  }
  if (snap.data.views.length === 0) {
    return `<section data-saved-views data-status="empty" data-for="${esc(type)}"><h2>Saved views</h2><p>No saved views</p></section>`;
  }
  const rows: string[] = [];
  for (const view of snap.data.views) {
    rows.push(RowPlaceholder({ id: view.viewId, title: view.title, note: view.kind }));
  }
  return `<section data-saved-views data-status="ready" data-for="${esc(type)}" data-count="${snap.data.views.length}"><h2>Saved views</h2>${rows.join("")}</section>`;
}

function readonlyLinks(): string {
  const links: string[] = [];
  for (const link of SIDEBAR_LINKS) {
    links.push(`<a data-screen="${esc(link.screen)}" data-readonly="true">${esc(link.label)}</a>`);
  }
  links.push(`<a data-flow="console" data-readonly="true">${esc(SYNC_LABEL)}</a>`);
  return `<nav data-readonly="true">${links.join("")}</nav>`;
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
