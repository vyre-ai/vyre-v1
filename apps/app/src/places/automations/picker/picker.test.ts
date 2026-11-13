import test from "node:test";
import assert from "node:assert/strict";
import {
  addAppChoices,
  appOfStep,
  connectSheet,
  intentOfKey,
  pickerRows,
  submenuOf,
  type PickApp,
  type PickStep,
} from "./model.ts";

const STEPS: PickStep[] = [
  { key: "create_task", title: "Create a task", description: "Make a task for someone" },
  { key: "send_email", title: "Send an email" },
  { key: "post_message", title: "Post a chat message" },
  { key: "sign", title: "Send for signature" },
  { key: "files.save", title: "Save a file" },
  { key: "approval", title: "Ask a person to approve" },
  { key: "wait", title: "Wait" },
  { key: "ai", title: "Ask an agent" },
  { key: "google.gmail.send_message", title: "Send a Gmail message" },
  { key: "google.sheets.append_values", title: "Add a row to a sheet" },
  { key: "ms.mail.send_message", title: "Send an Outlook message" },
  { key: "github.issue.create", title: "Create an issue" },
  { key: "connector_request", title: "Notely: Add a contact", preset: { connector: "notely", action: "add_contact" } },
  {
    key: "connector_request",
    title: "Notely: Update a contact",
    preset: { connector: "notely", action: "update_contact" },
  },
];
const APPS: PickApp[] = [
  { id: "google", name: "Google Workspace", connected: true, mayUse: true },
  { id: "notely", name: "Notely", connected: true, mayUse: true },
  { id: "microsoft", name: "Microsoft 365", connected: true, mayUse: false, admin: "Dana Whitfield" },
  {
    id: "github",
    name: "GitHub",
    connected: false,
    mayUse: false,
    vault: { item: "GitHub token", use: "view", assistant: "owner" },
  },
];
const model = {
  steps: STEPS,
  apps: APPS,
  suggested: ["create_task", "send_email", "post_message", "ai"],
  suggestedFrom: "name, email",
};
const heads = (rows: ReturnType<typeof pickerRows>) =>
  rows.filter((r) => r.kind === "heading").map((r) => (r as { text: string }).text);
const titles = (rows: ReturnType<typeof pickerRows>) =>
  rows.map((r) => ("title" in r ? r.title : r.kind === "heading" ? `# ${r.text}` : r.kind));

test("keys belong to the right app or group", () => {
  assert.equal(appOfStep(STEPS[8]!), "google");
  assert.equal(appOfStep(STEPS[10]!), "microsoft");
  assert.equal(appOfStep(STEPS[11]!), "github");
  assert.equal(appOfStep(STEPS[12]!), "notely");
  assert.equal(appOfStep(STEPS[0]!), null);
  assert.deepEqual(["create_task", "files.save", "sign", "wait", "approval", "ai", "send_email"].map(intentOfKey), [
    "tasks",
    "files",
    "docs",
    "logic",
    "logic",
    "ai",
    "msg",
  ]);
});

test("no query: three suggested, Vyre's groups, only apps he can use, then Connect an app pinned last", () => {
  const rows = pickerRows(model, "");
  assert.deepEqual(heads(rows), ["Suggested next", "Vyre", "Your apps"]);
  assert.deepEqual(titles(rows), [
    "# Suggested next",
    "Create a task",
    "Send an email",
    "Post a chat message",
    "# Vyre",
    "Messages",
    "Tasks",
    "Files",
    "Documents and signing",
    "Agent",
    "Decide and wait",
    "# Your apps",
    "Google Workspace",
    "Notely",
    "Connect an app",
  ]);
  const groups = rows.filter((r) => r.kind === "group");
  assert.deepEqual(
    groups.map((g) => [g.title, g.count]),
    [
      ["Messages", 2],
      ["Tasks", 1],
      ["Files", 1],
      ["Documents and signing", 1],
      ["Agent", 1],
      ["Decide and wait", 2],
    ],
  );
  const apps = rows.filter((r) => r.kind === "app");
  assert.deepEqual(
    apps.map((a) => [a.title, a.count]),
    [
      ["Google Workspace", 2],
      ["Notely", 2],
    ],
  );
  assert.equal(rows.at(-1)!.kind, "connect");
});

test("an app he may not use, or that nobody connected, is absent from the picker, even if the server listed its steps", () => {
  const all =
    JSON.stringify(pickerRows(model, "")) +
    JSON.stringify(pickerRows(model, "issue")) +
    JSON.stringify(pickerRows(model, "outlook"));
  assert.ok(!all.includes("Microsoft 365"));
  assert.ok(!all.includes("GitHub"));
  assert.ok(!all.includes("Outlook"));
  assert.ok(!all.includes("Create an issue"));
});

test("an app's row opens its actions as a submenu", () => {
  const sub = submenuOf(model, "app:google")!;
  assert.equal(sub.title, "Google Workspace");
  assert.deepEqual(
    sub.items.map((i) => i.title),
    ["Send a Gmail message", "Add a row to a sheet"],
  );
  assert.deepEqual(
    submenuOf(model, "group:tasks")!.items.map((i) => i.title),
    ["Create a task"],
  );
  assert.deepEqual(
    submenuOf(model, "app:notely")!.items.map((i) => i.id),
    ["connector_request:notely.add_contact", "connector_request:notely.update_contact"],
  );
  assert.equal(submenuOf(model, "app:microsoft"), null);
});

test("search runs across Vyre and every usable app, names the group at the right, never matches a raw step key", () => {
  const rows = pickerRows(model, "sign");
  const steps = rows.filter((r) => r.kind === "step");
  assert.equal(steps[0]!.title, "Send for signature");
  assert.equal(steps[0]!.where, "Documents and signing");
  assert.equal(rows.at(-1)!.kind, "connect");
  const mail = pickerRows(model, "gmail").filter((r) => r.kind === "step");
  assert.deepEqual(
    mail.map((r) => [r.title, r.where]),
    [["Send a Gmail message", "Google Workspace"]],
  );
  assert.deepEqual(
    pickerRows(model, "connector_request").filter((r) => r.kind === "step"),
    [],
  );
  assert.deepEqual(
    pickerRows(model, "sigature")
      .filter((r) => r.kind === "step")
      .slice(0, 1)
      .map((r) => r.title),
    ["Send for signature"],
  );
  assert.deepEqual(
    pickerRows(model, "zzzz").map((r) => r.kind),
    ["connect"],
  );
});

const SHEET_APPS: PickApp[] = [
  ...APPS,
  {
    id: "notion",
    name: "Notion",
    connected: false,
    mayUse: false,
    vault: { item: "Notion key", use: "use", assistant: "cleared" },
  },
  {
    id: "hub",
    name: "HubSpot",
    connected: false,
    mayUse: false,
    vault: { item: "HubSpot key", use: "use", assistant: "owner" },
  },
  {
    id: "dwd",
    name: "Google admin",
    connected: false,
    mayUse: false,
    vault: { item: "Google_DWD", use: "use", assistant: "admin" },
    admin: "Dana Whitfield",
  },
  {
    id: "co",
    name: "Payroll",
    connected: false,
    mayUse: false,
    company: true,
    vault: { item: "Payroll key", use: "use", assistant: "cleared" },
  },
  {
    id: "secret",
    name: "Hidden app",
    connected: false,
    mayUse: false,
    vault: { item: "Hidden", use: "none", assistant: "cleared" },
  },
];

test("Connect an app: In your Vault, Your Space has it, Another app; a company key and an item he may not use are never offered", () => {
  const s = connectSheet({ apps: SHEET_APPS });
  assert.deepEqual(
    s.sections.map((x) => x.head),
    ["In your Vault", "Your Space has it", "Another app"],
  );
  const vault = s.sections[0]!.rows.map((r) => [r.name, r.action.label, r.action.kind]);
  assert.deepEqual(vault, [
    ["Notion", "Set up", "setup"],
    ["HubSpot", "Set up", "setup"],
    ["Google admin", "Ask Dana Whitfield", "ask"],
  ]);
  assert.deepEqual(
    s.sections[1]!.rows.map((r) => [r.name, r.action.label]),
    [["Microsoft 365", "Ask Dana Whitfield"]],
  );
  assert.deepEqual(
    s.sections[2]!.rows.map((r) => r.action.label),
    ["Describe it"],
  );
  const flat = JSON.stringify(s);
  for (const never of ["Payroll", "Hidden app", "GitHub"]) assert.ok(!flat.includes(never), never);
});

test("an app nobody named an admin for says Ask an admin; an app just added is at the top, ready", () => {
  const s = connectSheet({ apps: [{ id: "m", name: "Mailo", connected: true, mayUse: false }], justAdded: undefined });
  assert.equal(s.sections[0]!.rows[0]!.action.label, "Ask an admin");
  const added = connectSheet({
    apps: [{ id: "hub", name: "HubSpot", connected: true, mayUse: true }],
    justAdded: "hub",
  });
  assert.deepEqual(
    [added.sections[0]!.head, added.sections[0]!.rows[0]!.action.kind],
    ["Ready to use in steps", "ready"],
  );
});

test("Add an app: known apps by name, any other name as Add 'Name'", () => {
  const known = [
    { id: "hubspot", name: "HubSpot" },
    { id: "slack", name: "Slack" },
    { id: "wordpress", name: "WordPress" },
  ];
  assert.deepEqual(
    addAppChoices("hub", known).map((c) => [c.kind, c.label]),
    [
      ["known", "HubSpot"],
      ["custom", "Add “hub”"],
    ],
  );
  assert.deepEqual(
    addAppChoices("Lawmatics", known).map((c) => [c.kind, c.label]),
    [["custom", "Add “Lawmatics”"]],
  );
  assert.deepEqual(
    addAppChoices("slack", known).map((c) => c.label),
    ["Slack"],
  );
  assert.deepEqual(addAppChoices("  ", known), []);
});
