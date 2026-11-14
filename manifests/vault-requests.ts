// vault-requests (lane L7a): a missing key asked for by an agent, skill or automation goes to the folder's managers as a request task;
// the requester sees its status and the waiting run resumes when it is fulfilled (6.11, spec 2.17 Requests).
// DECISION: the request is a task of kind 'unblock' created by tasks.create; this module holds the request row, its status and the fulfil path.
// DECISION: fulfil takes either an existing item or fields for a new item; a value typed by the provider goes in the call input and is stored by the vault service, never echoed back.
import { defineManifest, ev, read, screen, t, write } from "../packages/contracts/src/index.ts";
import { id, ok, pageIn, pageOut, principalRef } from "./_common.ts";

const V = { level: "view" } as const;
const reqId = t.id("vrq");
const fieldKey = t.str({ pattern: "^[A-Za-z][A-Za-z0-9_]*$", examples: ["api_key"] });
const requestRow = t.obj({
  id: reqId,
  name: t.str({ examples: ["Dana_Lawmatics"] }),
  fields: t.arr(fieldKey),
  reason: t.str(),
  requester: principalRef,
  forRun: t.opt(id.run),
  folderId: t.opt(id.vaultFolder),
  state: t.enm("waiting", "fulfilled", "declined", "canceled"),
  itemId: t.opt(id.vaultItem),
  note: t.opt(t.str()),
  service: t.opt(id.connector),
  taskId: id.task,
  at: t.ts(),
  decidedAt: t.opt(t.ts()),
  /** true when the caller is the person the agent asked and may add the key into their own keys (vault.requests.get only) */
  askedYou: t.opt(t.bool()),
});

/** One connect card (b-connect, 14 Nov 2026): the whole of its state, read from the server, never guessed on the screen. Names, never a value. */
const connectState = t.enm("ask", "have", "admin", "asked", "connected", "wrong", "offline", "later", "gone");
const connectField = t.obj({ name: t.str(), label: t.str(), optional: t.bool() });
const connectCard = t.obj({
  requestId: reqId,
  state: connectState,
  service: t.obj({ key: id.connector, title: t.str(), site: t.opt(t.str()) }),
  fields: t.arr(connectField),
  agentId: t.opt(id.agent),
  /** this viewer can type the key into the card: the person it was asked for, or the admin it was passed to */
  mayFill: t.bool(),
  admin: t.opt(t.obj({ id: id.user, askedAt: t.opt(t.ts()) })),
  have: t.opt(t.obj({ itemId: id.vaultItem, name: t.str(), keptIn: t.str() })),
  keptIn: t.opt(t.str()),
  tested: t.opt(t.str()),
  connectedBy: t.opt(id.user),
  connectionId: t.opt(id.connection),
  usedBy: t.arr(principalRef),
});
const keptInRow = t.obj({
  id: id.vaultFolder,
  name: t.str(),
  scope: t.enm("mine", "shared"),
  /** an agent working for the person can use a key kept here */
  usable: t.bool(),
});

export default defineManifest({
  id: "vault-requests",
  title: "Vault requests",
  owner: "L7a",

  events: [
    ev("vault.requested", "A key was asked for; the folder managers get a task", {
      p: {
        requestId: reqId,
        name: t.str(),
        fields: t.arr(fieldKey),
        requester: principalRef,
        forRun: t.opt(id.run),
        taskId: id.task,
      },
      subject: ["entity", "/requestId"],
      vis: "participants",
      trigger: { title: "A key is requested" },
      retention: "audit",
    }),
    ev("vault.request_fulfilled", "A requested key was supplied; the waiting run can resume", {
      p: {
        requestId: reqId,
        itemId: id.vaultItem,
        handle: t.opt(id.handle),
        forRun: t.opt(id.run),
        name: t.opt(t.str()),
        threadId: t.opt(id.thread),
        agentId: t.opt(id.agent),
        asker: t.opt(t.str()),
      },
      subject: ["entity", "/requestId"],
      vis: "participants",
      retention: "audit",
    }),
    ev("vault.request_declined", "A key request was declined with a note", {
      p: {
        requestId: reqId,
        forRun: t.opt(id.run),
        note: t.opt(t.str()),
        name: t.opt(t.str()),
        service: t.opt(t.str()),
        threadId: t.opt(id.thread),
        agentId: t.opt(id.agent),
        asker: t.opt(t.str()),
      },
      subject: ["entity", "/requestId"],
      vis: "participants",
    }),
    ev("vault.request_canceled", "The requester withdrew a key request", {
      p: { requestId: reqId },
      subject: ["entity", "/requestId"],
      vis: "participants",
    }),
  ],

  capabilities: [
    // handleOnly: fulfilled, the requester gets the key's name only, never Use on it. The MCP door sets it for an outside agent (docs/ask-the-person.md).
    write(
      "vault.request",
      "Ask for a missing key that is not a service (a key a skill or run needs, by name): creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status. For a service the person names, use vault_connect",
      {
        ...V,
        idem: "key",
        in: {
          name: t.str({ examples: ["Dana_Lawmatics"] }),
          fields: t.opt(t.arr(fieldKey)),
          reason: t.str(),
          forRun: t.opt(id.run),
          folderId: t.opt(id.vaultFolder),
          handleOnly: t.opt(t.bool()),
          // to: one teammate decides it instead of the folder managers (an agent asking a teammate in their direct chat, lane l-agentdm)
          to: t.opt(id.user),
        },
        out: { request: requestRow },
        emits: ["vault.requested"],
        audit: "sensitive",
        agent: { planMode: "allowed" },
        tool: "vault",
        offline: "online",
        errors: ["validation.duplicate"],
      },
    ),
    read("vault.requests.list", "Key requests I made, or waiting on me as a folder manager", {
      ...V,
      in: { mine: t.opt(t.bool()), state: t.opt(t.enm("waiting", "fulfilled", "declined", "canceled")), ...pageIn },
      out: { requests: t.arr(requestRow), ...pageOut },
      tool: "vault",
    }),
    read("vault.requests.get", "One key request with its task and status", {
      ...V,
      in: { requestId: reqId },
      out: { request: requestRow },
      tool: "vault",
    }),
    // audience (owner ruling, 3 Nov 2026): who may use the key through the agent that asked. "asker" (default): only the person who asked; "anyone": anyone who asks this agent.
    write(
      "vault.requests.fulfil",
      "Supply the key: attach an existing item, or save new fields as an item in the requested folder; say who may use it through the agent that asked",
      {
        ...V,
        in: {
          requestId: reqId,
          itemId: t.opt(id.vaultItem),
          fields: t.opt(t.arr(t.obj({ key: fieldKey, value: t.str() }))),
          folderId: t.opt(id.vaultFolder),
          audience: t.opt(t.enm("asker", "anyone")),
        },
        out: { request: requestRow },
        emits: ["vault.request_fulfilled"],
        audit: "always",
        tool: "vault",
        offline: "online",
        errors: ["permission.no_grant", "validation.precondition_failed"],
      },
    ),
    write("vault.requests.decline", "Decline a key request with a note", {
      ...V,
      in: { requestId: reqId, note: t.opt(t.str()) },
      out: ok,
      emits: ["vault.request_declined"],
      audit: "sensitive",
      tool: "vault",
    }),
    // ---- the connect card (b-connect, 14 Nov 2026, owner: "yes build the connect card"). One tool for an agent, one card for the person.
    write(
      "vault.connect",
      "Is X connected, connect X (Fathom, Slack), or before saying you cannot reach X. The person gets one card; you get connected, waiting or declined.",
      {
        ...V,
        idem: "key",
        in: {
          service: t.str({ examples: ["Fathom"] }),
          reason: t.opt(t.str()),
        },
        out: {
          status: t.enm("connected", "waiting_person", "waiting_admin", "declined"),
          requestId: t.opt(reqId),
          tell: t.str({ description: "What to do next, in one line" }),
        },
        emits: [],
        audit: "sensitive",
        agent: { planMode: "allowed" },
        tool: "vault",
        offline: "online",
        errors: ["validation.not_found", "validation.bad_input"],
      },
    ),
    read(
      "vault.connect_card.get",
      "The connect card of one request: its state, the fields, who can fill it, where the key is kept",
      {
        ...V,
        in: { requestId: reqId },
        out: { card: connectCard },
        tool: "vault",
      },
    ),
    read(
      "vault.connect_card.options",
      "Where the key can be kept: Mine, the shared folders an agent can use, and those it cannot",
      {
        ...V,
        in: { requestId: reqId },
        out: { folders: t.arr(keptInRow), default: t.opt(id.vaultFolder) },
        tool: "vault",
      },
    ),
    write(
      "vault.connect_card.submit",
      "Try the key, connect the service and keep the key; nothing is kept unless the key works. The values are in this call only",
      {
        ...V,
        in: {
          requestId: reqId,
          fields: t.opt(t.arr(t.obj({ key: fieldKey, value: t.str() }))),
          useSaved: t.opt(t.bool({ description: "Use the key the person already has instead of a typed one" })),
          folderId: t.opt(id.vaultFolder),
          audience: t.opt(t.enm("asker", "anyone")),
        },
        out: { result: t.enm("connected", "wrong", "offline"), card: connectCard },
        emits: ["vault.request_fulfilled"],
        audit: "always",
        tool: "vault",
        offline: "online",
        errors: ["permission.no_grant", "validation.precondition_failed", "validation.bad_input"],
      },
    ),
    write("vault.connect_card.ask_admin", "Ask an admin to connect the service when this person may not", {
      ...V,
      in: { requestId: reqId, admin: t.opt(id.user) },
      out: { card: connectCard },
      emits: [],
      audit: "sensitive",
      tool: "vault",
      errors: ["permission.no_grant", "validation.precondition_failed"],
    }),
    write("vault.connect_card.reopen", "Open a card the person folded with Not now", {
      ...V,
      in: { requestId: reqId },
      out: { card: connectCard },
      tool: "vault",
      errors: ["permission.no_grant", "validation.precondition_failed"],
    }),
    write("vault.connect_card.disconnect", "Disconnect the service; the key stays in the Vault", {
      ...V,
      in: { requestId: reqId },
      out: { card: connectCard },
      audit: "always",
      tool: "vault",
      errors: ["permission.no_grant", "validation.precondition_failed"],
    }),

    write("vault.requests.cancel", "Withdraw my own key request", {
      ...V,
      in: { requestId: reqId },
      out: ok,
      emits: ["vault.request_canceled"],
      agent: { planMode: "allowed" },
      tool: "vault",
    }),
  ],

  screens: [
    screen("vault_requests.list", "vault", "ui:VaultRequests", {
      q: { requests: ["vault.requests.list", { mine: "/state/mine", state: "/state/state" }] },
      a: {
        decline: ["vault.requests.decline", { requestId: "/state/requestId", note: "/state/note" }],
        fulfil: [
          "vault.requests.fulfil",
          {
            requestId: "/state/requestId",
            itemId: "/state/itemId",
            fields: "/state/fields",
            folderId: "/state/folderId",
            audience: "/state/audience",
          },
        ],
        cancel: ["vault.requests.cancel", { requestId: "/state/requestId" }, "Withdraw this request?"],
      },
      empty: "No key requests",
    }),
  ],
});
