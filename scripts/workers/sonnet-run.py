#!/usr/bin/env python3
"""Sonnet worker side of the tracker loop (P-PR_73). Stdlib only, never runs node.

A Sonnet worker is a Claude Code subagent started by a lead session, so this file does not launch a model. It makes the
two things both sides need: the short brief the subagent receives (with the loop instructions as a template) and the
usage post that closes a run. loop.py claims the packet, calls build_prompt and drops the result in the outbox; the lead
session starts one Agent per outbox ticket.

  python3 sonnet-run.py prompt --packet P-X            print the subagent brief
  python3 sonnet-run.py usage --packet P-X --in N --out N [--cost X]
"""
import argparse, json, os, re, subprocess, sys, urllib.error, urllib.request

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

{context}
Final report to the lead: under 80 words, only returned results (shas, run links, test lines you saw).
"""

SPEC, ARCH, DECISIONS = "docs/spec/V1-SPEC.md", "docs/spec/ARCHITECTURE-V1.md", "docs/spec/ARCH-DECISIONS.md"
NAMED = {"speed": "Speed and smoothness", "native": "Vyre is the agent's native", "notheme": "No theme flash", "uirows": "UI rows"}
MAX_SECTION = 40000


def read_doc(path: str, repo: str = "", docs_root: str = "") -> str:
    """Ruling 13: spec and architecture text come from main. docs_root (tests, offline) wins; else git show origin/main:path."""
    if docs_root:
        try: return open(os.path.join(docs_root, path), encoding="utf8").read()
        except OSError: return ""
    r = subprocess.run(["git", "-C", repo, "show", f"origin/main:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def section(text: str, num: str = "", title: str = "") -> str:
    """The heading line numbered `num` (or starting with `title`) and everything under it up to the next heading of the same or higher level."""
    lines = text.split("\n"); start = None; level = 0; fence = False
    pat = re.compile(r"^(#{2,4})\s+(?:Appendix\s+)?" + re.escape(num) + r"(?:[.\s]|$)") if num else None
    out = []
    for i, ln in enumerate(lines):
        if ln.startswith("```"): fence = not fence
        m = re.match(r"^(#{1,4})\s", ln) if not fence else None
        if start is None:
            if m and ((pat and pat.match(ln)) or (title and re.match(r"^#{2,4}\s+" + re.escape(title), ln))): start = i; level = len(m.group(1)); out = [ln]
        elif m and len(m.group(1)) <= level: break
        else: out.append(ln)
    return "\n".join(out).strip()


def row_in(sec: str, tag: str) -> str:
    """The heading, table header and the row (or bullet) that starts with `tag` inside a section; the whole section when none matches."""
    lines = sec.split("\n")
    hit = [ln for ln in lines if re.match(r"^(\|\s*|-\s*\*{0,2})" + re.escape(tag) + r"\b", ln)]
    if not hit: return sec
    head = [ln for ln in lines[:4] if ln.startswith("#") or ln.startswith("| ID") or ln.startswith("| #") or ln.startswith("|---")]
    return "\n".join(head + hit)


def spec_text(ref: str, spec: str) -> str:
    ref = ref.strip()
    if ref in NAMED: return section(spec, title=NAMED[ref])
    m = re.match(r"^(\d+(?:\.\d+)*)(?:\s+(\S+))?$", ref)
    if not m: return ""
    sec = section(spec, num=m.group(1))
    if not m.group(2): return sec
    tag = m.group(2)
    if re.match(r"^b\d+$", tag): return row_in(sec, tag)
    keep = [ln for ln in sec.split("\n") if tag.lower() in ln.lower()]   # a topic word such as "networking": the lines that carry it
    return "\n".join([sec.split("\n")[0]] + keep) if keep else sec


def arch_text(ref: str, arch: str, decisions: str) -> str:
    ref = ref.strip()
    m = re.match(r"^ARCH-DECISIONS\s+(\d+)$", ref)
    if m:   # the decisions file is a numbered list, one item per line
        hit = [ln for ln in decisions.split("\n") if ln.startswith(m.group(1) + ". ")]
        return "\n".join(hit)
    m = re.match(r"^ARCH\s+(\d+(?:\.\d+)*)(?:\s+([A-Z]\d+))?$", ref)
    if m:
        sec = section(arch, num=m.group(1))
        return row_in(sec, m.group(2)) if m.group(2) else sec
    m = re.match(r"^([A-Z]\d+)$", ref)       # bare F10: the row in the frozen-items table (ARCH 12.2)
    if m: return row_in(section(arch, num="12.2"), m.group(1))
    return ""


def build_context(packet: dict, repo: str = "", docs_root: str = "") -> str:
    """Ruling 13: lane brief plus the full text of every spec and architecture section the packet references, so a worker never has to find them."""
    spec, arch, dec = (read_doc(p, repo, docs_root) for p in (SPEC, ARCH, DECISIONS))
    parts = []
    lane = packet.get("lane_id") or ""
    lane_doc = read_doc(f"docs/lanes/{lane}.md", repo, docs_root) if lane else ""
    parts.append(f"=== LANE BRIEF (docs/lanes/{lane}.md) ===\n{lane_doc.strip() or '(no lane brief on main for this lane)'}")
    for ref in packet.get("spec_refs") or []:
        t = spec_text(ref, spec)
        parts.append(f"=== SPEC {ref} (docs/spec/V1-SPEC.md) ===\n{(t[:MAX_SECTION] if t else '(section not found on main: ask the lead before guessing)')}")
    for ref in packet.get("arch_refs") or []:
        t = arch_text(ref, arch, dec)
        parts.append(f"=== {ref} (docs/spec/{'ARCH-DECISIONS' if ref.startswith('ARCH-DEC') else 'ARCHITECTURE-V1'}.md) ===\n{(t[:MAX_SECTION] if t else '(section not found on main: ask the lead before guessing)')}")
    return "\n\n".join(parts) + "\n"


def build_prompt(packet: dict, brief: str, actor: str, slot: int, tracker_dir: str, repo: str, wt_root: str, stale_min: int = 30, docs_root: str = "") -> str:
    pid = packet["id"]
    owned = "\n".join(f"  {g}" for g in packet.get("owns_files") or []) or "  (none declared)"
    return TEMPLATE.format(actor=actor, pid=pid, title=packet.get("title", ""), tracker_dir=tracker_dir, repo=repo, wt_root=wt_root,
                           slot=slot, branch=f"packet/{pid}", here=os.path.dirname(os.path.abspath(__file__)), stale_min=stale_min, owned=owned, brief=brief.strip(), context=build_context(packet, repo, docs_root))


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
    p.add_argument("--tracker-dir", default="/Users/irfad/Claude/Orgs/Vyre/tracker"); p.add_argument("--repo", default="/Users/irfad/Claude/Orgs/Vyre/v1"); p.add_argument("--wt-root", default="/Users/irfad/Claude/Orgs/Vyre/v1-wt"); p.add_argument("--docs-root", default="")
    u = sub.add_parser("usage"); u.add_argument("--packet", required=True); u.add_argument("--in", dest="tin", type=int, required=True); u.add_argument("--out", dest="tout", type=int, required=True); u.add_argument("--cost", type=float, default=0.0)
    a = ap.parse_args()
    if a.mode == "prompt":
        pk = call("GET", f"/api/packets/{a.packet}")
        print(build_prompt(pk, call("GET", f"/api/brief/{a.packet}", text=True), a.actor, a.slot, a.tracker_dir, a.repo, a.wt_root, docs_root=a.docs_root))
    else:
        post_usage(a.packet, a.tin, a.tout, a.cost); print("usage posted")


if __name__ == "__main__":
    main()
