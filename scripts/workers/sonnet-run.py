#!/usr/bin/env python3
"""Sonnet worker side of the tracker loop (P-PR_73). Stdlib only, never runs node.

A Sonnet worker is a Claude Code subagent started by a lead session, so this file does not launch a model. It makes the
two things both sides need: the short brief the subagent receives (with the loop instructions as a template) and the
usage post that closes a run. loop.py claims the packet, calls build_prompt and drops the result in the outbox; the lead
session starts one Agent per outbox ticket.

  python3 sonnet-run.py prompt --packet P-X            print the subagent brief
  python3 sonnet-run.py usage --packet P-X --in N --out N [--cost X]
"""
import argparse, json, os, re, sys, urllib.error, urllib.request

TEMPLATE = """You are tracker worker "{actor}" for Vyre v1. Packet {pid}: {title}
Tracker CLI: cd {tracker_dir}; export VYRE_TRACKER_ACTOR={actor}; python3 trk.py ...

LOOP (same steps for every worker kind):
1. python3 trk.py brief {pid}   (the claim is done: status is in_progress and you are the assignee)
2. Work in your own worktree: git -C {repo} fetch; git -C {repo} worktree add {wt_root}/{pid}-{slot} -b {branch} origin/main
   (a changes_requested packet continues on the existing remote branch {branch}; read the lead's note first: trk show {pid})
3. Edit only the owned files below. Commits credit Irfad Imtiaz only: no Co-Authored-By, no Generated-with. No ts-nocheck, no ts-ignore, never edit changelog.md.
4. Never run node or npm on this machine. Push the branch; CI runs everything. Poll gh run view every 2 to 3 minutes.
5. Tick each checklist item with its own evidence: trk.py check {pid} N "evidence". Named tests must show ok in the linked CI run. Post proofs: trk.py proof {pid} KIND REF pass.
6. trk.py submit {pid} "note". After approval open a PR and squash-merge once green.
7. Post usage: python3 {here}/sonnet-run.py usage --packet {pid} --in TOKENS_IN --out TOKENS_OUT
8. Heartbeat: any trk check, comment or proof counts. A packet silent for {stale_min} minutes is flagged stale. If blocked: trk.py block {pid} "why".

OWNED FILES (only these):
{owned}

PACKET BRIEF:
{brief}

Final report to the lead: under 80 words, only returned results (shas, run links, test lines you saw).
"""


def build_prompt(packet: dict, brief: str, actor: str, slot: int, tracker_dir: str, repo: str, wt_root: str, stale_min: int = 30) -> str:
    pid = packet["id"]
    owned = "\n".join(f"  {g}" for g in packet.get("owns_files") or []) or "  (none declared)"
    return TEMPLATE.format(actor=actor, pid=pid, title=packet.get("title", ""), tracker_dir=tracker_dir, repo=repo, wt_root=wt_root,
                           slot=slot, branch=f"packet/{pid}", here=os.path.dirname(os.path.abspath(__file__)), stale_min=stale_min, owned=owned, brief=brief.strip())


def token() -> str:
    t = os.environ.get("VYRE_TRACKER_TOKEN")
    if t: return t
    try:
        for line in open(os.environ.get("VYRE_ENV_FILE", "")):
            m = re.match(r"\s*(?:export\s+)?VYRE_TRACKER_TOKEN\s*=\s*(.*?)\s*$", line)
            if m: return m.group(1).strip("'\"")
    except OSError: pass
    sys.exit("sonnet-run: no VYRE_TRACKER_TOKEN")


def call(method: str, path: str, body=None, actor=None, text=False):
    url = os.environ.get("VYRE_TRACKER_URL", "http://127.0.0.1:7790").rstrip("/")
    req = urllib.request.Request(url + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-Tracker-Token": token(), "X-Actor": actor or os.environ.get("VYRE_TRACKER_ACTOR", "sonnet-worker"), "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: raw = r.read().decode()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"tracker {method} {path}: HTTP {e.code} {e.read().decode()[:200]}")
    return raw if text else json.loads(raw)["data"]


def post_usage(packet_id: str, tin: int, tout: int, cost: float = 0.0) -> dict:
    lane = call("GET", f"/api/packets/{packet_id}")["lane_id"]
    return call("POST", "/api/usage", {"lane": lane, "worker": "sonnet", "tokens_in": tin, "tokens_out": tout, "cost_est": cost})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)
    p = sub.add_parser("prompt"); p.add_argument("--packet", required=True); p.add_argument("--actor", default="sonnet-w1"); p.add_argument("--slot", type=int, default=1)
    p.add_argument("--tracker-dir", default="/Users/irfad/Claude/Orgs/Vyre/tracker"); p.add_argument("--repo", default="/Users/irfad/Claude/Orgs/Vyre/v1"); p.add_argument("--wt-root", default="/Users/irfad/Claude/Orgs/Vyre/v1-wt")
    u = sub.add_parser("usage"); u.add_argument("--packet", required=True); u.add_argument("--in", dest="tin", type=int, required=True); u.add_argument("--out", dest="tout", type=int, required=True); u.add_argument("--cost", type=float, default=0.0)
    a = ap.parse_args()
    if a.mode == "prompt":
        pk = call("GET", f"/api/packets/{a.packet}")
        print(build_prompt(pk, call("GET", f"/api/brief/{a.packet}", text=True), a.actor, a.slot, a.tracker_dir, a.repo, a.wt_root))
    else:
        post_usage(a.packet, a.tin, a.tout, a.cost); print("usage posted")


if __name__ == "__main__":
    main()
