// access.check agrees with authorize and with scopeFor. Outside actor tokens and the Engineer MCP grant live here too.
import test from "node:test";
import assert from "node:assert/strict";
import { authorize, evalPred, scopeFor } from "../../../kernel/src/authorize/index.ts";
import { harness, NOW } from "../fixtures/db.ts";
import { loadWorld } from "../fixtures/world.ts";
import { actorsCreate, actorsEngineer, actorsRedeem, actorsRevoke, check, toReq } from "../handlers/check.ts";
import { principalsEffective, putPrincipal, rolesAssign } from "../handlers/roles.ts";
import { dropStore, storeOf } from "../projections.ts";

const CASES = 200;
const TEN_MINUTES = 10 * 60 * 1000;

function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== "object" || !("error" in e)) return undefined;
  const error = (e as { error?: { code?: string } }).error;
  return error?.code;
}

test(`access checker agrees with authorize and scopeFor on ${CASES} seeded worlds`, async () => {
  let allow = 0;
  let deny = 0;
  let checks = 0;
  for (let seed = 1; seed <= CASES; seed++) {
    const h = harness(NOW);
    const store = storeOf(h.ctx);
    const cases = loadWorld(store, seed, NOW);
    const snap = store.snapshot();
    const records = [...store.resources.values()].filter((r) => r.type === "record");
    for (const c of cases) {
      for (const rec of records) {
        const input = {
          principal: c.principal,
          ...(c.actingFor ? { actingFor: c.actingFor } : {}),
          action: c.action,
          resource: { type: rec.type, id: rec.id },
        };
        const req = toReq(h.ctx, input);
        const direct = authorize(snap, req);
        const via = await check(h.ctx, input);
        const scope = scopeFor(snap, {
          principal: req.principal,
          entityType: rec.type,
          level: req.action.level,
          perm: req.action.perm,
          now: req.now,
          ...(req.actingFor ? { actingFor: req.actingFor } : {}),
          ...(req.action.destructive ? { destructive: true } : {}),
        });
        const row = store.resourceRow(rec.id);
        const ctx = `seed ${seed} ${c.principal.id} ${c.action.perm}/${c.action.level} ${rec.id} (${direct.reason})`;
        assert.ok(row, ctx);
        assert.equal(via.decision.effect, direct.effect, ctx);
        assert.equal(via.decision.reason, direct.reason, ctx);
        assert.equal(via.decision.decisionId.startsWith("dec_"), true, ctx);
        assert.ok(via.decision.steps.length >= 1, ctx);
        const last = via.decision.steps[via.decision.steps.length - 1];
        assert.ok(last && last.text.length > 0, ctx);
        assert.equal(last.ok, direct.effect === "allow", ctx);
        assert.equal(evalPred(scope.predicate, row), direct.effect === "allow", ctx);
        if (c.principal.id === "p_allow" && rec.id === "rec_fxa" && c.action.perm === "records.edit" && c.action.level === "view") {
          assert.equal(direct.effect, "allow", ctx);
        }
        if (c.principal.id === "p_deny" && rec.id === "rec_fxd" && c.action.perm === "records.edit") {
          assert.equal(direct.effect, "deny", ctx);
          assert.equal(direct.reason, "role_lacks_permission", ctx);
        }
        if (direct.effect === "allow") allow++;
        else deny++;
        checks++;
      }
    }
    dropStore(h.db);
  }
  assert.equal(checks, CASES * 4 * 8);
  assert.ok(allow > 0 && deny > 0, `allow ${allow} deny ${deny}`);
  console.log(`access checker agreement: ${CASES} worlds, ${checks} checks (${allow} allow, ${deny} deny)`);
});

test("an outside actor token works once, then expiry and revoke stick", async () => {
  const h = harness(NOW);
  const store = storeOf(h.ctx);
  putPrincipal(store, { id: "usr_admin", kind: "person", name: "Admin" });
  const made = await actorsCreate(h.ctx, { name: "Codex", provider: "openai", roleIds: ["rol_member"], idempotencyKey: "actor-1" });
  assert.equal(made.actor.status, "pending");
  assert.equal(made.actor.provider, "openai");
  assert.equal(made.actor.engineerMcp, false);
  assert.ok(made.actor.roles.includes("rol_member"));
  const retry = await actorsCreate(h.ctx, { name: "Codex", provider: "openai", idempotencyKey: "actor-1" });
  assert.equal(retry.oneTimeToken, made.oneTimeToken);
  const redeemed = await actorsRedeem(h.ctx, { token: made.oneTimeToken });
  assert.equal(redeemed.actorId, made.actor.id);
  assert.ok(redeemed.credential.length > 10);
  await assert.rejects(() => actorsRedeem(h.ctx, { token: made.oneTimeToken }), (e: unknown) => codeOf(e) === "auth.invalid_code");
  const on = await actorsEngineer(h.ctx, { actorId: made.actor.id, enabled: true });
  assert.equal(on.actor.engineerMcp, true);
  assert.equal(on.actor.status, "active");
  const eff = await principalsEffective(h.ctx, { principal: { kind: "actor", id: made.actor.id } });
  assert.ok(eff.permissions.includes("engineer.mcp"));
  assert.ok(eff.permissions.includes("records.edit"));
  await actorsRevoke(h.ctx, { actorId: made.actor.id });
  assert.equal(store.actors.get(made.actor.id)?.status, "revoked");
  const names = h.events.map((e) => e.name);
  assert.ok(names.includes("principal.created"));
  assert.ok(names.includes("token.revoked"));
  assert.ok(names.includes("access.changed"));
  dropStore(h.db);
});

test("a one-time token dies after 10 minutes", async () => {
  const h = harness(NOW);
  storeOf(h.ctx);
  const made = await actorsCreate(h.ctx, { name: "Claude Code", provider: "anthropic", idempotencyKey: "actor-exp" });
  h.setNow(NOW + TEN_MINUTES);
  await assert.rejects(
    () => actorsRedeem(h.ctx, { token: made.oneTimeToken }),
    (e: unknown) => codeOf(e) === "permission.expired",
  );
  dropStore(h.db);
});

test("a restricted record is refused to an outside actor on a disallowed provider", async () => {
  const h = harness(NOW);
  const store = storeOf(h.ctx);
  const made = await actorsCreate(h.ctx, { name: "Claude Code", provider: "anthropic", idempotencyKey: "actor-label" });
  await actorsRedeem(h.ctx, { token: made.oneTimeToken });
  await rolesAssign(h.ctx, { subject: { kind: "actor", id: made.actor.id }, roleId: "rol_admin" });
  store.resources.set("rec_sec", {
    id: "rec_sec", type: "record", parentId: null, label: "restricted", ownerId: made.actor.id, holds: 0,
  });
  store.bump();
  const d = await check(h.ctx, {
    principal: { kind: "actor", id: made.actor.id },
    action: { perm: "records.edit", level: "view" },
    resource: { type: "record", id: "rec_sec" },
  });
  assert.equal(d.decision.effect, "deny");
  assert.equal(d.decision.reason, "provider_label");
  assert.ok(d.decision.steps.some((s) => s.ok === false && s.text.includes("Restricted")));
  dropStore(h.db);
});
