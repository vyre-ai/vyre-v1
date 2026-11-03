// A Skills page as skills.page answers it, for the tests and the screenshots: Dana's own skills, two cards waiting (one shared with her, one back after an update that can touch more),
// a Space skill an admin set, and her two agents.
import type { MemberSkill, Page, Perms } from "./model.ts";

const none: Perms = { scripts: [], mcpServers: [], network: [], vaultKeys: [] };
export const AGENTS = [{ agentId: "agt_intake", name: "Intake" }, { agentId: "agt_billing", name: "Billing" }];

export function samplePage(o: { admin?: boolean; empty?: boolean } = {}): Page {
  if (o.empty) return { waiting: [], mine: [], shared: [], space: [], builtin: [{ name: "working-in-vyre", description: "How to work in Vyre." }], agents: [], policy: { scriptsAdminOnly: false }, admin: o.admin === true, me: "usr_dana" };
  return {
    me: "usr_dana", admin: o.admin === true, agents: AGENTS, policy: { scriptsAdminOnly: false },
    waiting: [
      {
        skillId: "sko_pdf", name: "pdf", description: "Fill in, read and merge PDF forms.", sharer: "usr_maya", sharerName: "Maya Chen", toSpace: false, source: "github:anthropics/skills@main/document-skills/pdf", origin: "anthropics/skills", version: "1.4.0",
        perms: { scripts: ["scripts/fill_form.py", "scripts/merge.py"], mcpServers: [], network: [], vaultKeys: [] }, state: "waiting", growth: [], agents: ["*"], enabled: true, setup: {}, needs: [], updatedAt: 1_762_000_000_000,
      },
      {
        skillId: "sko_crm", name: "crm-notes", description: "Log call notes to the CRM after a consult.", sharer: "usr_leo", sharerName: "Leo Park", toSpace: true, source: "upload", origin: "Leo Park",
        perms: { scripts: [], mcpServers: [{ name: "hubspot", transport: "http", target: "https://mcp.hubspot.com/", keys: ["HUBSPOT_TOKEN"] }], network: ["mcp.hubspot.com"], vaultKeys: [] }, state: "waiting",
        growth: ["starts a new tool server: hubspot", "reaches mcp.hubspot.com"], agents: ["*"], enabled: true, setup: {}, needs: [], updatedAt: 1_762_000_000_000,
      },
    ],
    mine: [
      {
        skillId: "sko_intake", name: "intake-triage", description: "Sort new enquiries by practice area and urgency.", source: "upload", origin: "your skills", agents: ["agt_intake"], enabled: true, perms: none, setup: {}, needs: [],
        sharedWith: ["*"], updatedAt: 1_762_000_000_000,
      },
      {
        skillId: "sko_notion", name: "notion-notes", description: "Keep matter notes in Notion.", source: "github:makenotion/notion-mcp-server", origin: "makenotion/notion-mcp-server", version: "2.1.0", agents: ["*"], enabled: true,
        perms: { scripts: [], mcpServers: [{ name: "notion", transport: "stdio", target: "npx -y @notionhq/notion-mcp-server", keys: ["NOTION_TOKEN"] }], network: ["npx downloads"], vaultKeys: [] }, setup: {}, needs: ["notion.NOTION_TOKEN"],
        sharedWith: [], updatedAt: 1_762_000_000_000,
      },
      {
        skillId: "sko_pdf2", name: "acme-skills:pdf", label: "pdf (from acme/skills)", description: "Acme's PDF helper.", source: "github:acme/skills/pdf", origin: "acme/skills", agents: ["*"], enabled: false, perms: none, setup: {}, needs: [],
        sharedWith: [], updatedAt: 1_762_000_000_000,
      },
    ],
    shared: [{
      skillId: "sko_brief", name: "court-brief", description: "Draft a court brief in the firm's format.", sharer: "usr_maya", sharerName: "Maya Chen", toSpace: false, source: "upload", origin: "Maya Chen", perms: none, state: "added", growth: [],
      agents: ["*"], enabled: true, setup: {}, needs: [], updatedAt: 1_762_000_000_000,
    }],
    space: [{ skillId: "skl_house", name: "house-style", description: "Write in the firm's house style.", source: "github:mla/skills@main/house-style", origin: "mla/skills", version: "1.2", enabled: true, perms: none, setup: {}, needs: [], updatedAt: 1_762_000_000_000 }],
    builtin: [{ name: "working-in-vyre", description: "How to work in Vyre: save facts, cite sources, use secrets by name." }, { name: "connector-builder", description: "Connect an app or API to Automations." }],
  };
}

export const SAMPLE_MEMBERS: MemberSkill[] = [
  { owner: "usr_maya", ownerName: "Maya Chen", name: "pdf", shared: true, skillId: "sko_pdf", toSpace: false },
  { owner: "usr_leo", ownerName: "Leo Park", name: "crm-notes", shared: true, skillId: "sko_crm", toSpace: true },
  { owner: "usr_leo", ownerName: "Leo Park", name: "my-drafts", shared: false, toSpace: false },
];
