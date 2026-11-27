// The three small jobs the daemon asks of a workspace about its background jobs (rc.44), as one program in the image (it was node one-liners held as strings in the daemon's code): `list` prints every job's spec,
// status and the end of its log as one JSON document; `write` stores a job's spec (VYRE_JOB = {id, spec}) atomically, where the supervisor looks every second; `stop` marks a job as desired stopped (VYRE_JOB_ID), exiting 3 when
// there is no such job. Plain node, no shell. Run as the agent's own user: it can only do what the agent can do to its own ~/.vyre/jobs folder.
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.env.HOME ?? "", ".vyre", "jobs");
const cmd = process.argv[2];

if (cmd === "list") {
  const out = [];
  try {
    for (const id of fs.readdirSync(root)) {
      const d = path.join(root, id);
      const rd = (f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
        } catch {
          return null;
        }
      };
      const spec = rd("spec.json");
      if (!spec) continue;
      let tail = "";
      try {
        const b = fs.readFileSync(path.join(d, "log"));
        tail = b.subarray(Math.max(0, b.length - 1500)).toString("utf8");
      } catch {
        /* no log yet */
      }
      out.push({ id, spec, status: rd("status.json"), tail });
    }
  } catch {
    /* no jobs folder: no jobs */
  }
  console.log(JSON.stringify(out));
} else if (cmd === "write") {
  const j = JSON.parse(process.env.VYRE_JOB ?? "");
  const d = path.join(root, j.id);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const f = path.join(d, "spec.json");
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(j.spec));
  fs.renameSync(`${f}.tmp`, f);
} else if (cmd === "stop") {
  const f = path.join(root, process.env.VYRE_JOB_ID ?? "", "spec.json");
  let s;
  try {
    s = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    process.exit(3);
  }
  s.desired = "stopped";
  s.at = Date.now();
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(s));
  fs.renameSync(`${f}.tmp`, f);
} else {
  process.stderr.write("jobs-cli: list, write or stop\n");
  process.exit(2);
}
