// Spaces module (lane L7a): the switcher, stars, follows and checklist (handlers/), and the eight administration capabilities (handlers/extra, P-L7_07b): get, update, matrix, export, leave, transfer ownership,
// delete and switch address. The host gives the second group its drivers through `configureSpaceAdmin` (ruling 31/32) and makes the profile row once through the host call `spaces.ensure_profile`.
import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import type { SeamSetters } from "../../host/src/seams/index.ts";
import { handlers as base } from "./handlers/index.ts";
import { configureSpaceAdmin, extraHandlers } from "./handlers/extra/index.ts";
import { SCHEMA } from "./handlers/extra/core.ts";
import { STEP_EVENTS, completeStep } from "./projections.ts";

export const handlers = { ...base, ...extraHandlers };
export { STEP_EVENTS, completeStep as autoComplete };
export const projections = {};
export const codecs = {};
export const hostSeams: SeamSetters = { configureSpaceAdmin };

/** The Space\'s profile, made once at boot from the space.created event: its name and where people reach it. Nothing is overwritten. */
export const hostCalls = {
  "spaces.ensure_profile": (ctx: Ctx, i: { name: string; kind?: "team" | "personal"; address?: string | null }): void => {
    for (const sql of SCHEMA) ctx.db.run(sql);
    ctx.db.run("INSERT OR IGNORE INTO spaces_profile (id, name, logo_file_id, kind) VALUES (?, ?, NULL, ?)", ctx.space, i.name, i.kind ?? "team");
    const host = i.address ? i.address.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
    ctx.db.run("INSERT OR IGNORE INTO spaces_profile_extra (id, legal_name, defaults_json, address_mode, address_host, created_at, deleted_at) VALUES (?, NULL, '{}', ?, ?, ?, NULL)",
      ctx.space, host ? "own_domain" : (i.kind === "personal" ? "device" : "relay"), host, ctx.now());
  },
};
