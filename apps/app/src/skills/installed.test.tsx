// Console > Skills > Installed from links: the Space's installs with who made them and the pinned commit, See changes (the diff, applied only by Update), and Remove.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../ui/src/testing/dom.ts";
import { InstalledFromLinks } from "./InstalledFromLinks.tsx";

const INS = [
  { installId: "ins_1", kind: "skill", name: "pdf-forms", repo: "acme/pdf-skill", commit: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://github.com/acme/pdf-skill", by: "usr_dana", at: 1, installed: {} },
  { installId: "ins_2", kind: "mcp_remote", name: "tasks-mcp", repo: "mcp.tasks.example", commit: "", url: "https://mcp.tasks.example/sse", by: "usr_maya", at: 1, installed: {} },
];
const PLAN = { planId: "ins_9", state: "planned", kind: "skill", name: "pdf-forms", summary: "x", repo: "acme/pdf-skill", commit: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "u", needs: { domains: [], vaultKeys: [], files: [] }, skills: [], problems: [], who: [],
  card: { name: "pdf-forms", kind: "skill", summary: "x", commit: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", needs: { domains: [], vaultKeys: [], files: [] } },
  diff: { from: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", to: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", added: [], removed: [], changed: [{ path: "SKILL.md", plus: ["Also flattens."], minus: ["Fills forms."] }] } };

function world(changed = true) {
  installDom();
  const calls: Array<{ cap: string; input: Record<string, any> }> = [];
  let list = [...INS];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, any>;
    calls.push({ cap, input: i });
    if (cap === "install.list") return { installs: list };
    if (cap === "install.check_update") return changed ? { changed: true, plan: PLAN } : { changed: false };
    if (cap === "install.apply") return { installed: {} };
    if (cap === "install.remove") { list = list.filter((x) => x.installId !== i["installId"]); return { removed: true }; }
    throw new Error(`no ${cap}`);
  };
  return { calls, call };
}

test("the list says what, from where, at which commit and who installed it; a remote server has no See changes", async () => {
  const w = world();
  const root = await mount(createRoot as never, <InstalledFromLinks call={w.call} nameOf={(id) => ({ usr_dana: "Dana", usr_maya: "Maya" } as Record<string, string>)[id] ?? id} />);
  await flush(); await flush();
  assert.match(textOf(find(root!, "row-install-row-ins_1")!), /pdf-forms[\s\S]*Skill[\s\S]*Dana installed it[\s\S]*Commit a41f9c2/);
  assert.match(textOf(find(root!, "row-install-row-ins_2")!), /Remote MCP[\s\S]*Maya installed it[\s\S]*mcp\.tasks\.example/);
  assert.ok(find(root!, "install-see-ins_1"), "a newer commit puts See changes on its row");
  assert.equal(find(root!, "install-see-ins_2"), null);
  assert.deepEqual(w.calls[0], { cap: "install.list", input: { all: true } });
});

test("See changes opens the diff and changes nothing; Update applies it for the Space with the plan's card", async () => {
  const w = world();
  const root = await mount(createRoot as never, <InstalledFromLinks call={w.call} />);
  await flush(); await flush();
  await press(find(root!, "install-see-ins_1")!);
  await flush();
  const sheet = textOf(find(root!, "install-update-sheet")!);
  assert.match(sheet, /pdf-forms a41f9c2 to 7d03be8/);
  assert.match(sheet, /SKILL\.md[\s\S]*- Fills forms\.[\s\S]*\+ Also flattens\./);
  assert.equal(w.calls.some((c) => c.cap === "install.apply"), false, "looking changes nothing");
});

test("a current install has no See changes; Remove takes the row away", async () => {
  const w = world(false);
  const root = await mount(createRoot as never, <InstalledFromLinks call={w.call} />);
  await flush(); await flush();
  assert.equal(find(root!, "install-see-ins_1"), null, "current: no See changes, no ready mark");
  assert.equal(find(root!, "install-ready-ins_1"), null);
  await press(find(root!, "install-remove-ins_1")!);
  await flush(); await flush();
  assert.equal(find(root!, "row-install-row-ins_1"), null);
  assert.ok(find(root!, "row-install-row-ins_2"));
  assert.deepEqual(w.calls.find((c) => c.cap === "install.remove")!.input["installId"], "ins_1");
});

test("nothing installed from a link draws nothing", async () => {
  installDom();
  const root = await mount(createRoot as never, <InstalledFromLinks call={async () => ({ installs: [] })} />);
  await flush(); await flush();
  assert.equal(find(root!, "skills-installed"), null);
});
