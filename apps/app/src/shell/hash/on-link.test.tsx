// A link back to the address a place already shows still reaches the place: the place hears every address that came from outside (links), not only a change of the address words.
// One case per place that remembers it left what its address names: Automations (left), Files (Knowledge screen and Live folders), the Inbox (picked conversation, views).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { find, flush, installDom } from "../../../../../ui/src/testing/dom.ts";
import { PlaceHashProvider, useOnLink, useOpenedId, useOwnReport, usePlaceHash } from "./context.tsx";
import { inboxViewsLinked } from "../providers/inbox-links.ts";

const noop = (): void => undefined;
let leave: () => void = noop;

/** The Automations rule: the address names an automation; leaving it remembers the id as left; a link from outside forgets that. */
function AutomationLike(): ReactElement {
  const hashed = useOpenedId(["automation"], ["automationId"]);
  const [left, setLeft] = useState<string | null>(null);
  useOnLink(() => setLeft(null));
  leave = () => setLeft(hashed);
  return <Text testID="open">{hashed !== null && hashed === left ? "closed" : (hashed ?? "none")}</Text>;
}

/** The Files rule: a Knowledge screen named by the address is shown until the sidebar gives the body back; a link from outside shows it again. */
function FilesLike(): ReactElement {
  const named = useOpenedId(["knowledge"], ["route"]);
  const [memory, setMemory] = useState<string | null>(named);
  useOnLink(() => setMemory(named));
  leave = () => setMemory(null);
  return <Text testID="open">{memory ?? "list"}</Text>;
}

async function draw(
  r: ReturnType<typeof createRoot>,
  child: ReactElement,
  hash: string,
  links: number,
): Promise<string> {
  await act(async () => {
    r.render(
      <PlaceHashProvider hash={hash} links={links} opened={noop}>
        {child}
      </PlaceHashProvider>,
    );
  });
  await flush();
  return (find(r.container as unknown as Parameters<typeof find>[0], "open")?.children ?? []).join("");
}

async function pressLeave(): Promise<void> {
  await act(async () => {
    leave();
  });
  await flush();
}

const text = (r: ReturnType<typeof createRoot>): string =>
  (find(r.container as unknown as Parameters<typeof find>[0], "open")?.children ?? []).join("");

test("Automations: after the person closed the automation the address still names, a link back to it opens it again; the same address without a link does not", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    const A = "subject=automation:aut_1";
    assert.equal(await draw(r, <AutomationLike />, A, 0), "aut_1");
    await pressLeave();
    assert.equal(text(r), "closed");
    assert.equal(await draw(r, <AutomationLike />, A, 0), "closed", "the page's own re-draw is not a link");
    assert.equal(await draw(r, <AutomationLike />, A, 1), "aut_1", "a link back opens it again");
  } finally {
    restore();
  }
});

test("Files: a Knowledge screen the person left in the sidebar opens again on a link back to it", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    const K = "subject=knowledge:graph";
    assert.equal(await draw(r, <FilesLike />, K, 0), "graph");
    await pressLeave();
    assert.equal(text(r), "list");
    assert.equal(await draw(r, <FilesLike />, K, 0), "list", "the page's own re-draw is not a link");
    assert.equal(await draw(r, <FilesLike />, K, 1), "graph", "a link back shows it again");
  } finally {
    restore();
  }
});

/** Records, Apps, Console, Vault and Settings read the open item straight from the address, with nothing remembered about leaving it: a link back needs no memory to forget. */
function RecordsLike(): ReactElement {
  const id = useOpenedId(["record", "contact", "project"], ["recordId", "projectId"]);
  return <Text testID="open">{id ?? "list"}</Text>;
}

test("Records: the open record is the address, so a link back to it shows it with nothing to reset, and a bare address shows the list", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    const R = "subject=record:rec_1";
    assert.equal(await draw(r, <RecordsLike />, R, 0), "rec_1");
    assert.equal(await draw(r, <RecordsLike />, "", 0), "list", "the place left the record");
    assert.equal(await draw(r, <RecordsLike />, R, 1), "rec_1", "a link back to the same record shows it");
  } finally {
    restore();
  }
});

test("Inbox: a link names its view the same way each time, and a link back moves the view again", () => {
  const none = { meetingHash: null, repliesHash: false, unmatchedLink: null, eventHash: null };
  assert.deepEqual(inboxViewsLinked(none), [], "no link names a view");
  assert.deepEqual(inboxViewsLinked({ ...none, meetingHash: "mtg_1" }), ["meetings"]);
  assert.deepEqual(inboxViewsLinked({ ...none, repliesHash: true }), ["replies"]);
  assert.deepEqual(inboxViewsLinked({ ...none, unmatchedLink: "cnv_1" }), ["unmatched"]);
  assert.deepEqual(inboxViewsLinked({ ...none, eventHash: "evt_1" }), ["calendar"]);
});

test("a place hears the links that came after it was made, not the ones before", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let heard = 0;
    const Probe = (): ReactElement => {
      useOnLink(() => {
        heard++;
      });
      return <Text testID="open">x</Text>;
    };
    await draw(r, <Probe />, "", 3);
    assert.equal(heard, 0, "links before the place was made are not heard");
    await draw(r, <Probe />, "", 3);
    assert.equal(heard, 0, "no new link");
    await draw(r, <Probe />, "", 4);
    assert.equal(heard, 1, "a new link, even to the same address");
  } finally {
    restore();
  }
});

test("a place's own report coming back is told apart from a Back, a tab switch and a link, for the places that follow the address (Files, Inbox)", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    const seen: boolean[] = [];
    const Probe = (): ReactElement => {
      const own = useOwnReport();
      const { target } = usePlaceHash();
      useEffect(() => {
        seen.push(own());
      }, [target.screen]);
      return <Text testID="open">x</Text>;
    };
    const at = async (hash: string, reports: number, links: number): Promise<void> => {
      await act(async () => {
        r.render(
          <PlaceHashProvider hash={hash} links={links} reports={reports} opened={noop}>
            <Probe />
          </PlaceHashProvider>,
        );
      });
      await flush();
    };
    await at("screen=a", 0, 0); // mount
    await at("screen=b", 1, 0); // the place's own report came back
    await at("screen=c", 1, 0); // a Back or a tab switch: no report with it
    await at("screen=d", 2, 1); // a link came (with a report in the same draw): a link wins
    assert.deepEqual(seen, [false, true, false, false]);
  } finally {
    restore();
  }
});
