import { useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { ObjectPage, ObjectSection, withBaseTabs } from "../../../../../ui/src/ObjectPage/index.tsx";
import { Group, Section } from "../shell/ui.tsx";
import { ObjectList } from "../objects/ObjectList.tsx";
import type { ObjectListRow } from "../objects/ObjectList.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";

type Agents = CapMap["agents.list"]["out"];
export function AgentsRegister(): ReactElement {
  const list = useRead<Agents>("agents.list", {});
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [selected, setSelected] = useState<Agents["agents"][number] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows = list.data.agents.map((agent) => <Row key={agent.agentId} id={`console-agent-${agent.agentId}`} title={agent.name} note={`${agent.status} · ${agent.role ?? "No role line"} · ${agent.hasComputer ? "Computer" : "No computer"}`} onPress={() => { setSelected(agent); setConfirmDelete(false); }} trailing={<Button label={agent.status === "paused" ? "Resume agent" : "Pause agent"} disabled={action.busy} onPress={() => void action.run(agent.status === "paused" ? "agents.resume" : "agents.pause", { agentId: agent.agentId }, agent.status === "paused" ? "Agent resumed" : "Agent paused")} />} />);
  return <View testID="console-agents"><Section title="Agents" count={rows.length}><Group>{rows.length ? rows : <Note>No agents yet.</Note>}</Group></Section><Section title="Create agent"><Group><Field label="Name" testID="agent-name" value={name} onChange={setName} /><Field label="Role line" value={role} onChange={setRole} /><Button label="Create agent" testID="agent-create" disabled={!name.trim() || action.busy} onPress={() => void action.run("agents.create", { name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}), idempotencyKey: attempt() }, "Agent created").then((out) => { if (out) { setName(""); setRole(""); } })} /></Group></Section>{selected ? <Section title={selected.name}><Group><Row id="agent-owner" title="Owner" note={selected.ownerId} /><Row id="agent-folder" title="Home folder" note={selected.folderId} /><Row id="agent-model" title="Model" note={selected.model ?? "Space default"} /><Row id="agent-template" title="Template version" note={String(selected.templateVersion)} /></Group><Button label="Move agent to Trash…" danger onPress={() => setConfirmDelete(true)} />{confirmDelete ? <Actions><Button label="Cancel" onPress={() => setConfirmDelete(false)} /><Button label="Confirm removal" danger disabled={action.busy} onPress={() => void action.run("agents.delete", { agentId: selected.agentId }, "Agent moved to Trash").then((out) => { if (out) setSelected(null); })} /></Actions> : null}</Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}

type Actors = CapMap["access.actors.list"]["out"];
type Actor = Actors["actors"][number];
export function OutsideActors({ initialActorId = null }: { initialActorId?: string | null } = {}): ReactElement {
  const list = useRead<Actors>("access.actors.list", {});
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("other");
  const [token, setToken] = useState<{ value: string; expires: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialActorId);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const selected = list.data.actors.find((actor) => actor.id === selectedId) ?? null;
  if (selected) return <ActorObject key={selected.id} actor={selected} busy={action.busy} note={action.note} onBack={() => setSelectedId(null)} onRun={action.run} />;
  const rows: ObjectListRow<Actor>[] = list.data.actors.map((actor) => ({ id: actor.id, title: actor.name, note: `${actor.provider} · ${actor.status}${actor.engineerMcp ? " · Engineer MCP" : ""}`, search: `${actor.owner} ${actor.roles.join(" ")}`, filters: [actor.status, ...(actor.engineerMcp ? ["engineer"] : [])], value: actor, actions: [{ label: "Open", onSelect: () => setSelectedId(actor.id) }, { label: actor.engineerMcp ? "Remove Engineer MCP" : "Allow Engineer MCP", onSelect: () => void action.run("access.actors.set_engineer_mcp", { actorId: actor.id, enabled: !actor.engineerMcp }, "Engineer MCP access updated") }, { separator: true }, { label: "Revoke", danger: true, onSelect: () => { setPicked(new Set([actor.id])); setBulkConfirm(true); } }] }));
  const revokePicked = async (): Promise<void> => { for (const actorId of picked) { const out = await action.run("access.actors.revoke", { actorId }, "Actor revoked"); if (out === undefined) return; } setPicked(new Set()); setBulkConfirm(false); };
  return <View testID="console-outside-actors"><Section title="Outside actors" count={rows.length}><ObjectList rows={rows} selectedId={null} onOpen={(row) => setSelectedId(row.id)} filters={[{ id: "active", label: "Active" }, { id: "pending", label: "Pending" }, { id: "revoked", label: "Revoked" }, { id: "engineer", label: "Engineer MCP" }]} activeFilters={filters} onFilters={setFilters} picked={picked} onPicked={setPicked} bulkActions={[{ label: "Revoke selected…", danger: true, onSelect: () => setBulkConfirm(true) }]} empty="No outside actors or API keys yet." testID="actors-object-list" /></Section>{bulkConfirm ? <Section title="Revoke selected actors?"><Group><Note>{picked.size} actor{picked.size === 1 ? "" : "s"} will lose access immediately. Open sessions and credentials stop working.</Note><Actions><Button label="Cancel" onPress={() => setBulkConfirm(false)} /><Button label="Confirm revoke" danger disabled={action.busy || picked.size === 0} onPress={() => void revokePicked()} /></Actions></Group></Section> : null}<Section title="Connect an outside tool"><Group><Field label="Name" value={name} onChange={setName} /><Field label="Provider" value={provider} onChange={setProvider} /><Button label="Issue one-time token" testID="actor-create" disabled={!name.trim() || !provider.trim() || action.busy} onPress={() => void action.run<CapMap["access.actors.create"]["out"]>("access.actors.create", { name: name.trim(), provider: provider.trim(), idempotencyKey: attempt() }, "One-time token issued").then((out) => { if (out) setToken({ value: out.oneTimeToken, expires: out.expiresAt }); })} />{token ? <><Note>Shown once. Expires {new Date(token.expires).toLocaleString()}.</Note><Text selectable testID="actor-token">{token.value}</Text></> : null}</Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}

function ActorObject({ actor, busy, note, onBack, onRun }: { actor: Actor; busy: boolean; note: string; onBack: () => void; onRun: <T>(cap: string, input: unknown, success: string | ((out: T) => string | Promise<string>)) => Promise<T | undefined> }): ReactElement {
  const [tab, setTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(actor.provider);
  const [roles, setRoles] = useState(actor.roles.join(", "));
  const effective = useRead<CapMap["access.principals.effective"]["out"]>("access.principals.effective", { principal: { kind: "actor", id: actor.id } });
  const activity = useRead<CapMap["audit.list"]["out"]>("audit.list", { actor: { kind: "actor", id: actor.id }, limit: 50 });
  const run = (id: string): void | Promise<boolean> => {
    if (id === "edit") { setEditing(true); return; }
    if (id === "engineer") return onRun("access.actors.set_engineer_mcp", { actorId: actor.id, enabled: !actor.engineerMcp }, "Engineer MCP access updated").then((out) => out !== undefined);
    if (id === "revoke") return onRun("access.actors.revoke", { actorId: actor.id }, "Actor revoked").then((out) => { if (out !== undefined) onBack(); return out !== undefined; });
  };
  const body = tab === "access" ? <ObjectSection title="Effective access" count={effective.data?.permissions.length ?? 0}>{effective.data ? <><Row id="actor-roles" title="Roles" note={effective.data.roles.join(", ") || "No roles"} /><Row id="actor-permissions" title="Permissions" note={effective.data.permissions.join(", ") || "No permissions"} /><Row id="actor-engineer" title="Engineer MCP" note={actor.engineerMcp ? "Allowed" : "Not allowed"} /></> : <ReadState error={effective.error} retry={effective.refresh} />}</ObjectSection> : tab === "activity" ? <ObjectSection title="Activity" count={activity.data?.rows.length ?? 0}>{activity.data ? (activity.data.rows.length ? activity.data.rows.map((row) => <Row key={row.id} id={`actor-activity-${row.id}`} title={row.action} note={`${row.class} · ${new Date(row.at).toLocaleString()}`} />) : <Note>No activity by this actor.</Note>) : <ReadState error={activity.error} retry={activity.refresh} />}</ObjectSection> : <ObjectSection title="Overview"><Row id="actor-provider" title="Provider" note={actor.provider} /><Row id="actor-owner" title="Owner" note={actor.owner} /><Row id="actor-last-seen" title="Last seen" note={actor.lastSeenAt ? new Date(actor.lastSeenAt).toLocaleString() : "Never"} /></ObjectSection>;
  const roleIds = roles.split(",").map((value) => value.trim()).filter(Boolean);
  return <ObjectPage key={`${actor.id}:${editing}`} id={actor.id} name={actor.name} kind="Outside actor" owner={actor.owner} status={actor.status} parent="Outside actors" onBack={onBack} density="regular" actions={[{ id: "edit", label: "Edit actor", destructive: false }, { id: "engineer", label: actor.engineerMcp ? "Remove Engineer MCP" : "Allow Engineer MCP", destructive: false }, { id: "revoke", label: "Revoke", destructive: true }]} impacts={{ revoke: `Revoking ${actor.name} stops its credentials and open sessions immediately.` }} tabs={withBaseTabs([])} activeTabId={tab} onTab={setTab} onAction={run} sheetOpen={editing} sheetTitle="Quick edit actor" onCloseSheet={() => setEditing(false)} sheet={<View><Field label="Provider" value={provider} onChange={setProvider} /><Field label="Role ids (comma separated)" value={roles} onChange={setRoles} /><Button label="Save actor" disabled={busy || !provider.trim()} onPress={() => void onRun("access.actors.update", { actorId: actor.id, provider: provider.trim(), roleIds }, "Actor updated").then((out) => { if (out) setEditing(false); })} /></View>}>{body}{note ? <Note>{note}</Note> : null}</ObjectPage>;
}

type Computers = CapMap["computers.list"]["out"];
export function AgentComputers(): ReactElement {
  const list = useRead<Computers>("computers.list", {});
  const [selected, setSelected] = useState<Computers["computers"][number] | null>(null);
  const [tabLimit, setTabLimit] = useState("8");
  const [confirm, setConfirm] = useState(false);
  const action = useAction(list.refresh);
  if (!list.data) return <ReadState error={list.error} retry={list.refresh} />;
  const rows = list.data.computers.map((computer) => <Row key={computer.computerId} id={`console-computer-${computer.computerId}`} title={computer.caption ?? computer.computerId} note={`${computer.state} · ${computer.tabs}/${computer.tabLimit} tabs · ${computer.host}`} onPress={() => { setSelected(computer); setTabLimit(String(computer.tabLimit)); setConfirm(false); }} trailing={computer.state !== "asleep" ? <Button label="Sleep" onPress={() => void action.run("computers.sleep", { computerId: computer.computerId }, "Computer sleeping")} /> : null} />);
  return <View testID="console-agent-computers"><Section title="Agent computers" count={rows.length}><Group>{rows.length ? rows : <Note>No agent computers.</Note>}</Group></Section>{selected ? <Section title={selected.caption ?? selected.computerId}><Group><Row id="computer-agent" title="Agent" note={selected.agentId} /><Row id="computer-disk" title="Profile disk" note={selected.diskBytes === undefined ? "No size reported" : `${selected.diskBytes} bytes`} /><Field label="Tab limit" value={tabLimit} onChange={setTabLimit} /><Button label="Wake configuration" disabled={action.busy || !Number.isInteger(Number(tabLimit)) || Number(tabLimit) < 1} onPress={() => void action.run("computers.configure", { computerId: selected.computerId, tabLimit: Number(tabLimit) }, "Computer configuration saved")} /></Group><Button label="Remove computer…" danger onPress={() => setConfirm(true)} />{confirm ? <Actions><Button label="Cancel" onPress={() => setConfirm(false)} /><Button label="Confirm removal" danger disabled={action.busy} onPress={() => void action.run("computers.remove", { computerId: selected.computerId }, "Computer removed").then((out) => { if (out) setSelected(null); })} /></Actions> : null}</Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}

export function AgentTemplate(): ReactElement {
  const template = useRead<CapMap["agents.template.get"]["out"]>("agents.template.get", {});
  const suggestions = useRead<CapMap["agents.suggestions.list"]["out"]>("agents.suggestions.list", { kind: "template", state: ["open"] });
  const [preview, setPreview] = useState<CapMap["agents.template.preview"]["out"] | null>(null);
  const action = useAction(() => { template.refresh(); suggestions.refresh(); });
  if (!template.data || !suggestions.data) return <ReadState error={template.error ?? suggestions.error} retry={() => { template.refresh(); suggestions.refresh(); }} />;
  const files = template.data.files.map((file) => <Row key={file} id={`template-file-${file}`} title={file} note="Managed in the Space template folder" />);
  const proposed = suggestions.data.suggestions.map((item) => <Row key={item.suggestionId} id={`template-suggestion-${item.suggestionId}`} title={item.file} note={`${item.widening ? "Widens access · " : ""}${item.reason ?? "Suggested change"}`} trailing={<Actions><Button label="Accept" onPress={() => void action.run("agents.suggestion.accept", { suggestionId: item.suggestionId }, "Suggestion accepted")} /><Button label="Dismiss" onPress={() => void action.run("agents.suggestion.dismiss", { suggestionId: item.suggestionId }, "Suggestion dismissed")} /></Actions>} />);
  return <View testID="console-agent-template"><Section title="Agent template" count={`Version ${template.data.version}`}><Group><Row id="template-mode" title="Mode" note={template.data.mode} /><Row id="template-agents" title="Agents" note={String(template.data.agents)} />{files}</Group></Section><Actions><Button label="Preview for all agents" testID="template-preview" disabled={action.busy} onPress={() => void action.run<CapMap["agents.template.preview"]["out"]>("agents.template.preview", { scope: "all" }, () => "Preview ready").then((out) => { if (out) setPreview(out); })} />{preview ? <Button label="Apply template" disabled={action.busy} onPress={() => void action.run("agents.template.apply", { scope: "all" }, "Template applied").then((out) => { if (out) setPreview(null); })} /> : null}</Actions>{preview ? <Note>{preview.agents} agents; {preview.filesAdded} files added; {preview.suggestions} suggestions; {preview.widening} widen access.</Note> : null}<Section title="Open suggestions" count={proposed.length}><Group>{proposed.length ? proposed : <Note>No open template suggestions.</Note>}</Group></Section>{action.note ? <Note>{action.note}</Note> : null}</View>;
}
