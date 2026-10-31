// The Mount card (rc.8): a question whose options are all mount sources is drawn as a card; picking a source opens the mount sheet, and a mounted folder is shared with the chat's agents and answers the question.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { MountCard } from "./mountcard.tsx";
import { mountOffers, mountedAnswer } from "./mountcard.ts";
import { questionOptions } from "./model.ts";

installDom();

test("only a question whose options are all mount sources is a Mount card, and options read their key", () => {
  const options = questionOptions({ options: [{ key: "mount:google_drive", label: "Google Drive" }, { key: "mount:github", label: "GitHub" }] });
  assert.deepEqual(mountOffers(options)?.map((o) => [o.source, o.label, o.brand]), [["google_drive", "Google Drive", "gdrive"], ["github", "GitHub", "github"]]);
  assert.equal(mountOffers(questionOptions({ options: [{ key: "a", label: "A" }] })), null);
  assert.equal(mountOffers(questionOptions({ options: [{ key: "mount:google_drive", label: "G" }, { key: "x", label: "X" }] })), null);
  assert.equal(mountOffers([]), null);
});

test("pick a source, mount in the sheet, and the folder is shared with the agents and the question answered", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const answers: unknown[] = [];
  const data = {
    call: async (cap: string, input: unknown) => { calls.push({ cap, input }); if (cap === "files.folder.get") return { folder: { name: "Sales" } }; return { grant: { id: "gnt_1" } }; },
    mountSheet: (p: { source: string; onMounted(i: { folderId: string; name: string }): void }) => <Sheet source={p.source} onMounted={p.onMounted} />,
  };
  function Sheet({ source, onMounted }: { source: string; onMounted(i: { folderId: string; name: string }): void }): React.ReactElement {
    return <button data-testid="fake-sheet" onClick={() => onMounted({ folderId: "fld_9", name: "Sales" })}>{`sheet ${source}`}</button>;
  }
  const offers = mountOffers(questionOptions({ options: [{ key: "mount:google_drive", label: "Google Drive" }] }))!;
  const root = await mount(createRoot, <MountCard id="blk_1" prompt="Where is the Q4 deck?" offers={offers} agents={[{ id: "agt_a", name: "Intake" }]} data={data as never} answer={(_id, a) => answers.push(a)} />);
  assert.match(textOf(root), /Where is the Q4 deck/);
  await press(find(root, "mount-card-source-blk_1-google_drive"));
  assert.match(textOf(find(root, "fake-sheet")), /sheet google_drive/);
  await press(find(root, "fake-sheet"));
  await flush();
  const share = calls.find((c) => c.cap === "access.share")?.input as { resource: { type: string; id: string }; subject: { id: string }; level: string };
  assert.deepEqual([share.resource, share.subject.id, share.level], [{ type: "folder", id: "fld_9" }, "agt_a", "view"]);
  assert.deepEqual(answers, [mountedAnswer("Sales", "fld_9")]);
  assert.match(textOf(find(root, "mount-card-done-blk_1")), /Mounted Sales and shared it with Intake/);
});

test("Not now answers the question so the agent carries on", async () => {
  const answers: unknown[] = [];
  const offers = mountOffers(questionOptions({ options: [{ key: "mount:onedrive", label: "OneDrive" }] }))!;
  const root = await mount(createRoot, <MountCard id="blk_2" prompt="Connect it?" offers={offers} agents={[]} data={{ call: async () => ({}) } as never} answer={(_id, a) => answers.push(a)} />);
  await press(find(root, "mount-card-skip-blk_2"));
  assert.equal(answers.length, 1);
  assert.match(textOf(find(root, "mount-card-done-blk_2")), /Not now/);
});
