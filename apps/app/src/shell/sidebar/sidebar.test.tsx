// The shared place sidebar: the pure rules (collapse key and storage, phone view, search) and the slot's chrome.
// @reads ../../../../../scripts/shots/mounts/P-L9_22.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SidebarBack,
  SidebarExpand,
  SidebarSlot,
  SidebarSlotProvider,
  collapseKey,
  hashOpensBody,
  linkNamesBody,
  matchRows,
  phoneView,
  readCollapsed,
  writeCollapsed,
} from "./index.ts";
import type { SidebarStorage } from "./index.ts";
import { createRoot } from "test-renderer";
import { act } from "react";
import type { ReactElement } from "react";
import { find, flush, installDom } from "../../../../../ui/src/testing/dom.ts";
import { Text } from "react-native";
import { useSidebarSlot } from "./index.ts";
import { noteInputForTests } from "./SidebarSlot.tsx";

const props = { deviceId: "d1", personId: "p1", spaceId: "northwind", place: "chats", epoch: 1 };

test("hidden or shown is one choice per device and person, in every place; the value round-trips and bad data reads as open", () => {
  assert.equal(collapseKey("d1", "p1"), "vyre.sidebar.v2:d1:p1");
  assert.notEqual(collapseKey("d1", "p1"), collapseKey("d2", "p1"));
  assert.equal(readCollapsed(writeCollapsed(true)), true);
  assert.equal(readCollapsed(writeCollapsed(false)), false);
  for (const bad of [null, "", "nope", "[]", '{"collapsed":"yes"}'])
    assert.equal(readCollapsed(bad), false, String(bad));
});

test("the phone opens a place with a sidebar on its list; a place without one, or a computer, shows the body", () => {
  assert.equal(phoneView(true, true, false), "list");
  assert.equal(phoneView(true, true, true), "body");
  assert.equal(phoneView(false, true, false), "body");
  assert.equal(phoneView(true, false, false), "body");
});

test("on a phone a link that names a page opens that page from the first frame; a bare address shows the list", () => {
  assert.equal(linkNamesBody(true, "screen=chats.notes"), true);
  assert.equal(linkNamesBody(true, ""), false);
  assert.equal(linkNamesBody(true, undefined), false);
  assert.equal(linkNamesBody(true, "section-2"), false, "a hash that names no page shows the list");
  assert.equal(linkNamesBody(true, "subject=thread:thr_1"), true);
  assert.equal(linkNamesBody(false, "screen=chats.notes"), false, "a wide window shows both: nothing to open");
  // the first frame is already the body (no list drawn and swapped away)
  const first = (hash: string): string => {
    const Probe = (): ReactElement => <>{useSidebarSlot().view}</>;
    return renderToStaticMarkup(
      <SidebarSlotProvider
        deviceId="d"
        personId="p"
        spaceId="s"
        place="chats"
        epoch={1}
        compact
        hash={hash}
        initialEntry={{ title: "Chats", searchPlaceholder: "Search" }}
        storage={null}
      >
        <Probe />
      </SidebarSlotProvider>,
    );
  };
  assert.equal(first("screen=chats.notes"), "body");
  assert.equal(first(""), "list");
});

test("search keeps rows holding every word of the query, in order; an empty query keeps all", () => {
  const rows = [
    { title: "Rivera matter" },
    { title: "Q4 billing", note: "Rivera invoices" },
    { title: "Pruitt engagement" },
  ];
  assert.deepEqual(matchRows(rows, "").length, 3);
  assert.deepEqual(
    matchRows(rows, "rivera").map((r) => r.title),
    ["Rivera matter", "Q4 billing"],
  );
  assert.deepEqual(
    matchRows(rows, "rivera inv").map((r) => r.title),
    ["Q4 billing"],
  );
  assert.deepEqual(matchRows(rows, "zzz"), []);
});

test("the slot draws the title, the collapse button and the search field, then an outlet; nothing without a registered place", () => {
  const html = renderToStaticMarkup(
    <SidebarSlotProvider
      {...props}
      compact={false}
      initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
    >
      <SidebarSlot />
    </SidebarSlotProvider>,
  );
  for (const id of ["place-sidebar", "sidebar-collapse", "sidebar-search", "sidebar-search-input", "sidebar-outlet"])
    assert.ok(html.includes(`data-testid="${id}"`), id);
  assert.ok(html.includes(">Chats<") && html.includes("Search chats"));
  assert.equal(
    renderToStaticMarkup(
      <SidebarSlotProvider {...props} compact={false}>
        <SidebarSlot />
      </SidebarSlotProvider>,
    ),
    "",
  );
});

test("a hidden sidebar stays mounted so it slides back at once, leaves the Show button, and the choice holds in every place", () => {
  const store: SidebarStorage = {
    getItem: (k) => (k === collapseKey("d1", "p1") ? writeCollapsed(true) : null),
    setItem: () => undefined,
  };
  const entry = { title: "Chats", searchPlaceholder: "Search chats" };
  const html = renderToStaticMarkup(
    <SidebarSlotProvider {...props} compact={false} storage={store} initialEntry={entry}>
      <SidebarSlot />
      <SidebarExpand />
    </SidebarSlotProvider>,
  );
  assert.ok(html.includes('data-testid="place-sidebar"') && html.includes('data-testid="sidebar-expand"'));
  const other = renderToStaticMarkup(
    <SidebarSlotProvider {...props} place="records" compact={false} storage={store} initialEntry={entry}>
      <SidebarSlot />
      <SidebarExpand />
    </SidebarSlotProvider>,
  );
  assert.ok(other.includes("sidebar-expand"), "the same choice in another place");
  const open = renderToStaticMarkup(
    <SidebarSlotProvider
      {...props}
      compact={false}
      storage={{ getItem: () => null, setItem: () => undefined }}
      initialEntry={entry}
    >
      <SidebarSlot />
      <SidebarExpand />
    </SidebarSlotProvider>,
  );
  assert.ok(!open.includes("sidebar-expand"));
});

test("on the phone the sidebar fills the screen on the list view and has no collapse button; Back shows only on the body", () => {
  const entry = { title: "Chats", searchPlaceholder: "Search chats" };
  const list = renderToStaticMarkup(
    <SidebarSlotProvider {...props} compact initialEntry={entry}>
      <SidebarSlot />
      <SidebarBack />
      <SidebarExpand />
    </SidebarSlotProvider>,
  );
  assert.ok(
    list.includes('data-testid="place-sidebar"') &&
      !list.includes("sidebar-collapse") &&
      !list.includes("sidebar-back") &&
      !list.includes("sidebar-expand"),
  );
});

test("portalInto draws nothing without a target or off the web, so a place whose slot is not ready yet shows no content", async () => {
  const { portalInto } = await import("./portal.ts");
  assert.equal(portalInto(null, "x"), null);
  assert.equal(portalInto(undefined, "x"), null);
});

test("the slot's header has a spot for the place's own buttons between the title and the collapse button (Chats: the assistant's new chat)", () => {
  const html = renderToStaticMarkup(
    <SidebarSlotProvider
      {...props}
      compact={false}
      initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
    >
      <SidebarSlot />
    </SidebarSlotProvider>,
  );
  const at = (id: string): number => html.indexOf(`data-testid="${id}"`);
  assert.ok(at("sidebar-actions") > html.indexOf(">Chats<") && at("sidebar-actions") < at("sidebar-collapse"));
});

// K9 guard (13 Nov 2026): where only one panel fits, a link to an item shows the item, Back returns to the list, and a place switch resets to the list even when the new place carries an address.
let slotNow: ReturnType<typeof useSidebarSlot> | null = null;
function Probe(): ReturnType<typeof Text> {
  const slot = useSidebarSlot();
  slotNow = slot;
  return <Text testID="view">{slot.view}</Text>;
}

async function drawn(
  r: ReturnType<typeof createRoot>,
  o: { hash: string; epoch: number; compact?: boolean; links?: number; reports?: number },
): Promise<string> {
  await act(async () => {
    r.render(
      <SidebarSlotProvider
        {...props}
        epoch={o.epoch}
        compact={o.compact ?? true}
        hash={o.hash}
        links={o.links ?? 0}
        reports={o.reports ?? 0}
        initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
      >
        <Probe />
      </SidebarSlotProvider>,
    );
  });
  await flush();
  return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
}

test("a link takes a one-panel layout from the list to the item; Back (pressed) returns to the list; the same address does not reopen it", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    assert.equal(await drawn(r, { hash: "", epoch: 1 }), "list", "no item open: the list");
    assert.equal(await drawn(r, { hash: "subject=goal:gol_1", epoch: 1 }), "body", "a link to a goal shows the goal");
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    assert.equal(
      (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join(""),
      "list",
      "Back, pressed, returns to the list",
    );
    assert.equal(
      await drawn(r, { hash: "subject=goal:gol_1", epoch: 1 }),
      "list",
      "the same address is not a new link: the list stays",
    );
    assert.equal(
      await drawn(r, { hash: "subject=goal:gol_1", epoch: 1, links: 1 }),
      "body",
      "a link back to the same address, from outside, opens the item again",
    );
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    assert.equal(await drawn(r, { hash: "subject=thread:t2", epoch: 1, links: 1 }), "body", "another item does open");
    assert.equal(
      await drawn(r, { hash: "subject=thread:t2", epoch: 1, compact: false }),
      "body",
      "a computer-width layout always shows the body",
    );
  } finally {
    restore();
  }
});

test("a place switch to a place that already has an address shows the list, not an item; a hash back to empty keeps the view", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    assert.equal(
      await drawn(r, { hash: "subject=goal:gol_1", epoch: 1 }),
      "body",
      "a link on first load shows the item",
    );
    assert.equal(
      await drawn(r, { hash: "subject=thread:t9", epoch: 2 }),
      "list",
      "the place switched (epoch 2): the list, whatever the new address holds",
    );
    assert.equal(
      await drawn(r, { hash: "subject=thread:t10", epoch: 2 }),
      "body",
      "then a link inside the new place opens the item",
    );
    assert.equal(
      await drawn(r, { hash: "", epoch: 2 }),
      "body",
      "an address that clears is not a link and does not change the view",
    );
  } finally {
    restore();
  }
});

test("hashOpensBody: the place's own report after a row press never reopens the body; a link, Cmd-K or a tab switch does", () => {
  const at = { compact: true, hash: "subject=thread:t1", hashChanged: true };
  assert.equal(hashOpensBody({ ...at, ownReport: false }), true, "an address that came to the place opens the body");
  assert.equal(hashOpensBody({ ...at, ownReport: true }), false, "the place's own report does not");
  assert.equal(hashOpensBody({ ...at, hashChanged: false, ownReport: true }), true, "no change of address: as before");
  assert.equal(hashOpensBody({ ...at, hash: "", ownReport: false }), false);
});

test("Back remembers the reports issued before it: a late draw of that report keeps the list; an item opened after Back (even after a press that wrote nothing) opens the body", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let live = 0;
    const draw = async (o: { hash: string; reports: number; links?: number }): Promise<string> => {
      await act(async () => {
        r.render(
          <SidebarSlotProvider
            {...props}
            epoch={1}
            compact
            hash={o.hash}
            links={o.links ?? 0}
            reports={o.reports}
            liveReports={() => live}
            initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
          >
            <Probe />
          </SidebarSlotProvider>,
        );
      });
      await flush();
      return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
    };
    assert.equal(await draw({ hash: "", reports: 0 }), "list");
    live = 1; // a row press: the place reports its address at once (the hub counts it), the slot opens the body
    await act(async () => {
      slotNow!.openBody();
    });
    await act(async () => {
      slotNow!.back(); // Back, before that report is drawn: the hub already counted 1
    });
    await flush();
    assert.equal(
      await draw({ hash: "subject=thread:t1", reports: 1 }),
      "list",
      "the late draw of the report issued before Back keeps the list",
    );
    // a press that writes nothing, Back, then another item the place opens by its own report (New chat, a search pick)
    await act(async () => {
      slotNow!.openBody();
    });
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    // the person then acts again (a press or a key): what that opens is a new open, never the press Back dismissed
    noteInputForTests();
    live = 2;
    assert.equal(await draw({ hash: "subject=thread:t3", reports: 2 }), "body", "a report after Back opens the body");
    // a link always opens
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    assert.equal(await draw({ hash: "subject=thread:t4", reports: 2, links: 1 }), "body", "a link opens it");
  } finally {
    restore();
  }
});

test("a report the press led to on its own (a channel opening on its main thread) after Back, with no press or key between, keeps the list; the next report after an input opens the body", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let live = 0;
    const draw = async (o: { hash: string; reports: number }): Promise<string> => {
      await act(async () => {
        r.render(
          <SidebarSlotProvider
            {...props}
            epoch={1}
            compact
            hash={o.hash}
            links={0}
            reports={o.reports}
            liveReports={() => live}
            liveOwnHash={() => o.hash}
            initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
          >
            <Probe />
          </SidebarSlotProvider>,
        );
      });
      await flush();
      return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
    };
    assert.equal(await draw({ hash: "", reports: 0 }), "list");
    live = 1;
    await act(async () => {
      slotNow!.openBody(); // a row press: the place reports the channel at once
    });
    assert.equal(await draw({ hash: "subject=thread:chn_1", reports: 1 }), "body");
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    live = 2; // the channel then settles on its main thread: a second own report, issued after Back, nobody pressed anything
    assert.equal(
      await draw({ hash: "subject=thread:main_1", reports: 2 }),
      "list",
      "the follow-on report of the pressed row does not reopen the body",
    );
    noteInputForTests(); // the person acts again
    live = 3;
    assert.equal(await draw({ hash: "subject=thread:t3", reports: 3 }), "body", "a report after an input opens it");
  } finally {
    restore();
  }
});

test("only the address the place reported itself is its late report: an address that came from a tab switch or Back (a different address than the own report) opens the body", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let own = "";
    const draw = async (o: { hash: string; reports: number }): Promise<string> => {
      await act(async () => {
        r.render(
          <SidebarSlotProvider
            {...props}
            epoch={1}
            compact
            hash={o.hash}
            links={0}
            reports={o.reports}
            liveReports={() => 1}
            liveOwnHash={() => own}
            initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
          >
            <Probe />
          </SidebarSlotProvider>,
        );
      });
      await flush();
      return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
    };
    assert.equal(await draw({ hash: "", reports: 0 }), "list");
    await act(async () => {
      slotNow!.openBody();
    });
    await act(async () => {
      slotNow!.back(); // Back before the report is drawn; the hub counted 1
    });
    await flush();
    // the hub's own-report claim was ended by a tab switch: the address now drawn is not that report
    own = "\u0000";
    assert.equal(await draw({ hash: "subject=thread:t1", reports: 1 }), "body", "not the place's own report: it opens");
  } finally {
    restore();
  }
});

test("a new goal, a created record opened, and the Notes row each open the body on a phone from their own report, with no row press and after an earlier Back", async () => {
  for (const hash of ["subject=goal:gol_new", "subject=record:rec_new", "screen=chats.notes"]) {
    const restore = installDom();
    try {
      const r = createRoot();
      let live = 0;
      const draw = async (reports: number): Promise<string> => {
        await act(async () => {
          r.render(
            <SidebarSlotProvider
              {...props}
              epoch={1}
              compact
              hash={reports === 0 ? "" : hash}
              reports={reports}
              liveReports={() => live}
              initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
            >
              <Probe />
            </SidebarSlotProvider>,
          );
        });
        await flush();
        return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
      };
      assert.equal(await draw(0), "list");
      // an earlier row press and Back left the slot remembering one report
      live = 1;
      await act(async () => {
        slotNow!.openBody();
      });
      await act(async () => {
        slotNow!.back();
      });
      await flush();
      noteInputForTests(); // the person acts again: New goal, a search pick, the Notes row
      // the place then opens the goal, record or Notes page by its own report (a higher count): the body opens
      live = 2;
      assert.equal(await draw(2), "body", hash);
    } finally {
      restore();
    }
  }
});

test("Back before the press's own report is even issued (the place reports after its own render): the late report keeps the list, once; the next report-only open opens the body", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let live = 0;
    const draw = async (o: { hash: string; reports: number }): Promise<string> => {
      await act(async () => {
        r.render(
          <SidebarSlotProvider
            {...props}
            epoch={1}
            compact
            hash={o.hash}
            links={0}
            reports={o.reports}
            liveReports={() => live}
            initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
          >
            <Probe />
          </SidebarSlotProvider>,
        );
      });
      await flush();
      return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
    };
    assert.equal(await draw({ hash: "", reports: 0 }), "list");
    await act(async () => {
      slotNow!.openBody(); // the row press; the place has not reported yet (live is still 0)
    });
    await act(async () => {
      slotNow!.back(); // Back beats the report
    });
    await flush();
    live = 1; // the place reports now, after Back
    assert.equal(
      await draw({ hash: "subject=thread:t1", reports: 1 }),
      "list",
      "the late report of the press Back dismissed keeps the list",
    );
    // an item the person opens afterwards (New chat, a search pick: each is a press or a key) opens the body
    noteInputForTests();
    live = 2;
    assert.equal(await draw({ hash: "subject=thread:t2", reports: 2 }), "body", "the next report opens the body");
    // and a press that never reports, Back, a keypress, then another item's report: the body opens (the keypress ends the wait for the press's report)
    await act(async () => {
      slotNow!.openBody();
    });
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    noteInputForTests();
    live = 3;
    assert.equal(await draw({ hash: "subject=thread:t3", reports: 3 }), "body", "a later act's report opens the body");
  } finally {
    restore();
  }
});

test("an open driven by an agent or a notification after Back, with no press or key since, is a link from outside and still opens the body", async () => {
  const restore = installDom();
  try {
    const r = createRoot();
    let live = 0;
    const draw = async (o: { hash: string; reports: number; links: number }): Promise<string> => {
      await act(async () => {
        r.render(
          <SidebarSlotProvider
            {...props}
            epoch={1}
            compact
            hash={o.hash}
            links={o.links}
            reports={o.reports}
            liveReports={() => live}
            initialEntry={{ title: "Chats", searchPlaceholder: "Search chats" }}
          >
            <Probe />
          </SidebarSlotProvider>,
        );
      });
      await flush();
      return (find(r.container as unknown as Parameters<typeof find>[0], "view")?.children ?? []).join("");
    };
    assert.equal(await draw({ hash: "", reports: 0, links: 0 }), "list");
    await act(async () => {
      slotNow!.openBody(); // a press whose report is still to come
    });
    await act(async () => {
      slotNow!.back();
    });
    await flush();
    // no press or key since Back: a link arrives (an agent's card, a notification)
    assert.equal(await draw({ hash: "subject=thread:t9", reports: 0, links: 1 }), "body", "a link opens the item");
  } finally {
    restore();
  }
});
