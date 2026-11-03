// Every Space-wide key goes in a folder the whole Space can reach (lib/space-folder.ts): a Space connection's key, an app hub's key and a Space skill's key each land in their own folder, shared with
// Everyone at Use, so another member's call can fill it. Before, each picked "the first shared folder" or made one shared with nobody, and every other member's call was refused.
import test from "node:test";
import assert from "node:assert/strict";
import { fileHubKey } from "../apps/app/src/hubs/hub-key.ts";
import { fileKeys } from "../apps/app/src/places/vault/connections/actions.ts";
import { fileSkillKey } from "../apps/app/src/skills/actions.ts";
import { EVERYONE_GROUP } from "../lib/space-folder.ts";

function vault() {
  const folders: Array<{ id: string; name: string; scope: string; yourLevel?: string }> = [{ id: "vfd_private", name: "Ops only", scope: "shared", yourLevel: "manage" }];
  const shared: Array<[string, string, unknown]> = [];
  const puts: Array<{ folderId: string }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    if (cap === "vault.folders.list") return { folders };
    if (cap === "vault.folders.create") { const f = { id: `vfd_${String(i["name"]).toLowerCase()}`, name: String(i["name"]), scope: String(i["scope"]) }; folders.push(f); return { folder: f }; }
    if (cap === "vault.share") { shared.push([(i["resource"] as { id: string }).id, (i["subject"] as { id: string }).id, i["level"]]); return { granted: true }; }
    if (cap === "vault.item.put") { puts.push({ folderId: String(i["folderId"]) }); return { item: { id: "vit_1", handle: `#${String(i["name"])}` } }; }
    if (cap === "spaces.get") return { space: { kind: "team" } };
    return {};
  };
  return { call, shared, puts };
}

test("a Space connection's key, an app hub's key and a Space skill's key each go in their own folder shared with everyone, never the first shared folder", async () => {
  const conn = vault();
  await fileKeys(conn.call, "space", "Linear", [{ key: "LINEAR_API_KEY", value: "lin_test_0000" }]); // secret-scan: fake
  assert.deepEqual([conn.puts[0]!.folderId, conn.shared], ["vfd_connections", [["vfd_connections", EVERYONE_GROUP, "use"]]]);
  const hub = vault();
  await fileHubKey(hub.call, "Zapier", "zap_test_0000"); // secret-scan: fake
  assert.deepEqual([hub.puts[0]!.folderId, hub.shared], ["vfd_connections", [["vfd_connections", EVERYONE_GROUP, "use"]]]);
  const skill = vault();
  await fileSkillKey(skill.call, { skill: "weather", skillId: "skl_1", need: "API_KEY", value: "wx_test_0000", space: true }); // secret-scan: fake
  assert.deepEqual([skill.puts[0]!.folderId, skill.shared], ["vfd_skills", [["vfd_skills", EVERYONE_GROUP, "use"]]]);
});
