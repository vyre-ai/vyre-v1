// The writes the menus of Vault items, automations, goals, projects and the Console rows make (kinds-b.ts). Each is one capability call over the data context, with an idempotency key where the
// capability takes one; the tests drive them without a renderer. Local actions (copy, open, a sheet) are the host's and are not here.
import type { ChatsSidebarData } from "../sidebar/data.tsx";

type Call = Pick<ChatsSidebarData, "call">;
const key = (what: string, id: string): string => `menu:${what}:${id}:${Date.now().toString(36)}`;

export interface MenuApiB {
  // Vault items
  vaultMove(itemId: string, folderId: string): Promise<void>;
  vaultMarkRotated(itemId: string): Promise<void>;
  vaultTrash(itemId: string): Promise<void>;
  // Automations
  automationRun(automationId: string): Promise<void>;
  automationSetEnabled(automationId: string, enabled: boolean): Promise<void>;
  automationTest(automationId: string): Promise<void>;
  automationPersonalCopy(automationId: string): Promise<void>;
  automationMove(automationId: string, groupId: string | null): Promise<void>;
  automationTrash(automationId: string): Promise<void>;
  // Goals
  goalPause(goalId: string): Promise<void>;
  goalResume(goalId: string): Promise<void>;
  goalMarkStuck(goalId: string, reason: string, options: readonly [string, string]): Promise<void>;
  goalReport(goalId: string, summary: string): Promise<void>;
  goalStop(goalId: string): Promise<void>;
  // Projects
  projectStar(projectId: string, on: boolean): Promise<void>;
  projectAddPerson(projectId: string, principal: { kind: "person" | "agent"; id: string }, role: string): Promise<void>;
  projectPinFile(projectId: string, fileId: string): Promise<void>;
  projectArchive(projectId: string): Promise<void>;
  projectUnarchive(projectId: string): Promise<void>;
  // Console rows
  personSuspend(personId: string): Promise<void>;
  personReactivate(personId: string): Promise<void>;
  personRole(personId: string, roleId: string): Promise<void>;
  personRemove(personId: string): Promise<void>;
  groupAddMember(groupId: string, member: { kind: "person" | "agent"; id: string }): Promise<void>;
  groupRename(groupId: string, name: string): Promise<void>;
  groupDelete(groupId: string): Promise<void>;
  roleDuplicate(roleId: string, name: string): Promise<void>;
  roleDelete(roleId: string): Promise<void>;
  computerWake(computerId: string): Promise<void>;
  computerSleep(computerId: string): Promise<void>;
  computerTakeOver(computerId: string): Promise<void>;
  computerRemove(computerId: string): Promise<void>;
  numberAssign(numberId: string, assigneeKind: string, assigneeId: string): Promise<void>;
  numberRelease(numberId: string): Promise<void>;
  domainCheck(domainId: string): Promise<void>;
  domainRemove(domainId: string): Promise<void>;
  // Machines
  machineDrain(machineId: string, on: boolean): Promise<void>;
  machineFix(machineId: string, fix: "clear_caches" | "stop_idle"): Promise<void>;
  serverRemove(serverId: string): Promise<void>;
  myComputerRemove(serverId: string): Promise<void>;
}

export function createMenuApiB(data: Call): MenuApiB {
  const c = async (cap: string, input: unknown): Promise<void> => { await data.call(cap, input); };
  return {
    vaultMove: (itemId, folderId) => c("vault.item.move", { itemId, folderId }),
    vaultMarkRotated: (itemId) => c("vault.item.mark_rotated", { itemId }),
    vaultTrash: (itemId) => c("vault.item.delete", { itemId }),

    automationRun: (automationId) => c("automations.run", { automationId, idempotencyKey: key("run", automationId) }),
    automationSetEnabled: (automationId, enabled) => c("automations.set_enabled", { automationId, enabled }),
    automationTest: (automationId) => c("automations.test", { automationId }),
    automationPersonalCopy: (automationId) => c("automations.make_personal_copy", { automationId, idempotencyKey: key("copy", automationId) }),
    automationMove: (automationId, groupId) => c("automations.move", { automationId, groupId }),
    automationTrash: (automationId) => c("automations.delete", { automationId }),

    goalPause: (goalId) => c("goals.pause", { goalId }),
    goalResume: (goalId) => c("goals.resume", { goalId }),
    goalMarkStuck: (goalId, reason, options) => c("goals.mark_stuck", { goalId, reason, options: [...options] }),
    goalReport: (goalId, summary) => c("goals.report", { goalId, summary }),
    goalStop: (goalId) => c("goals.stop", { goalId }),

    projectStar: (projectId, on) => c("stars.toggle", { resource: { type: "project", id: projectId }, on }),
    projectAddPerson: (projectId, principal, role) => c("projects.members.set", { projectId, principal, role, idempotencyKey: key("member", `${projectId}:${principal.id}`) }),
    projectPinFile: (projectId, fileId) => c("projects.pin_file", { projectId, fileId }),
    projectArchive: (projectId) => c("projects.archive", { projectId }),
    projectUnarchive: (projectId) => c("projects.unarchive", { projectId }),

    personSuspend: (personId) => c("members.suspend", { personId }),
    personReactivate: (personId) => c("members.reactivate", { personId }),
    personRole: (personId, roleId) => c("access.roles.assign", { subject: { kind: "person", id: personId }, roleId }),
    /** The removal wizard's own defaults: what the person owns is reassigned or paused as the preview proposes. */
    async personRemove(personId) {
      const prev = (await data.call("members.remove_preview", { personId })) as { items?: { kind: string; defaultAction: string; reassignTo?: string }[] } | null;
      const plan = (prev?.items ?? []).map((i) => ({ kind: i.kind, action: i.defaultAction, ...(i.reassignTo ? { to: i.reassignTo } : {}) }));
      await data.call("members.remove", { personId, plan });
    },
    groupAddMember: (groupId, member) => c("access.groups.add_member", { groupId, member }),
    groupRename: (groupId, name) => c("access.groups.update", { groupId, name }),
    groupDelete: (groupId) => c("access.groups.delete", { groupId }),
    roleDuplicate: (roleId, name) => c("access.roles.create", { name, cloneFrom: roleId, idempotencyKey: key("role", roleId) }),
    roleDelete: (roleId) => c("access.roles.delete", { roleId }),
    computerWake: (computerId) => c("computers.wake", { computerId }),
    computerSleep: (computerId) => c("computers.sleep", { computerId }),
    computerTakeOver: (computerId) => c("computers.take_over", { computerId }),
    computerRemove: (computerId) => c("computers.remove", { computerId }),
    numberAssign: (numberId, assigneeKind, assigneeId) => c("telephony.number.assign", { numberId, assigneeKind, assigneeId }),
    numberRelease: (numberId) => c("telephony.number.release", { numberId, idempotencyKey: key("release", numberId) }),
    domainCheck: (domainId) => c("mail.domain.check", { domainId }),
    domainRemove: (domainId) => c("mail.domain.remove", { domainId }),
    machineDrain: (machineId, on) => c("machines.set", { machineId, drain: on }),
    machineFix: (machineId, fix) => c("machines.fix", { machineId, fix }),
    serverRemove: (serverId) => c("network.server_remove", { serverId }),
    myComputerRemove: (serverId) => c("network.my_computer_remove", { serverId }),
  };
}

/** The address of a thing, in the one spelling every Copy link uses. */
export const vyreLink = (kind: string, id: string): string => `vyre://${kind}/${id}`;
/** Put text on the clipboard; a device with none does nothing. */
export function copyToClipboard(text: string): void {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator?.clipboard;
  void clip?.writeText(text);
}
