// Fixes #871: a new member with an empty Personal folder uploads a profile photo. The photo picker finds the Personal folder through the real files handlers (files.tree, which makes it when it is missing),
// then saves the image there with files.create. The old lookup read files.list with no folder, which lists the Personal folder's children and never the folder itself, so it never matched.
import test from "node:test";
import assert from "node:assert/strict";
import { chooseProfilePhoto } from "../apps/app/src/shell/providers/settings-photo.ts";
import { handlers } from "../modules/files/impl.ts";
import { open } from "../modules/files/fixtures/lists-world.ts";

test("a new member with an empty Personal folder uploads a photo", async () => {
  const k = open(() => ({}), "per_new");
  const ran: string[] = [];
  const rt = {
    call: async (cap: string, input: unknown): Promise<unknown> => {
      ran.push(cap);
      const h = (handlers as Record<string, (ctx: unknown, i: unknown) => Promise<unknown>>)[cap];
      if (!h) throw new Error(`no handler for ${cap}`);
      return h(k.ctx, input);
    },
  };
  const img = { name: "me.png", mime: "image/png", size: 1200, base64: "iVBORw0KGgo=" };
  const id = await chooseProfilePhoto(rt as never, async () => img);
  assert.match(id ?? "", /^fil_/, "the photo is a file");
  assert.deepEqual(ran, ["files.tree", "files.create"]);
  const tree = (await rt.call("files.tree", {})) as { roots: { key: string; folderId?: string }[] };
  const home = tree.roots.find((r) => r.key === "personal")!.folderId!;
  const kept = (await rt.call("files.list", { folderId: home })) as { files: { fileId: string; name: string }[] };
  assert.deepEqual(kept.files.map((f) => f.name), ["me.png"], "it is kept in the Personal folder");
});
