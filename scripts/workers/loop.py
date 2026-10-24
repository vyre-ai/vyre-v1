#!/usr/bin/env python3
"""Tracker-to-worker loop (P-PR_73). Stdlib only, never runs node.

Polls the tracker per lane, picks work (changes_requested first, then tier, then id), claims it and starts the right worker kind:
  grok    the packet's body says "Worker: grok". loop.py assigns it and launches `grok-run.py one --packet P` (which starts it).
  sonnet  "Worker: sonnet" (the default). loop.py assigns and starts it as sonnet-wN, writes a ticket to the outbox with the
          short brief (sonnet-run.py) and the lead session starts one Agent per ticket. At most --sonnet-max (5) tickets are
          live; a ticket is live while its packet is assigned or in_progress.
Heartbeat: for every running grok child loop.py touches the packet every --heartbeat seconds. Stale: packets the tracker lists as
stale (no touch for 30 min) are printed as STALE lines and commented once an hour. Claims that fail get a cooldown.

  python3 loop.py --lanes L4,L8,prep [--once] [--grok-max 12] [--sonnet-max 5] [--outbox DIR] [--interval 30]
Env: VYRE_TRACKER_URL, VYRE_TRACKER_TOKEN, VYRE_TRACKER_ACTOR (the loop's own name, default "dispatcher").
"""
import argparse, importlib.util, json, os, re, shlex, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("sonnet_run", os.path.join(HERE, "sonnet-run.py"))
sonnet_run = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(sonnet_run)

ACTIVE = ("assigned", "in_progress")
WORKER_RE = re.compile(r"Worker:\s*(grok|sonnet)", re.I)
DEFAULT_GROK_CMD = "python3 {here}/grok-run.py one --packet {packet} --actor {actor}"


def worker_kind(packet: dict) -> str:
    m = WORKER_RE.search(packet.get("body") or "")
    return m.group(1).lower() if m else "sonnet"


def order(packets: list) -> list:
    """changes_requested first so sent-back work is not starved, then tier, then id."""
    return sorted(packets, key=lambda p: (p["status"] != "changes_requested", p.get("tier") or 9, p["id"]))


class Loop:
    def __init__(self, a):
        self.a = a
        self.actor = os.environ.get("VYRE_TRACKER_ACTOR", "dispatcher")
        self.children = {}      # packet id -> {"proc", "kind", "beat"}
        self.cooldown = {}      # packet id -> until
        self.alerted = {}       # packet id -> last stale comment time
        os.makedirs(a.outbox, exist_ok=True)

    def api(self, method, path, body=None, actor=None, text=False):
        return sonnet_run.call(method, path, body, actor=actor or self.actor, text=text)

    # ---- sonnet tickets
    def tickets(self):
        out = []
        for f in sorted(os.listdir(self.a.outbox)):
            if f.endswith(".json"):
                try: out.append(json.load(open(os.path.join(self.a.outbox, f))))
                except (OSError, ValueError): pass
        return out

    def live_tickets(self):
        live = []
        for t in self.tickets():
            try: st = self.api("GET", f"/api/packets/{t['packet']}")["status"]
            except Exception: live.append(t); continue
            if st in ACTIVE: live.append(t)
            else:
                os.makedirs(os.path.join(self.a.outbox, "finished"), exist_ok=True)
                os.replace(os.path.join(self.a.outbox, f"{t['packet']}.json"), os.path.join(self.a.outbox, "finished", f"{t['packet']}.json"))
        return live

    # ---- one cycle
    def candidates(self):
        found = []
        for lane in self.a.lanes:
            try: pk = self.api("GET", f"/api/packets?lane={lane}")
            except Exception as e: print(f"lane {lane}: {e}", flush=True); continue
            found += [p for p in pk if p["status"] in ("changes_requested", "ready") or (p["status"] == "assigned" and not p.get("assignee"))]
        return order(found)

    def running_grok(self):
        for pid in [k for k, c in self.children.items() if c["proc"].poll() is not None]:
            print(f"worker for {pid} exited rc={self.children[pid]['proc'].returncode}", flush=True); del self.children[pid]
        return len(self.children)

    def cycle(self):
        launched = []
        live = self.live_tickets(); grok = self.running_grok(); now = time.time()
        for p in self.candidates():
            pid = p["id"]
            if pid in self.children or self.cooldown.get(pid, 0) > now or any(t["packet"] == pid for t in live): continue
            kind = worker_kind(p)
            if kind == "grok" and grok >= self.a.grok_max: continue
            if kind == "sonnet" and len(live) >= self.a.sonnet_max: continue
            try:
                if kind == "grok": self.start_grok(p); grok += 1
                else: live.append(self.start_sonnet(p, live)); 
            except Exception as e:
                print(f"cannot claim {pid}: {e}", flush=True); self.cooldown[pid] = now + self.a.cooldown; continue
            launched.append(f"{pid}:{kind}"); print(f"dispatch {pid} ({p['status']}, {kind})", flush=True)
        self.heartbeat(); self.stale()
        return launched

    def start_grok(self, p):
        actor = f"grok-{p['id']}"
        if p["status"] == "ready": self.api("POST", f"/api/packets/{p['id']}/assign", {"assignee": actor}, actor=self.actor)
        cmd = self.a.grok_cmd.format(here=HERE, packet=p["id"], actor=actor)
        proc = subprocess.Popen(shlex.split(cmd), stdout=open(os.path.join(self.a.outbox, f"{p['id']}.grok.log"), "ab"), stderr=subprocess.STDOUT)
        self.children[p["id"]] = {"proc": proc, "kind": "grok", "beat": time.time()}

    def start_sonnet(self, p, live):
        used = {t["slot"] for t in live}
        slot = next(i for i in range(1, self.a.sonnet_max + 1) if i not in used)
        actor = f"sonnet-w{slot}"
        if p["status"] == "ready": self.api("POST", f"/api/packets/{p['id']}/assign", {"assignee": actor}, actor=actor)
        self.api("POST", f"/api/packets/{p['id']}/start", {"assignee": actor}, actor=actor)
        brief = self.api("GET", f"/api/brief/{p['id']}", text=True)
        prompt = sonnet_run.build_prompt(p, brief, actor, slot, self.a.tracker_dir, self.a.repo, self.a.wt_root, self.a.stale_min)
        pf = os.path.join(self.a.outbox, f"{p['id']}.prompt.md"); open(pf, "w").write(prompt)
        t = {"packet": p["id"], "actor": actor, "slot": slot, "redo": p["status"] == "changes_requested", "prompt": pf, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        json.dump(t, open(os.path.join(self.a.outbox, f"{p['id']}.json"), "w"), indent=1)
        return t

    def heartbeat(self):
        for pid, c in self.children.items():
            if time.time() - c["beat"] >= self.a.heartbeat:
                try: self.api("PATCH", f"/api/packets/{pid}", {"assignee": f"grok-{pid}"}, actor=self.actor); c["beat"] = time.time()
                except Exception as e: print(f"heartbeat {pid}: {e}", flush=True)

    def stale(self):
        try: st = self.api("GET", "/api/status")
        except Exception: return []
        out = []
        for p in st.get("stale", []):
            out.append(p["id"]); print(f"STALE {p['id']} assignee={p.get('assignee')} idle since {p.get('touched_at')}", flush=True)
            if time.time() - self.alerted.get(p["id"], 0) > 3600:
                self.alerted[p["id"]] = time.time()
                try: self.api("POST", "/api/comments", {"target_kind": "packet", "target_id": p["id"], "body": f"STALE: no activity for {self.a.stale_min} minutes (assignee {p.get('assignee')}). Lead: re-assign or unblock."})
                except Exception as e: print(f"stale comment {p['id']}: {e}", flush=True)
        return out

    def run(self):
        while True:
            self.cycle()
            if self.a.once:
                while self.running_grok(): time.sleep(0.2)
                return
            time.sleep(self.a.interval)


def parse(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lanes", required=True, help="comma separated lane ids, polled in this order")
    ap.add_argument("--grok-max", type=int, default=12); ap.add_argument("--sonnet-max", type=int, default=5)
    ap.add_argument("--outbox", default=os.path.join(HERE, "outbox")); ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--heartbeat", type=int, default=600); ap.add_argument("--stale-min", type=int, default=30); ap.add_argument("--cooldown", type=int, default=600)
    ap.add_argument("--grok-cmd", default=DEFAULT_GROK_CMD, help="launch template with {here} {packet} {actor}")
    ap.add_argument("--tracker-dir", default="/Users/irfad/Claude/Orgs/Vyre/tracker"); ap.add_argument("--repo", default="/Users/irfad/Claude/Orgs/Vyre/v1"); ap.add_argument("--wt-root", default="/Users/irfad/Claude/Orgs/Vyre/v1-wt")
    ap.add_argument("--once", action="store_true", help="one cycle, wait for grok children, exit")
    a = ap.parse_args(argv); a.lanes = [x for x in a.lanes.split(",") if x]
    return a


if __name__ == "__main__":
    Loop(parse()).run()
