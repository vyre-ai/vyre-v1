// Site networks in a range of their own (12 Nov): each site's network is made with a free /28 of 10.213.0.0/16; two sites made at once get different ones; one taken by someone else is passed
// over; an old network (made from Docker's pools before 12 Nov) is made again in the range only while none of the site's containers is on it, never while it serves. The runner's socket is a
// stand-in that keeps networks as Docker does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { dockerRunner, networkName } from "../handlers/runner.ts";
import { freeSiteSubnet, takenBlocks } from "../handlers/site-subnets.ts";

type Net = { Name: string; Labels: Record<string, string>; IPAM: { Config: Array<{ Subnet: string }> }; Containers: Record<string, unknown> };

async function standIn(start: Net[] = [], self: string | null = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-site-sub-"));
  const sock = path.join(dir, "runner.sock");
  const nets = new Map<string, Net>(start.map((n) => [n.Name, n]));
  const calls: string[] = [];
  const race = { joinOnDelete: "" };   // a container that joins the network just before the DELETE arrives
  const server = http.createServer((q, s) => {
    let b = "";
    q.on("data", (c) => (b += c));
    q.on("end", () => {
      const url = (q.url ?? "").replace(/^\/v[\d.]+/, "").split("?")[0] ?? "";
      calls.push(`${q.method} ${url}`);
      const send = (st: number, body: unknown): void => { s.writeHead(st, { "content-type": "application/json" }); s.end(JSON.stringify(body)); };
      if (q.method === "GET" && url === "/networks") return send(200, [...nets.values()].map((n) => ({ IPAM: n.IPAM })));
      const one = /^\/networks\/([^/]+)$/.exec(url);
      if (one && q.method === "GET") { const n = nets.get(one[1]!); return n ? send(200, n) : send(404, { message: "network not found" }); }
      const conn = /^\/networks\/([^/]+)\/(connect|disconnect)$/.exec(url);
      if (conn && q.method === "POST") { const n = nets.get(conn[1]!); const who = (JSON.parse(b || "{}") as { Container?: string }).Container ?? ""; if (n) { if (conn[2] === "connect") n.Containers[who] = { Name: "ingress" }; else delete n.Containers[who]; } return send(200, {}); }
      if (one && q.method === "DELETE") { const n = nets.get(one[1]!); if (n && race.joinOnDelete) n.Containers[race.joinOnDelete] = { Name: "joined" }; if (n && Object.keys(n.Containers).length > 0) return send(403, { message: "has active endpoints" }); nets.delete(one[1]!); s.writeHead(204); s.end(); return; }
      if (q.method === "POST" && url === "/networks/create") {
        const j = JSON.parse(b) as Net;
        if (nets.has(j.Name)) return send(409, { message: "exists" });
        const want = j.IPAM?.Config?.[0]?.Subnet ?? "";
        const clash = [...nets.values()].some((n) => n.IPAM.Config.some((c) => [...takenBlocks([c.Subnet])].some((k) => takenBlocks([want]).has(k))));
        if (clash) return send(400, { message: `Pool overlaps with other one on this address space` });
        nets.set(j.Name, { Name: j.Name, Labels: j.Labels, IPAM: { Config: [{ Subnet: want }] }, Containers: {} });
        return send(201, { Id: "n" });
      }
      send(500, {});
    });
  });
  await new Promise<void>((r) => server.listen(sock, r));
  return { runner: dockerRunner({ socketPath: sock, token: () => "t", self }), nets, calls, race, close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("the allocator gives the first free /28 of 10.213.0.0/16 and passes over any overlap", () => {
  assert.equal(freeSiteSubnet([]), "10.213.0.0/28");
  assert.equal(freeSiteSubnet(["10.213.0.0/28", "10.213.0.16/28"]), "10.213.0.32/28");
  assert.equal(freeSiteSubnet(["10.213.0.0/24"]), "10.213.1.0/28", "a bigger network inside the range takes all its blocks");
  assert.equal(freeSiteSubnet(["10.0.0.0/8"]), null, "a network over the whole range leaves nothing");
});

test("each new site's network gets its own /28 in the site range, two at once included; one taken since the list was read is passed over", async (t) => {
  const w = await standIn([{ Name: "someone", Labels: {}, IPAM: { Config: [{ Subnet: "10.213.0.0/28" }] }, Containers: {} }]);
  t.after(w.close);
  const [a, b] = await Promise.all([w.runner.network("sit_aaa"), w.runner.network("sit_bbb")]);
  assert.deepEqual([a.subnet, b.subnet].sort(), ["10.213.0.16/28", "10.213.0.32/28"], "different /28s, the taken one skipped");
  for (const n of [a, b]) assert.ok(w.nets.get(n.name)?.Labels["vyre.site"]);
});

test("an old site network from Docker's pools is made again in the site range only while none of the site's containers is on it", async (t) => {
  const serving = networkName("sit_live"), idle = networkName("sit_idle");
  const w = await standIn([
    { Name: serving, Labels: { "vyre.site": "sit_live" }, IPAM: { Config: [{ Subnet: "172.20.0.0/16" }] }, Containers: { ["c".repeat(64)]: { Name: "vyre-site-live-d1" } } },
    { Name: idle, Labels: { "vyre.site": "sit_idle" }, IPAM: { Config: [{ Subnet: "172.21.0.0/16" }] }, Containers: {} },
  ]);
  t.after(w.close);
  const live = await w.runner.network("sit_live");
  assert.equal(live.subnet, "172.20.0.0/16", "serving: kept as it is");
  assert.equal(w.calls.filter((c) => c === `DELETE /networks/${serving}`).length, 0);
  const moved = await w.runner.network("sit_idle");
  assert.equal(moved.subnet, "10.213.0.0/28", "nothing on it: made again in the site range");
});

test("V4: a deploy that joins an old network between the ingress leaving and the delete keeps it, and the ingress joins it again", async (t) => {
  const name = networkName("sit_race");
  const INGRESS = "e".repeat(64);
  const w = await standIn([{ Name: name, Labels: { "vyre.site": "sit_race" }, IPAM: { Config: [{ Subnet: "172.22.0.0/16" }] }, Containers: { [INGRESS]: { Name: "vyred" } } }], INGRESS);
  t.after(w.close);
  // the DELETE meets a container that joined in between: Docker refuses it
  w.race.joinOnDelete = "d".repeat(64);
  const got = await w.runner.network("sit_race");
  assert.equal(got.subnet, "172.22.0.0/16", "the old network stays");
  const i = w.calls.indexOf(`DELETE /networks/${name}`);
  assert.ok(i >= 0 && w.calls.slice(i + 1).includes(`GET /networks/${name}`), "read again after the refused delete, so what joins below sees it as it is");
  // and the ingress, which left it for the delete, is on it again (sixth look W4)
  assert.ok(w.calls.slice(i + 1).includes(`POST /networks/${name}/connect`), "the ingress joined again");
  assert.ok(INGRESS in w.nets.get(name)!.Containers, "the ingress is on the site's network");
});
