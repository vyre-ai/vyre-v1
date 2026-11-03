// A Mine item saved while its owner's key is not on the node (enc=3, the Vault matrix): sealed to the public key of the owner's real key bundle, it opens only with the private key their person key
// unlocks, never with another person's, and a bundle that is not real gives no public key (the save then refuses as before instead of sealing to nothing).
import test from "node:test";
import assert from "node:assert/strict";
import { makeBundle } from "../../client/src/crypto/keys.ts";
import { privateKeyOf, publicKeyOf } from "../src/seams/person-keys.ts";
import { openMineSealed, sealMineTo } from "../../modules/vault/handlers/crypto.ts";

const FAST = { memoryKiB: 8, iterations: 1, parallelism: 1 };
const dbOf = (rows: Record<string, unknown>) => ({ all: (_sql: string, id: unknown) => (rows[String(id)] ? [{ keys_json: JSON.stringify(rows[String(id)]) }] : []) });

test("sealed to Mia's public key, a Mine item opens with her person key and with nobody else's", async () => {
  const mia = await makeBundle("mia's password 1", "recovery-mia", { argon: FAST });
  const noah = await makeBundle("noah's password 1", "recovery-noah", { argon: FAST });
  const db = dbOf({ usr_mia: mia, usr_noah: noah, usr_seed: { publicKey: Buffer.from("public-usr_seed").toString("base64"), privateKeyWrapped: "eA==" } });
  const pub = publicKeyOf(db, "usr_mia");
  assert.ok(pub);
  const fields = [{ key: "api_key", value: "sk-mia-0123456789", secret: true }];
  const sealed = sealMineTo("vit_mia1", fields, pub);
  assert.equal(sealed.enc, 3);
  assert.ok(!JSON.stringify(sealed).includes("sk-mia-0123456789"), "nothing in the clear");
  assert.deepEqual(openMineSealed("vit_mia1", sealed, privateKeyOf(db, "usr_mia", mia.personKey)!), fields);
  assert.equal(privateKeyOf(db, "usr_mia", noah.personKey), null, "Noah's person key does not open Mia's private key");
  assert.throws(() => openMineSealed("vit_mia1", sealed, privateKeyOf(db, "usr_noah", noah.personKey)!), "nor does Noah's private key open her item");
  assert.throws(() => openMineSealed("vit_other", sealed, privateKeyOf(db, "usr_mia", mia.personKey)!), "bound to its item");
  assert.equal(publicKeyOf(db, "usr_seed"), null, "an opaque bundle is no public key");
  assert.equal(publicKeyOf(db, "usr_nobody"), null);
});
