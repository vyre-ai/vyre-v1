// The wide-table rule in the other places a file or a note draws a table (16 Nov 2026): a file opened from a chat's message in the chat's right pane, a file opened from the pane's Files tab, and a note. The same
// table as the Files viewer's walk: it uses the width of its pane and its header row and first column stay in view. Pictures go to VYRE_VIEWER_SHOTS.
import test from "node:test";
import { session } from "./viewers-harness.test.ts";
import { WIDE_MD, WIDE_PARA, assertStuck, assertUsesPane, fit, stuck } from "./files.tables-kit.test.ts";

test("a file opened in a chat's right pane: the table uses the pane, header and first column in view", async (t) => {
  const s = await session(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  const { page, call } = s;
  try {
    const f = await s.make("applicants.md", Buffer.from(WIDE_MD), "text/markdown");
    const fileId = f.file.fileId as string;
    await call("channels.create", {
      name: "Launch",
      visibility: "public",
      memberIds: [],
      agentIds: [],
      idempotencyKey: "tbl-launch",
    });
    const launch = (await call("channels.list", {})).channels.find((c: { name: string }) => c.name === "Launch") as {
      mainThreadId: string;
    };
    await call("chat.post", {
      threadId: launch.mainThreadId,
      idempotencyKey: "tbl-post",
      body: "See [[applicants.md]]",
      blocks: [{ type: "refs", v: 1, data: { refs: [{ kind: "file", id: fileId, title: "applicants.md" }] } }],
    });
    await page.goto(`${s.web.origin}/chat#subject=thread:${launch.mainThreadId}`, { waitUntil: "load" });
    await page.getByTestId(`link-${fileId}`).first().click({ timeout: 30_000 });
    // the pane is drawn by the side pane (the testid names its slot); what is measured is the viewer inside it
    await page.locator('[data-testid="vw-doc"] [role="table"]').first().waitFor({ timeout: 30_000 });
    assertUsesPane(await fit(page, '[data-testid="vw-doc"]'), "a chat's pane", 72);
    await s.shot("chatpane-view");
    assertStuck(await stuck(page, '[data-testid="vw-doc"]'), "a chat's pane");
    await s.shot("chatpane-view-scrolled");
  } finally {
    await s.close();
  }
});

test("a file opened from an agent's Files tab: the table uses the pane, header and first column in view", async (t) => {
  const s = await session(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  const { page, call } = s;
  try {
    const dex = (await call("agents.create", { name: "Dex", role: "You plan launches.", idempotencyKey: "tbl-dex" }))
      .agent as { agentId: string };
    const roots = (await call("files.tree", {})).roots as Array<{ key: string; folderId?: string }>;
    const agents = roots.find((r) => r.key === "agents")!.folderId!;
    const mine = (
      (await call("files.list", { folder: agents })).folders as Array<{ folderId: string; name: string }>
    ).find((f) => f.name === "Dex")!;
    const made = await call("files.create", {
      folderId: mine.folderId,
      name: "applicants.md",
      content: { base64: Buffer.from(WIDE_MD).toString("base64") },
      mime: "text/markdown",
      idempotencyKey: "tbl-agent-file",
    });
    const fileId = made.file.fileId as string;
    await page.goto(`${s.web.origin}/chat#screen=chats.agent-page&agentId=${dex.agentId}&tab=files`, {
      waitUntil: "load",
    });
    await page.getByTestId(`row-file-${fileId}`).click({ timeout: 30_000 });
    await page.locator('[data-testid="vw-doc"] [role="table"]').first().waitFor({ timeout: 30_000 });
    await s.shot("filestab-opened-view");
    assertUsesPane(await fit(page, '[data-testid="vw-doc"]'), "a file opened from the Files tab", 72);
    assertStuck(await stuck(page, '[data-testid="vw-doc"]'), "a file opened from the Files tab");
    await s.shot("filestab-opened-view-scrolled");
  } finally {
    await s.close();
  }
});

test("a note holding a wide table: the table uses the note's width, header and first column in view", async (t) => {
  const s = await session(t, { width: 1440, height: 900 }, "dark");
  if (!s) return;
  const { page, call } = s;
  try {
    const n = await call("notes.create", { title: "Applicants", body: WIDE_MD, idempotencyKey: "tbl-note" });
    const id = n.note.noteId as string;
    await page.goto(`${s.web.origin}/chat#screen=chats.notes`, { waitUntil: "load" });
    await page.getByTestId(`note-${id}`).click({ timeout: 30_000 });
    await page.getByTestId("note-dialog").waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="note-dialog"] p').filter({ hasText: WIDE_PARA }).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await s.shot("note-table");
    assertUsesPane(await fit(page, '[data-testid="note-dialog"]'), "a note", 72);
    assertStuck(await stuck(page, '[data-testid="note-dialog"]'), "a note");
    await s.shot("note-table-scrolled");
  } finally {
    await s.close();
  }
});
