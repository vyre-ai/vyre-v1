// A member who joins by an invite link has no Personal folder until Files makes one. Settings > Profile > Photo > Choose keeps the picture in it; it must work in the first minute (issue 871,
// "There is no personal folder to keep the photo in"). This walks it on a server-role daemon with the real identity: the owner invites Aina, Aina joins, and the photo goes in through the same
// function the Settings screen calls, over her own session.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chooseProfilePhoto } from "../apps/app/src/shell/providers/settings-photo.ts";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

let h: Hour;
let a: Person;

before(async () => { h = await bootHour("photo"); });
after(async () => { await h?.stop(); });

test("an invited member picks a profile photo in her first minute and it is kept in her own Personal folder", async () => {
  a = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, a, await invite(h, a.email), { device: "web" });
  const rt = { call: async (cap: string, input: unknown) => a.call(cap, input as Record<string, unknown>) } as never;
  const image = { name: "me.jpg", mime: "image/jpeg", size: 1000, base64: "/9j/4AAQSkZJRg==" };
  const fileId = await chooseProfilePhoto(rt, async () => image);
  assert.match(String(fileId), /^fil_/, "the photo is saved and its file id comes back");
  const tree = (await a.call("files.tree", {})) as { roots: Array<{ key: string; folderId?: string }> };
  const home = tree.roots.find((r) => r.key === "personal")?.folderId;
  const listed = (await a.call("files.list", { folder: home })) as { files: Array<{ fileId: string }> };
  assert.ok(listed.files.some((f) => f.fileId === fileId), "it sits in her Personal folder");
});
