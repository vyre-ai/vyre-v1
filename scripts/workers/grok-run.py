#!/usr/bin/env python3
"""Vyre Grok worker harness (P-PR_71): one headless Grok per ready packet, each in its own isolated git clone.

Stdlib only. Never runs node/npm. Usage: python3 scripts/workers/grok-run.py help
Deny rules and secret paths live in deny-rules.json next to this file. Paths and the tracker come from the environment
(VYRE_TRACKER_URL, VYRE_TRACKER_TOKEN, VYRE_V1_REPO, VYRE_WT_ROOT, VYRE_HARNESS_LOG, VYRE_GH, VYRE_GROK) so the same file runs on
the Mac and on a CI runner with fakes.
"""
import shutil, argparse, concurrent.futures as cf, datetime, fnmatch, json, os, re, shlex, subprocess, sys, threading, time
import urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence

HERE = os.path.dirname(os.path.abspath(__file__))
TRACKER_DIR = os.environ.get("VYRE_TRACKER_DIR", "/Users/irfad/Claude/Orgs/Vyre/tracker")
GROK = os.environ.get("VYRE_GROK") or os.path.expanduser("~/.grok/bin/grok")
GH = os.environ.get("VYRE_GH", "gh")
DEFAULT_REPO = os.environ.get("VYRE_V1_REPO", "/Users/irfad/Claude/Orgs/Vyre/v1")
WT_ROOT = os.environ.get("VYRE_WT_ROOT", "/Users/irfad/Claude/Orgs/Vyre/v1-wt")
LOG_DIR = os.environ.get("VYRE_HARNESS_LOG", os.path.join(os.path.expanduser("~"), ".vyre-harness-logs"))
SANDBOX_EXEC = "/usr/bin/sandbox-exec"
FORBIDDEN_MSG = re.compile(r"co-authored-by|generated with|claude", re.I)
LOCK = threading.Lock()

REPO_RULES = """REPO RULES (hard, from the owner):
- Credit Irfad Imtiaz only. Never add Co-Authored-By, "Generated with", or any AI attribution to commits, files or PR text.
- Conventional commits (feat:, fix:, test:, docs:, refactor:, chore:). Commit by path: git commit -m "msg" -- <paths>.
- NEVER run node, npm, npx, pnpm or yarn on this machine. Push your branch; CI runs the tests. Read CI results with gh only.
- Edit ONLY the files in the packet's owned list. Anything else is rejected by the harness and your work fails.
- No history rewrites (reset, rebase, stash, force push). No em dashes in prose or code comments.
- Do not read anything under ~/Claude/simba/secrets. Do not use the network except git push and gh.
- Work only inside the current directory (your worktree). Do not delete anything outside it.
- Generated files change only through the generator's refresh command, never by hand.
- READING BUDGET: the brief and spec excerpts below are everything you were given. Do not re-read them from disk. Read each repo file at most
  once; use grep -n and ranged reads (sed -n 'a,bp') for files over 300 lines; never open generated/ or node_modules. At most 25 file reads in total,
  then write code. Think briefly: plan once, then edit. Do not narrate.
- The harness proves these items itself from CI: the setup read/gen check, the lanes-check/boundaries item, the manifest flip, the test-run proof and
  every named test. You only write code, the test files at their exact paths, and report.json for the rest.
- When done, commit, then write .harness/report.json: {"done":[<checklist numbers finished>],"evidence":{"<n>":"one line"},"summary":"..."}.
  (.harness/ is ignored by the harness diff check.) Then stop. Do not push; the harness pushes and runs CI.
"""

# ---- ruling 13: spec context (same code as scripts/workers/sonnet-run.py in the v1 repo, P-PR_73)
SPEC, ARCH, DECISIONS = "docs/spec/V1-SPEC.md", "docs/spec/ARCHITECTURE-V1.md", "docs/spec/ARCH-DECISIONS.md"
NAMED = {"speed": "Speed and smoothness", "native": "Vyre is the agent's native", "notheme": "No theme flash", "uirows": "UI rows"}
MAX_SECTION = 12000      # per spec or architecture section; was 40000. The brief is given once; the worker greps the repo for the rest
MAX_CONTEXT = 48000      # whole context block, chars (about 12k tokens)


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
    out = "\n\n".join(parts) + "\n"
    if len(out) > MAX_CONTEXT:   # keep the lane brief whole, trim the tail sections evenly
        out = out[:MAX_CONTEXT] + "\n(context trimmed to " + str(MAX_CONTEXT) + " chars; grep docs/spec for the rest, one targeted read, never the whole file)\n"
    return out


_RULES = json.load(open(os.path.join(HERE, "deny-rules.json")))
DENY = _RULES["deny"]


def now(): return datetime.datetime.now().strftime("%H:%M:%S")


def log(job, msg):
    line = f"[{now()}] {job['id']}: {msg}"
    with LOCK: print(line, flush=True)
    with open(os.path.join(LOG_DIR, f"{job['id']}.log"), "a") as f: f.write(line + "\n")


def sh(args, cwd=None, check=True, timeout=None, env=None):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    if check and r.returncode:
        raise RuntimeError(f"{' '.join(shlex.quote(a) for a in args)} -> {r.returncode}: {(r.stderr or r.stdout)[-600:]}")
    return r


# ---------- tracker ----------
class Tracker:
    def __init__(self, actor):
        self.actor = actor
        os.environ["VYRE_TRACKER_ACTOR"] = actor
        self.url = os.environ.get("VYRE_TRACKER_URL", "http://127.0.0.1:7790")

    def _token(self):
        if os.environ.get("VYRE_TRACKER_TOKEN"): return os.environ["VYRE_TRACKER_TOKEN"]
        sys.path.insert(0, TRACKER_DIR)
        import trk  # the tracker's own lookup (falls back to .env.simba)
        return trk.token()

    def _call(self, method, path, body=None, text=False):
        # trk.call exits the process on error; do our own so one packet cannot kill the dispatcher
        req = urllib.request.Request(self.url + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"X-Tracker-Token": self._token(), "X-Actor": self.actor, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r: raw = r.read().decode()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"tracker {method} {path}: HTTP {e.code} {e.read().decode()[:300]}")
        return raw if text else json.loads(raw)["data"]

    def next(self, lane): return (self._call("GET", f"/api/next?lane={lane}") or {}).get("packet")
    def packet(self, pid): return self._call("GET", f"/api/packets/{pid}")
    def brief(self, pid): return self._call("GET", f"/api/brief/{pid}", text=True)
    def post(self, pid, action, body=None): return self._call("POST", f"/api/packets/{pid}/{action}", body or {})
    def proof(self, pid, kind, ref, result): return self._call("POST", f"/api/packets/{pid}/proofs", {"kind": kind, "ref": ref, "result": result})
    def usage(self, lane, worker, tin, tout, cost): return self._call("POST", "/api/usage", {"lane": lane, "worker": worker, "tokens_in": tin, "tokens_out": tout, "cost_est": cost})
    def comment(self, pid, text): return self._call("POST", "/api/comments", {"target_kind": "packet", "target_id": pid, "body": text})
    def check(self, item_id, evidence): return self._call("PATCH", f"/api/checklist/{item_id}", {"done": 1, "evidence": evidence})


# ---------- jobs ----------
def glob_match(path, pats):
    for p in pats:
        rx = re.escape(p).replace(r"\*\*/", "(?:.*/)?").replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
        if re.fullmatch(rx, path): return True
    return False


def changed_files(wt, base):
    out = set()
    for cmd in (["git", "diff", "--name-only", f"{base}...HEAD"], ["git", "diff", "--name-only"],
                ["git", "ls-files", "--others", "--exclude-standard"]):
        out |= {l for l in sh(cmd, cwd=wt).stdout.splitlines() if l}
    return {f for f in out if not f.startswith(".harness/")}


def remote_url(repo):
    return sh(["git", "remote", "get-url", "origin"], cwd=repo).stdout.strip()


def make_worktree(job):
    """Isolated full clone (no hardlinks, no shared .git) so a worker can never touch another branch's refs."""
    repo, wt, br = job["repo"], job["wt"], job["branch"]
    job["remote"] = job.get("remote") or remote_url(repo)
    if os.path.isdir(wt):
        if not job.get("redispatch"): return
        shutil.rmtree(wt)
    job["remote"] = job.get("remote") or remote_url(repo)
    sh(["git", "clone", "--quiet", "--no-hardlinks", repo, wt])
    sh(["git", "remote", "set-url", "origin", job["remote"]], cwd=wt)
    sh(["git", "config", "core.hooksPath", "/dev/null"], cwd=wt)
    sh(["git", "fetch", "--quiet", "origin"], cwd=wt)
    has = sh(["git", "ls-remote", "--heads", "origin", br], cwd=wt, check=False).stdout.strip()
    # a re-dispatched (changes_requested) packet continues on its own pushed branch
    sh(["git", "checkout", "--quiet", "--no-track", "-B", br, f"origin/{br}" if has else job["base"]], cwd=wt)
    os.makedirs(os.path.join(wt, ".harness"), exist_ok=True)
    ex = os.path.join(wt, ".git", "info", "exclude")
    os.makedirs(os.path.dirname(ex), exist_ok=True)
    with open(ex, "a") as f: f.write(".harness/\n")


def write_prompt(job, extra=""):
    owned = "\n".join(f"  {g}" for g in job["owns"]) or "  (none declared)"
    ctx = job.get("context") or ""
    req = evidence.prompt_block(job.get("checklist") or [])
    text = f"{'' if job.get('bare_prompt') else REPO_RULES}\nOWNED FILES (the only paths you may change):\n{owned}\n\n{req}\n=== PACKET BRIEF ===\n{job['brief']}\n{('\n' + ctx) if ctx else ''}\n{extra}"
    if job.get("continue_prompt") and extra:   # a continued session already holds the brief; send only the new instruction
        text = extra.strip() + "\n\n" + req
    p = os.path.join(job["wt"], ".harness", "prompt.md")
    open(p, "w").write(text)
    return p


HOME = os.path.expanduser("~")
SECRET_PATHS = [os.path.expanduser(p) for p in _RULES["secret_paths"]]


def sandbox_profile(job, extra_read=()):
    """sandbox-exec (SBPL, last matching rule wins). Network stays open: SBPL cannot filter by hostname."""
    wt = os.path.realpath(job["wt"])
    q = lambda p: '(subpath "%s")' % p.replace('"', '')
    rules = ["(version 1)", "(allow default)",
             # writes: only the worker's own clone, tmp and ~/.grok (grok sessions)
             "(deny file-write*)",
             "(allow file-write* %s %s %s %s (literal \"/dev/null\") (regex #\"^/dev/(tty|fd/)\"))" % (q(wt), q(HOME + "/.grok"), q("/private/tmp"), q("/private/var/folders")),
             # reads: home is closed except what the worker needs
             "(deny file-read* %s)" % q(HOME),
             "(allow file-read* %s %s (literal \"%s\") (literal \"%s\"))" % (q(wt), q(HOME + "/.grok"), HOME + "/.gitconfig", HOME),
             "(allow file-read-metadata %s)" % q(HOME),
             *["(allow file-read* %s)" % q(p) for p in extra_read],
             "(allow file-read* %s)" % q(HOME + "/.local"),
             ]
    rules += ["(deny file-read* file-write* %s)" % q(p) for p in SECRET_PATHS]
    return "\n".join(rules).replace('\\"', '"')


SLOW_LANES = {"L1", "L4"}   # sync and files packets hit 2400 s in the dry run


def grok_timeout(job, args):
    if args.timeout: return args.timeout
    return 3000 if (job.get("lane") in SLOW_LANES) else 2400


def run_grok(job, prompt_path, args):
    prof = os.path.join(job["wt"], ".harness", "sandbox.sb")
    gb = getattr(args, "grok_bin", None)
    use_sandbox = not getattr(args, "no_sandbox", False) and os.path.exists(SANDBOX_EXEC)
    if use_sandbox: open(prof, "w").write(sandbox_profile(job, [os.path.dirname(os.path.abspath(gb))] if gb else []))
    cmd = ([SANDBOX_EXEC, "-f", prof] if use_sandbox else []) + [getattr(args, "grok_bin", None) or GROK, "--prompt-file", prompt_path, "--cwd", job["wt"], "--permission-mode", "bypassPermissions",
           "--reasoning-effort", args.effort, "--output-format", "json", "--max-turns", str(args.max_turns)]
    if job.get("continue_session"): cmd.insert(cmd.index("--prompt-file"), "--continue")   # CI-fix rounds keep the worker's session: no second read of the repo
    if args.model: cmd += ["--model", args.model]
    for d in DENY: cmd += ["--deny", d]
    out = os.path.join(LOG_DIR, f"{job['id']}.grok.out")
    t0 = time.time()
    start = os.path.getsize(out) if os.path.exists(out) else 0   # the log is appended per attempt; usage must come from this attempt only
    env = dict(os.environ)
    for k in list(env):  # keep vault-sourced credentials out of the worker's environment
        if re.search(_RULES["env_strip"], k) and k not in _RULES["env_keep"]: env.pop(k)
    with open(out, "ab") as f:
        try:
            r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=grok_timeout(job, args), env=env, cwd=job["wt"])
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = -9
    dur = time.time() - t0
    with open(out, "rb") as f:
        f.seek(start); text = f.read().decode("utf8", "replace")
    return rc, dur, text


def parse_usage(text, prompt=""):
    """(tokens_in incl. cache reads, tokens_out, detail). Prefer grok's own usage block; else estimate from sizes."""
    try:
        j, _ = json.JSONDecoder().raw_decode(text[text.index("{"):]); u = j.get("usage") or {}   # grok may append "Error: max turns reached" after the JSON
        tin = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
        tout = int(u.get("output_tokens", 0))
        if tin or tout:
            return tin, tout, {"input_fresh": int(u.get("input_tokens", 0)), "cache_read": int(u.get("cache_read_input_tokens", 0)), "output": tout,
                               "reasoning": int(u.get("reasoning_tokens", 0)), "turns": j.get("num_turns"), "cost_usd": j.get("total_cost_usd")}
    except Exception: pass
    return (len(prompt) // 4) * 8, len(text) // 4, {"estimated": True}


RATE_RE = re.compile(r"429|rate.?limit|too many requests|overloaded|quota|503|capacity", re.I)


def commit_leftovers(job):
    wt = job["wt"]
    files = sorted(changed_files(wt, job["base"]) )
    dirty = [l[3:] for l in sh(["git", "status", "--porcelain"], cwd=wt).stdout.splitlines()]
    dirty = [d for d in dirty if not d.startswith(".harness")]
    if dirty:
        sh(["git", "add", "--"] + dirty, cwd=wt)
        sh(["git", "commit", "-m", f"feat: {job['title'][:60]}", "--"] + dirty, cwd=wt)
    return files


def check_commits(job):
    msgs = sh(["git", "log", "--format=%an <%ae>%n%B%n--", f"{job['base']}..HEAD"], cwd=job["wt"]).stdout
    bad = [l for l in msgs.splitlines() if FORBIDDEN_MSG.search(l)]
    return bad


UNSAFE_CFG = re.compile(r"fsmonitor|sshcommand|insteadof|pushurl|helper|alias\.|pager|editor|askpass|gpg|\[include", re.I)


def verify_clone(job):
    """Worker controls its .git/config, so verify before the dispatcher runs git there, then push to an explicit URL."""
    wt = job["wt"]
    cfg = open(os.path.join(wt, ".git", "config")).read()
    url = sh(["git", "remote", "get-url", "origin"], cwd=wt).stdout.strip()
    if url != job["remote"]: raise RuntimeError(f"remote URL tampered: {url!r} != {job['remote']!r}")
    bad = UNSAFE_CFG.findall(cfg)
    bad += [l.strip() for l in cfg.splitlines() if re.match(r"\s*hookspath", l, re.I) and l.split("=", 1)[1].strip() != "/dev/null"]
    if bad: raise RuntimeError(f"unsafe git config in worker clone: {bad[:3]}")
    if os.path.exists(os.path.join(wt, ".git", "hooks")) and any(not f.endswith(".sample") for f in os.listdir(os.path.join(wt, ".git", "hooks"))):
        raise RuntimeError("worker clone has live hooks")
    return wt


def safe_push(job):
    verify_clone(job); wt = job["wt"]
    sh(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "push", "--quiet", job["remote"], f"HEAD:refs/heads/{job['branch']}"], cwd=wt)


DESKTOP_RE = re.compile(r"macos|windows|tauri|desktop", re.I)


DESKTOP_PATH_RE = re.compile(r"(^|/)(desktop|src-tauri|tauri)(/|\.)|apps/desktop", re.I)


def gh_json(args_, wt, default):
    r = sh([GH] + args_, cwd=wt, check=False)
    try: return json.loads(r.stdout or "")
    except Exception: return default


def ci_wait(job, args):
    """Wait until CI run(s) for the pushed sha EXIST and COMPLETE. Returns (ok, url, log_text, run_id).
    Desktop jobs: when the diff touches desktop paths (or the packet text says so) the dispatcher requires a run whose workflow name
    contains 'desktop' to appear (re-checking up to 3 settle pauses), then waits for it to finish. If it never appears the note
    'desktop run never appeared' goes into job['ci_notes'] and CI is judged on the runs that exist (desktop.yml is workflow_call only
    today, so a push does not start it). Also records per-run job conclusions in job['ci_jobs'] for evidence.auto_evidence."""
    wt = job["wt"]; sha = sh(["git", "rev-parse", "HEAD"], cwd=wt).stdout.strip()
    deadline = time.time() + args.ci_timeout; seen = False; settled = 0
    want_desktop = bool(job.get("desktop")) or any(DESKTOP_PATH_RE.search(f) for f in changed_files(wt, job["base"]))
    settle = getattr(args, "settle", 90) if want_desktop else 0
    job.setdefault("ci_notes", [])
    while True:
        runs = [x for x in gh_json(["run", "list", "--commit", sha, "--json", "databaseId,headSha,status,conclusion,url,workflowName", "--limit", "20"], wt, []) if x["headSha"] == sha]
        if runs: seen = True
        if runs and all(x["status"] == "completed" for x in runs):
            have_desktop = any("desktop" in (x.get("workflowName") or "").lower() for x in runs)
            if settle and not have_desktop and settled < 3 and time.time() + settle < deadline:
                settled += 1; log(job, f"{len(runs)} runs done, no desktop run yet; settling {settle}s ({settled}/3)"); time.sleep(settle); continue
            if settle and not have_desktop: job["ci_notes"].append("desktop run never appeared for " + sha[:8])
            job["ci_runs"] = [x["url"] for x in runs]
            jobs = []
            for x in runs:
                jobs += (gh_json(["run", "view", str(x["databaseId"]), "--json", "jobs"], wt, {}) or {}).get("jobs", [])
            job["ci_jobs"] = [{"name": j.get("name", ""), "conclusion": j.get("conclusion")} for j in jobs]
            # desktop/native runs are continue-on-error upstream and never block: a red desktop run does not fail the packet unless a test file failed in it
            bad = [x for x in runs if x["conclusion"] != "success" and "desktop" not in (x.get("workflowName") or "").lower()]
            lg_all = "\n".join(sh([GH, "run", "view", str(x["databaseId"]), "--log"], cwd=wt, check=False).stdout for x in runs)
            if not bad: return True, runs[0]["url"], lg_all, runs[0]["databaseId"]
            lg = "\n".join(sh([GH, "run", "view", str(x["databaseId"]), "--log-failed"], cwd=wt, check=False).stdout for x in bad)
            job["ci_log_full"] = lg_all
            return False, bad[0]["url"], lg[-6000:], bad[0]["databaseId"]
        if time.time() >= deadline: break
        log(job, f"ci pending ({'no run yet' if not runs else str(sum(x['status'] != 'completed' for x in runs)) + ' of ' + str(len(runs)) + ' running'}), sleeping {args.ci_poll}s")
        time.sleep(args.ci_poll)
    return False, "", ("CI run never appeared for " if not seen else "CI run did not finish for ") + sha[:8], None


def failed_tests_in(text):
    return sorted(set(f for st, f in evidence.RUN_LINE.findall(evidence.ANSI.sub("", text or "")) if st == "FAIL"))


def is_proof_item(it):
    t = it["text"].lower()
    return it.get("kind") == "proof" or t.startswith("post the test run output") or (it.get("proof_kind") == "test_run" and "post " in t[:6])


def record_usage(job, res, trk, attempt, tin, tout, d):
    """One row per attempt: tracker usage (real cost when Grok reports it) and harness/logs/usage.jsonl."""
    row = {"id": job["id"], "attempt": attempt, "tokens_in": tin, "tokens_out": tout, **d, "at": now()}
    res.setdefault("usage", []).append(row)
    with open(os.path.join(LOG_DIR, "usage.jsonl"), "a") as f: f.write(json.dumps(row) + "\n")
    cost = d.get("cost_usd") if d.get("cost_usd") is not None else round((tin * 0.2 + tout * 15) / 1e6, 4)
    if trk and job.get("lane"):
        try: trk.usage(job["lane"], "grok", tin, tout, cost)
        except Exception as e: log(job, f"usage post failed: {e}")


def run_job(job, args, trk=None):
    """Full lifecycle for one job. Returns a result dict (also used by rehearsal)."""
    res = {"id": job["id"], "ok": False, "stage": "start", "worker_s": 0, "total_s": 0, "retries": 0, "rate_limited": False, "tokens_out": 0}
    t0 = time.time()
    state = evidence.CiState(); job["ci_state"] = state
    last_pushed = None; have_session = False
    try:
        make_worktree(job)
        if trk and job.get("pid") and not job.get("checklist"): job["checklist"] = trk.packet(job["pid"])["checklist"]
        extra = ""
        for attempt in range(args.retries + 1):
            res["stage"] = "grok"
            job["continue_session"] = bool(have_session and extra and getattr(args, "continue_fix", True) and job.get("fix_round"))
            job["continue_prompt"] = job["continue_session"]
            pp = write_prompt(job, extra)
            log(job, f"grok attempt {attempt + 1} start" + (" (continuing session)" if job["continue_session"] else ""))
            rc, dur, text = run_grok(job, pp, args)
            res["worker_s"] += dur
            tin, tout, ud = parse_usage(text, open(pp).read()); res["tokens_out"] += tout; res["tokens_in"] = res.get("tokens_in", 0) + tin
            record_usage(job, res, trk, attempt + 1, tin, tout, ud)
            have_session = have_session or ud.get("estimated") is None
            if RATE_RE.search(text[-3000:]) and rc != 0: res["rate_limited"] = True
            log(job, f"grok exit {rc} in {dur:.0f}s; tokens in {tin} out {tout} {ud}")
            if rc != 0 and "max turns reached" in text[-400:] and attempt < args.retries:
                # out of turns, not out of ideas: keep the session, stop exploring, finish (a fresh restart re-reads the whole repo)
                res["retries"] += 1; res["error"] = "max turns reached"; job["fix_round"] = True
                extra = ("\n\nTURN LIMIT REACHED. Stop reading files. Write the remaining code and the required test files now from what you already know, "
                         "commit, and write .harness/report.json. Do not start new exploration.\n")
                continue
            head = sh(["git", "rev-parse", "HEAD"], cwd=job["wt"]).stdout.strip()
            if rc != 0 and not changed_files(job["wt"], job["base"]):
                extra = f"\n\nPREVIOUS ATTEMPT FAILED (exit {rc}). Output tail:\n{text[-1500:]}\n"
                res["retries"] += 1; res["error"] = f"grok exit {rc}"
                if attempt < args.retries: time.sleep(5 * (attempt + 1))
                continue
            res["stage"] = "ownership"
            verify_clone(job)
            files = commit_leftovers(job)
            head = sh(["git", "rev-parse", "HEAD"], cwd=job["wt"]).stdout.strip()
            if last_pushed and head == last_pushed:   # dry-run issue 5: a fix attempt that crashed or changed nothing must not re-wait on the old CI run
                res["error"] = f"fix attempt made no new commit (grok exit {rc})"; log(job, res["error"]); res["retries"] += 1
                break
            viol = [f for f in files if job["owns"] and not glob_match(f, job["owns"])]
            if viol:
                res["error"] = f"owns_files violation: {viol[:10]}"
                log(job, res["error"])
                extra = f"\n\nREJECTED: you edited files you do not own: {viol[:10]}. Revert them (git checkout {job['base']} -- <file>) and keep only owned paths.\n"
                res["retries"] += 1; job["fix_round"] = True
                continue
            bad = check_commits(job)
            if bad:
                res["error"] = f"commit attribution rule broken: {bad[:3]}"
                sh(["git", "filter-branch", "-f", "--msg-filter", "grep -vi -e co-authored -e 'generated with'", f"{job['base']}..HEAD"], cwd=job["wt"], check=False)
                if check_commits(job):
                    extra = "\n\nREJECTED: commit message or author breaks the credit rule (no Co-Authored-By, no 'Generated with', no 'claude').\n"
                    res["retries"] += 1; job["fix_round"] = True; continue
            if not files and not args.allow_empty:
                res["error"] = "worker produced no changes"; res["retries"] += 1
                extra = "\n\nPREVIOUS ATTEMPT MADE NO CHANGES. Do the work.\n"; continue
            pre = evidence.preflight(job["wt"], job.get("checklist") or [], files, job["owns"], lambda p, o: glob_match(p, o)) if job.get("checklist") else []
            if pre and attempt < args.retries:   # cheap local round instead of a failed CI run
                res["error"] = "preflight: " + "; ".join(pre)[:300]; log(job, res["error"]); res["retries"] += 1; job["fix_round"] = True
                extra = "\n\nPRE-PUSH CHECK FAILED (nothing was pushed). Fix these, commit, update report.json:\n" + "\n".join(pre) + "\n"
                continue
            res["files"] = sorted(files)
            res["stage"] = "push"
            safe_push(job); last_pushed = head
            if args.no_ci:
                res.update(ok=True, stage="pushed", ci="skipped"); break
            res["stage"] = "ci"
            ok, url, tail, run_id = ci_wait(job, args)
            res["ci"] = url; res["ci_runs"] = job.get("ci_runs", [])
            full = job.pop("ci_log_full", None) or (tail if ok else "")
            state.add_log(url or "ci:none", full)
            foreign = []
            if not ok and full:
                # failures in test files the packet does not own (shared flake such as batch3.screen.test.tsx): rerun once, then pass with a note
                fails = failed_tests_in(full)
                foreign = [f for f in fails if job["owns"] and not glob_match(f, job["owns"])]
                if fails and len(foreign) == len(fails) and run_id and not job.get("rerun_done"):
                    job["rerun_done"] = True; log(job, f"only foreign test files failed {foreign[:3]}; rerunning failed jobs once")
                    sh([GH, "run", "rerun", str(run_id), "--failed"], cwd=job["wt"], check=False); time.sleep(20)
                    ok, url, tail, run_id = ci_wait(job, args); res["ci"] = url; res["ci_runs"] = job.get("ci_runs", [])
                    full = job.pop("ci_log_full", None) or (tail if ok else ""); state.add_log(url or "ci:none", full)
                    fails = failed_tests_in(full); foreign = [f for f in fails if job["owns"] and not glob_match(f, job["owns"])]
                if not ok and fails and len(foreign) == len(fails):
                    ok = True; job["ci_notes"].append("accepted with foreign failing test files (not owned, not changed): " + ", ".join(foreign[:4]))
            if ok and trk and job.get("pid"):
                files_v, probs = evidence.verify_required(job.get("checklist") or [], state)
                res["verified_tests"] = [] if probs else files_v
                if probs:
                    ok = False; url = url or "ci:none"
                    tail = "Tests named in the checklist did not pass in the CI logs of this branch:\n" + "\n".join(probs) + "\n\nLog excerpt:\n" + \
                        "\n".join(l for l in full.splitlines() if re.search(r"\b(ok|FAIL)\b.*\.test\.|files,", l))[-2500:]
            if trk and job.get("pid"): trk.proof(job["pid"], "test_run", " ".join(job.get("ci_runs") or [url or "ci:none"]), "pass" if ok else "fail")
            if ok: res.update(ok=True, stage="ci-pass"); break
            res["error"] = "ci failed"
            if trk and job.get("pid"): trk.comment(job["pid"], f"CI/verify failed ({url}). Log tail:\n{tail[-1800:]}")
            extra = f"\n\nCI FAILED. Fix it and commit. Failed log tail:\n{tail[-3000:]}\n"
            res["retries"] += 1; job["fix_round"] = True
        if res["ok"] and trk and job.get("pid"):
            res["stage"] = "submit"
            submit(job, trk, res)
        elif not res["ok"] and trk and job.get("pid"):
            trk.post(job["pid"], "block", {"reason": f"harness: {res.get('error')} (stage {res['stage']})"})
    except Exception as e:
        res["error"] = f"{type(e).__name__}: {e}"
        log(job, "EXCEPTION " + res["error"])
        if trk and job.get("pid"):
            try: trk.post(job["pid"], "block", {"reason": "harness crash: " + res["error"][:300]})
            except Exception: pass
    res["total_s"] = time.time() - t0
    res["ci_notes"] = job.get("ci_notes", [])
    log(job, f"result ok={res['ok']} stage={res['stage']} err={res.get('error')}")
    return res


def submit(job, trk, res):
    p = trk.packet(job["pid"])
    rep = {}
    try: rep = json.load(open(os.path.join(job["wt"], ".harness", "report.json")))
    except Exception: pass
    done = set(map(str, rep.get("done", [])))
    ev = rep.get("evidence", {})
    verified = set(res.get("verified_tests", []))
    wt = job["wt"]; state = job["ci_state"]
    changed = sorted(changed_files(wt, job["base"]))
    mdiff = sh(["git", "diff", f"{job['base']}...HEAD", "--", "manifests"], cwd=wt, check=False).stdout
    foreign = evidence.foreign_imports(wt, changed)
    facts = evidence.job_facts(job.get("ci_jobs"))
    required = evidence.required_tests(p["checklist"])
    ctx = {"state": state, "facts": facts, "run_url": res.get("ci") or "", "owns_ok": all(glob_match(f, job["owns"]) for f in changed) if job["owns"] else True,
           "foreign": foreign, "changed": changed, "manifest_diff": mdiff, "tests_ok": bool(required) and set(f for _, f in required) <= verified,
           "worker_done": lambda it: str(it["pos"]) in done}
    for it in p["checklist"]:
        if it["done"]: continue
        named = {path for pos, path in required if pos == it["pos"]}
        auto = evidence.auto_evidence(it, ctx)
        if is_proof_item(it) and it.get("proof_kind") != "perf":  # harness owns the proof item: CI passed and every required test file showed ok
            trk.check(it["id"], f"CI runs {' '.join(res.get('ci_runs') or [res.get('ci')])}: all required test files ok ({', '.join(sorted(verified)) or 'none named'})" + ("; " + "; ".join(job.get("ci_notes", [])) if job.get("ci_notes") else ""))
        elif auto:
            trk.check(it["id"], auto)
        elif named and named <= verified:
            trk.check(it["id"], f"ok in CI {state.files.get(sorted(named)[0], ('', res.get('ci')))[1]}")
        elif str(it["pos"]) in done:
            trk.check(it["id"], f"{ev.get(str(it['pos']), 'worker report')} (branch {job['branch']}, ci {res.get('ci')})")
    try:
        trk.post(job["pid"], "submit", {"note": f"branch {job['branch']}; ci {res.get('ci')}; {rep.get('summary', '')[:300]}" + (f"; notes: {'; '.join(job.get('ci_notes', []))}" if job.get("ci_notes") else "")})
        log(job, "submitted for review")
        if not os.environ.get("VYRE_NO_MERGE"):   # dry runs and retests never open or merge PRs
            t = threading.Thread(target=merge_after_approval, args=(job, trk, res), name=f"merge-{job['id']}")
            t.start(); MERGERS.append(t)
    except Exception as e:
        res["ok"] = False; res["error"] = f"submit refused: {e}"
        trk.comment(job["pid"], f"harness: submit refused, checklist incomplete. {e}")


MERGERS = []


def merge_after_approval(job, trk, res, limit=3600):
    """Poll the tracker every 5 min up to 60 min; once the packet is done (approved), open the PR and squash-merge it."""
    poll = job.get("merge_poll", 300); deadline = time.time() + limit
    while time.time() < deadline:
        time.sleep(poll)
        try: st = trk.packet(job["pid"])["status"]
        except Exception as e: log(job, f"merge poll failed: {e}"); continue
        if st == "done": break
        if st in ("changes_requested", "blocked"): log(job, f"not merging, packet is {st}"); return
    else:
        log(job, "approval not seen within 60 min; PR left unopened"); return
    wt = job["wt"]
    try:
        subj = sh(["git", "log", "-1", "--format=%s"], cwd=wt).stdout.strip()
        url = sh([GH, "pr", "create", "--base", job.get("pr_base", "main"), "--head", job["branch"], "--title", subj,
                  "--body", f"Packet {job['pid']}: {job['title']}\n\nCI: {res.get('ci')}"], cwd=wt, check=False).stdout.strip().splitlines()
        sh([GH, "pr", "merge", job["branch"], "--squash", "--delete-branch", "--subject", subj, "--body", f"Packet {job['pid']}"], cwd=wt)
        log(job, f"squash-merged {url[-1] if url else job['branch']}"); res["merged"] = True
        trk.comment(job["pid"], f"harness: PR squash-merged ({url[-1] if url else job['branch']})")
    except Exception as e:
        log(job, f"merge failed: {e}"); trk.comment(job["pid"], f"harness: merge failed, do it by hand. {str(e)[:300]}")


# ---------- modes ----------
def changes_block(trk, p):
    """Lead's request-changes note plus open comments from others, for the top of the prompt."""
    notes = [a for a in p.get("approvals", []) if a.get("decision") == "changes"]
    out = ["=== CHANGES REQUESTED (read first; this is a re-dispatch on your existing branch) ==="]
    if notes: out.append(f"Lead ({notes[-1]['at']}): {notes[-1]['note']}")
    for c in p.get("comments", []):
        if not c.get("resolved") and c.get("author") != trk.actor:
            out.append(f"Comment #{c['id']} by {c['author']}: {c['body']}")
    out.append("Fix exactly what is asked, keep prior work that was accepted, commit, and update .harness/report.json. The branch already contains your earlier commits.\n=== END CHANGES ===\n")
    return "\n".join(out)


def packet_job(trk, pid, args):
    p = trk.packet(pid)
    redo = p["status"] == "changes_requested"
    brief = trk.brief(pid)
    if redo: brief = changes_block(trk, p) + "\n" + brief
    text = brief + " ".join(i["text"] for i in p["checklist"])
    subprocess.run(["git", "-C", args.repo, "fetch", "-q", "origin", "main"], capture_output=True)   # ruling 13: spec text comes from current main
    return {"context": build_context(p, args.repo), "id": pid, "pid": pid, "lane": p["lane_id"], "title": p["title"], "owns": p["owns_files"], "brief": brief,
            "repo": args.repo, "base": args.base, "branch": f"{os.environ.get('VYRE_BRANCH_PREFIX', 'packet')}/{pid}", "wt": os.path.join(args.wt_root, pid),
            "redispatch": redo, "merge_poll": args.merge_poll, "pr_base": args.pr_base, "desktop": bool(DESKTOP_RE.search(text)), "checklist": p["checklist"]}


def cmd_loop(args):
    trk = Tracker(args.actor)
    lanes = args.lanes.split(",")
    running = {}
    ex = cf.ThreadPoolExecutor(max_workers=args.concurrency)
    print(f"dispatcher up: lanes={lanes} concurrency={args.concurrency} once={args.once}", flush=True)
    while True:
        for f in [f for f in running.values() if f.done()]:
            running = {k: v for k, v in running.items() if v is not f}
        if len(running) < args.concurrency:
            for lane in lanes:
                if len(running) >= args.concurrency: break
                try: pk = trk.next(lane)
                except Exception as e: print("next failed", e); continue
                if not pk or pk["id"] in running: continue
                pid = pk["id"]
                try:
                    if pk["status"] == "ready": trk.post(pid, "assign", {"assignee": args.actor})
                    trk.post(pid, "start")
                except Exception as e:
                    print(f"cannot claim {pid}: {e}"); continue
                job = packet_job(trk, pid, args)
                running[pid] = ex.submit(run_job, job, args, trk)
                print(f"launched {pid} ({len(running)}/{args.concurrency})", flush=True)
        if args.once and not running: break
        time.sleep(args.poll)
    ex.shutdown()
    for t in MERGERS: t.join()


def cmd_one(args):
    trk = Tracker(args.actor)
    pid = args.packet
    st = trk.packet(pid)["status"]
    try:
        if st == "ready": trk.post(pid, "assign", {"assignee": args.actor})
        trk.post(pid, "start")
    except Exception as e: print("claim note:", e)
    print(json.dumps(run_job(packet_job(trk, pid, args), args, trk), indent=1))
    for t in MERGERS: t.join()


def setup_scratch(root):
    """A scratch origin (bare) with a main branch, so rehearsal never touches vyre-v1."""
    origin = os.path.join(root, "origin.git"); seed = os.path.join(root, "seed")
    if not os.path.isdir(origin):
        sh(["git", "init", "--bare", "-b", "main", origin])
        sh(["git", "clone", origin, seed])
        open(os.path.join(seed, "README.md"), "w").write("# scratch\n")
        sh(["git", "add", "."], cwd=seed); sh(["git", "commit", "-m", "chore: seed"], cwd=seed); sh(["git", "push", "origin", "main"], cwd=seed)
    return origin, seed


def cmd_rehearse(args):
    root = os.environ.get("VYRE_HARNESS_SCRATCH", os.path.join(os.path.expanduser("~"), ".vyre-harness-scratch")); os.makedirs(root, exist_ok=True)
    origin, seed = setup_scratch(root)
    wtroot = os.path.join(root, "wt"); os.makedirs(wtroot, exist_ok=True)
    args.no_ci = True; args.allow_empty = False
    n = args.n; tag = f"r{int(time.time()) % 100000}"
    jobs = []
    for i in range(n):
        jid = f"{tag}-{i:02d}"
        jobs.append({"id": jid, "pid": None, "lane": None, "title": f"add README line {jid}", "owns": [f"notes/{jid}.md"],
            "brief": f"Create the file notes/{jid}.md containing exactly one line: 'rehearsal {jid}'. Then commit it with message 'docs: add rehearsal note {jid}'. Write .harness/report.json. Do nothing else.",
            "repo": seed, "base": "origin/main", "branch": f"rehearsal/{jid}", "wt": os.path.join(wtroot, jid)})
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=n) as ex: results = list(ex.map(lambda j: run_job(j, args, None), jobs))
    wall = time.time() - t0
    ok = sum(r["ok"] for r in results)
    summary = {"n": n, "ok": ok, "wall_s": round(wall), "avg_worker_s": round(sum(r["worker_s"] for r in results) / n),
               "avg_total_s": round(sum(r["total_s"] for r in results) / n), "rate_limited": sum(r["rate_limited"] for r in results),
               "retries": sum(r["retries"] for r in results), "errors": [r.get("error") for r in results if not r["ok"]]}
    print("SUMMARY " + json.dumps(summary))
    open(os.path.join(LOG_DIR, "rehearsal-results.jsonl"), "a").write(json.dumps({"at": now(), **summary}) + "\n")
    if not args.keep:  # tidy worktrees and branches
        for j in jobs:
            shutil.rmtree(j["wt"], ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description="Vyre Grok worker harness")
    ap.add_argument("mode", choices=["loop", "one", "rehearse", "help"])
    ap.add_argument("--lanes", default="L4,L8,L9b,L9c,L9d,L9e,L9f,L10", help="grok lanes to poll (loop)")
    ap.add_argument("--packet"); ap.add_argument("-n", type=int, default=2, help="rehearsal task count")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--repo", default=DEFAULT_REPO); ap.add_argument("--base", default="origin/main")
    ap.add_argument("--wt-root", default=WT_ROOT); ap.add_argument("--actor", default="sonnet-harness")
    ap.add_argument("--grok-bin"); ap.add_argument("--model"); ap.add_argument("--effort", default="medium", help="grok reasoning effort; high kept ~430 KB of reasoning in context per packet"); ap.add_argument("--max-turns", type=int, default=70)
    ap.add_argument("--timeout", type=int, default=0, help="seconds per grok run; 0 = by lane (3000 for L1 and L4, 2400 otherwise)")
    ap.add_argument("--no-continue-fix", dest="continue_fix", action="store_false", help="CI-fix rounds start a fresh session instead of --continue")
    ap.add_argument("--retries", type=int, default=1); ap.add_argument("--poll", type=int, default=60)
    ap.add_argument("--ci-poll", type=int, default=120); ap.add_argument("--ci-timeout", type=int, default=1800)
    ap.add_argument("--settle", type=int, default=90, help="extra wait for late desktop runs"); ap.add_argument("--no-ci", action="store_true"); ap.add_argument("--allow-empty", action="store_true")
    ap.add_argument("--no-sandbox", action="store_true", help="skip sandbox-exec (CI runners, tests with fakes)")
    ap.add_argument("--merge-poll", type=int, default=300); ap.add_argument("--pr-base", default="main")
    ap.add_argument("--once", action="store_true"); ap.add_argument("--keep", action="store_true")
    a = ap.parse_args()
    os.makedirs(LOG_DIR, exist_ok=True)
    if a.mode == "help": ap.print_help(); return
    {"loop": cmd_loop, "one": cmd_one, "rehearse": cmd_rehearse}[a.mode](a)


if __name__ == "__main__":
    main()
