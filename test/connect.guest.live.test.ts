// A GUEST NEVER GETS USE ON A KEY KEPT IN CONNECTIONS (r32-connect, review of 9bdda3ef3, item 5). The card keeps a Space service's key in the Connections folder, shared with Everyone at Use (lib/space-folder.ts,
// the very calls the card makes). A guest of one channel is not one of the people that group means: they cannot list the folder's items, open the key, use it, or run a connection made from it.
import test from "node:test";
import assert from "node:assert/strict";
import { world } from "./guest-channel-kit.ts";

test("a guest of a channel gets no Use on a key kept in Connections: it is not listed, cannot be opened, used or run", async () => {
  const w = await world();
  try {
    const g = await w.invite(w.pub, "reply", "guest-conn@example.com", "guestconn");
    const folder = (await w.o("vault.folders.create", { name: "Connections", scope: "shared", idempotencyKey: "gc-f" }))
      .folder.id as string;
    await w.o("vault.share", {
      resource: { type: "vault_folder", id: folder },
      subject: { kind: "group", id: "grp_everyone" },
      level: "use",
      idempotencyKey: "gc-s",
    });
    const item = (
      await w.o("vault.item.put", {
        folderId: folder,
        name: "Stripe",
        kind: "api_key",
        fields: [{ key: "Stripe_Key", value: "sentinel_guest_key_0123456789", secret: true }],
        idempotencyKey: "gc-i",
      })
    ).item as { id: string };
    const listed = await g.call("vault.items.list", {});
    assert.ok(
      listed.status !== 200 || !JSON.stringify(listed.data).includes(item.id),
      `the guest does not list it: ${JSON.stringify(listed.data).slice(0, 200)}`,
    );
    for (const [cap, input] of [
      ["vault.item.get", { itemId: item.id }],
      ["vault.use", { item: "#Stripe", purpose: "read" }],
      [
        "connections.create",
        { connector: "stripe", title: "x", ownerKind: "space", secrets: { Stripe_Key: "#Stripe.Stripe_Key" } },
      ],
    ] as const) {
      const r = await g.call(cap, input as Record<string, unknown>);
      assert.notEqual(r.status, 200, `${cap} is refused for a guest: ${JSON.stringify(r.data).slice(0, 200)}`);
      assert.ok(!JSON.stringify(r.data).includes("sentinel_guest_key"), `${cap}: no value`);
    }
  } finally {
    await w.stop();
  }
});
