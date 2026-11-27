// The one-shot migration of a Space's saved sign-ins (rc.44), run in its own short-lived container of the browser image: the old shared volume mounted read-only at /old-data and this Space's own volume read-write at
// /data, nothing else, no network. It copies (never moves) the profiles that provably belong to this Space (adopt.ts), writes the report beside them, prints it as one line and exits: 0 when every profile it should
// copy is copied, 3 when a copy failed (the daemon then waits and runs it again). The Space's long-running browser container never mounts the old volume: that volume holds every Space's cookies.
import { adoptProfiles } from "./adopt.ts";

const env = process.env;
const space = env["VYRE_ADOPT_SPACE"] ?? "";
if (!/^[A-Za-z0-9_-]{3,80}$/.test(space)) {
  process.stderr.write("adopt: no valid Space id\n");
  process.exit(2);
}
const report = adoptProfiles({
  from: env["VYRE_ADOPT_FROM"] ?? "/old-data",
  to: env["VYRE_ADOPT_TO"] ?? "/data",
  spaceId: space,
  adoptAll: env["VYRE_ADOPT_ALL"] === "1",
  log: (m) => process.stderr.write(`${m}\n`),
});
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.failed.length > 0 ? 3 : 0);
