// A small Space for the vault request tests: a folder managed by Mira, a Space owner and an admin, a member who can ask, and an agent working a Run. The host's other modules are scripted
// stand-ins that answer what the handlers ask and record every call, so a test can read exactly what left the module (and see that no value did).
import { MemoryDb } from "./db.ts";
import type { PKind, VaultReqCtx } from "../projections.ts";

export const NOW = 1_700_000_000_000;
export const FOLDER = "vfd_team";

export interface Call {
  cap: string;
  input: Record<string, unknown>;
}
export interface Event {
  name: string;
  subject: string;
  payload: unknown;
}
export interface Script {
  /** persons with Manage on a folder, by folder id */
  managers: Record<string, string[]>;
  owners: string[];
  admins: string[];
  /** field keys of the items a manager can attach, by item id */
  items: Record<string, string[]>;
  /** the owner of the Space resource, when there is one (ruling 74: the decider of a key no folder claims) */
  spaceOwner?: string;
  /** the folder's managers cannot be read */
  folderUnreadable?: boolean;
  /** capabilities that should fail, with the message */
  fail: Record<string, string>;
  /** the chat the request's card was drawn in, with the person who asked (read back through tasks.get) */
  card?: { threadId: string; agentId: string; asker: string };
  /** the Vault folders the caller can list */
  folders?: { id: string; name: string; scope: "mine" | "shared"; owner?: string }[];
  /** the folders and items labelled above the requester's clearance (access.clears answers no for them) */
  unusable?: string[];
  /** where an item sits, for the items vault.item.get returns (default: shared) */
  itemScope?: Record<string, "mine" | "shared">;
  /** the connectors the Space has set up, by key (the connect card) */
  connectors?: Record<
    string,
    {
      title: string;
      scope: "person" | "space";
      fields: { name: string; label: string; optional: boolean }[];
      site?: string;
    }
  >;
  /** the person's own connection to a service, by connector key, as connectors.for_service reports it */
  connections?: Record<string, { connectionId: string; owner: "mine" | "space"; state: string }>;
  /** what trying a typed key answers */
  check?: "ok" | "rejected" | "unreachable";
  /** what probing a connection made from a saved key answers */
  probe?: "healthy" | "down";
  /** Vault items vault.items.list answers (a key the person already saved) */
  saved?: { id: string; name: string; folderId: string; fieldKeys: string[] }[];
}

export function world(over: Partial<Script> = {}) {
  const db = new MemoryDb();
  const calls: Call[] = [];
  const events: Event[] = [];
  const warnings: string[] = [];
  const script: Script = {
    managers: { [FOLDER]: ["usr_mira"] },
    owners: ["usr_owner"],
    admins: ["usr_admin"],
    items: { vit_have: ["api_key", "account"], vit_thin: ["account"] },
    fail: {},
    ...over,
  };
  let task = 0;
  let put: { folderId: string; keys: string[]; by: string } | null = null;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    const f = script.fail[cap];
    if (f) throw new Error(f);
    switch (cap) {
      case "access.deciders": {
        if ((i["resource"] as { type: string }).type === "space")
          return {
            people: [
              ...new Set([...(script.spaceOwner ? [script.spaceOwner] : []), ...script.owners, ...script.admins]),
            ],
          };
        if (script.folderUnreadable) throw new Error("no access");
        return { people: script.managers[(i["resource"] as { id: string }).id] ?? [] };
      }
      case "access.clears":
        return { clears: !(script.unusable ?? []).includes((i["target"] as { id: string }).id) };
      case "tasks.create":
        return { task: { id: `tsk_${++task}` } };
      case "tasks.transition":
        return { task: { id: i["taskId"] } };
      case "tasks.update":
        return { task: { id: i["taskId"] } };
      case "vault.item.get": {
        if (i["itemId"] === "vit_new" && put) {
          const f = (script.folders ?? []).find((x) => x.id === put!.folderId);
          return {
            item: {
              id: "vit_new",
              folderId: put.folderId,
              scope: f?.scope ?? "mine",
              owner: put.by,
              fieldKeys: put.keys,
            },
          };
        }
        const old = (script.saved ?? []).find((x) => x.id === i["itemId"]);
        if (old) {
          const f = (script.folders ?? []).find((x) => x.id === old.folderId);
          return {
            item: {
              id: old.id,
              folderId: old.folderId,
              scope: f?.scope ?? "mine",
              owner: "usr_asker",
              fieldKeys: old.fieldKeys,
            },
          };
        }
        const keys = script.items[String(i["itemId"])];
        if (!keys) throw new Error("no such item");
        return {
          item: { id: i["itemId"], fieldKeys: keys, scope: script.itemScope?.[String(i["itemId"])] ?? "shared" },
          fields: keys.map((key) => ({ key, secret: true, hasValue: true })),
        };
      }
      case "vault.item.put":
        put = {
          folderId: String(i["folderId"]),
          keys: (i["fields"] as { key: string }[]).map((f) => f.key),
          by: "usr_asker",
        };
        return {
          item: {
            id: "vit_new",
            fieldKeys: (i["fields"] as { key: string }[]).map((f) => f.key),
          },
        };
      case "vault.item.delete":
        return { ok: true };
      case "vault.items.list":
        return { items: script.saved ?? [] };
      case "connectors.for_service": {
        const want = String(i["service"])
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "");
        const key = Object.keys(script.connectors ?? {}).find(
          (k) => k === want || script.connectors![k]!.title.toLowerCase() === want,
        );
        if (!key) return { found: false, near: [] };
        const c = script.connectors![key]!;
        return {
          found: true,
          connector: {
            key,
            title: c.title,
            scope: c.scope,
            mode: "api",
            fields: c.fields,
            ...(c.site ? { site: c.site } : {}),
          },
          ...(script.connections?.[key] ? { connection: script.connections[key] } : {}),
        };
      }
      case "connectors.check_key":
        return { result: script.check ?? "ok", ...((script.check ?? "ok") === "ok" ? { tested: "Reached" } : {}) };
      case "connections.create": {
        const made = {
          connectionId: "con_new",
          owner: (i["ownerKind"] === "space" ? "space" : "mine") as "space" | "mine",
          state: "pending",
        };
        script.connections = { ...(script.connections ?? {}), [String(i["connector"])]: made };
        return { connection: made };
      }
      case "connections.mark_working": {
        const k = Object.keys(script.connections ?? {}).find(
          (x) => script.connections![x]!.connectionId === i["connectionId"],
        );
        if (k) script.connections![k] = { ...script.connections![k]!, state: "active" };
        return { state: "active", stamped: true };
      }
      case "connections.test": {
        if ((script.probe ?? "healthy") === "down")
          return { state: "down", detail: "The app rejected the key or sign-in." };
        const k = Object.keys(script.connections ?? {}).find(
          (x) => script.connections![x]!.connectionId === i["connectionId"],
        );
        if (k) script.connections![k] = { ...script.connections![k]!, state: "active" };
        return { state: "healthy" };
      }
      case "connections.delete": {
        for (const k of Object.keys(script.connections ?? {}))
          if (script.connections![k]!.connectionId === i["connectionId"]) delete script.connections![k];
        return { deleted: true };
      }
      case "vault.share":
        return { granted: true };
      case "access.share":
        return { grant: { id: "gnt_through" } };
      case "tasks.get": {
        if (!script.card) throw new Error("no card");
        return { task: { id: i["taskId"], blocks: [{ type: "vault_request", data: script.card }] } };
      }
      case "vault.folders.list":
        return { folders: (script.folders ?? []).filter((f) => i["scope"] === undefined || f.scope === i["scope"]) };
      case "vault.folders.create":
        return { folder: { id: "vfd_company" } };
      case "access.labels.set":
        return { ok: true };
      case "runs.resume":
        return { run: { id: i["runId"] } };
      case "chat.post":
        return { message: { id: `msg_${calls.length}` } };
      default:
        throw new Error(`unexpected call ${cap}`);
    }
  };
  const as = (id: string, kind: PKind = "person", actingFor?: string): VaultReqCtx => ({
    space: "spc_test",
    principal: { kind, id },
    ...(actingFor ? { actingFor } : {}),
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => NOW,
    db,
    emit(name, subject, payload) {
      events.push({ name, subject, payload });
    },
    call,
    log: {
      warn(msg, attrs) {
        warnings.push(`${msg} ${JSON.stringify(attrs ?? {})}`);
      },
    },
  });
  return {
    db,
    calls,
    events,
    warnings,
    script,
    as,
    called: (cap: string): Call[] => calls.filter((c) => c.cap === cap),
  };
}
export type World = ReturnType<typeof world>;
