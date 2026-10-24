#!/usr/bin/env python3
"""Vyre Grok worker harness (P-PR_71): one headless Grok per ready packet, each in its own isolated git clone.

Stdlib only. Never runs node/npm. Usage: python3 scripts/workers/grok-run.py help
Deny rules and secret paths live in deny-rules.json next to this file. Paths and the tracker come from the environment
(VYRE_TRACKER_URL, VYRE_TRACKER_TOKEN, VYRE_V1_REPO, VYRE_WT_ROOT, VYRE_HARNESS_LOG, VYRE_GH, VYRE_GROK) so the same file runs on
the Mac and on a CI runner with fakes.
"""
import shutil, argparse, concurrent.futures as cf, datetime, fnmatch, json, os, re, shlex, subprocess, sys, threading, time
import urllib.request, urllib.error

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
- When done, commit, then write .harness/report.json: {"done":[<checklist numbers finished>],"evidence":{"<n>":"one line"},"summary":"..."}.
  (.harness/ is ignored by the harness diff check.) Then stop. Do not push; the harness pushes and runs CI.
"""

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
    text = f"{'' if job.get('bare_prompt') else REPO_RULES}\nOWNED FILES (the only paths you may change):\n{owned}\n\n=== PACKET BRIEF ===\n{job['brief']}\n{extra}"
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


def run_grok(job, prompt_path, args):
    prof = os.path.join(job["wt"], ".harness", "sandbox.sb")
    gb = getattr(args, "grok_bin", None)
    use_sandbox = not getattr(args, "no_sandbox", False) and os.path.exists(SANDBOX_EXEC)
    if use_sandbox: open(prof, "w").write(sandbox_profile(job, [os.path.dirname(os.path.abspath(gb))] if gb else []))
    cmd = ([SANDBOX_EXEC, "-f", prof] if use_sandbox else []) + [getattr(args, "grok_bin", None) or GROK, "--prompt-file", prompt_path, "--cwd", job["wt"], "--permission-mode", "bypassPermissions",
           "--reasoning-effort", args.effort, "--output-format", "json", "--max-turns", str(args.max_turns)]
    if args.model: cmd += ["--model", args.model]
    for d in DENY: cmd += ["--deny", d]
    out = os.path.join(LOG_DIR, f"{job['id']}.grok.out")
    t0 = time.time()
    env = dict(os.environ)
    for k in list(env):  # keep vault-sourced credentials out of the worker's environment
        if re.search(_RULES["env_strip"], k) and k not in _RULES["env_keep"]: env.pop(k)
    with open(out, "ab") as f:
        try:
            r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, timeout=args.timeout, env=env, cwd=job["wt"])
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = -9
    dur = time.time() - t0
    text = open(out, errors="replace").read()
    return rc, dur, text


def parse_usage(text, prompt=""):
    """Prefer grok's own usage block; else estimate from sizes (prompt tokens x ~8 context re-reads, output chars/4)."""
    try:
        u = json.loads(text[text.index("{"):]).get("usage") or {}
        tin = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0)) + int(u.get("cache_creation_input_tokens", 0))
        tout = int(u.get("output_tokens", 0))
        if tin or tout: return tin, tout
    except Exception: pass
    return (len(prompt) // 4) * 8, len(text) // 4


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


def ci_wait(job, args):
    """Wait until CI run(s) for the pushed sha EXIST and COMPLETE. Returns (ok, url, log_text, run_id).
    Desktop (Tauri) jobs add GitHub-hosted macos-latest/windows-latest runs that start late and run long: for those the
    dispatcher re-checks after a settle pause so a late-appearing run is not missed. Logs of all runs are joined."""
    wt = job["wt"]; sha = sh(["git", "rev-parse", "HEAD"], cwd=wt).stdout.strip()
    deadline = time.time() + args.ci_timeout; seen = False; settled = 0
    settle = getattr(args, "settle", 90) if job.get("desktop") else 0
    while True:
        r = sh([GH, "run", "list", "--commit", sha, "--json", "databaseId,headSha,status,conclusion,url", "--limit", "20"], cwd=wt, check=False)
        try: runs = [x for x in json.loads(r.stdout or "[]") if x["headSha"] == sha]
        except Exception: runs = []
        if runs: seen = True
        if runs and all(x["status"] == "completed" for x in runs):
            if settle and settled < 2 and time.time() + settle < deadline:
                settled += 1; log(job, f"all {len(runs)} runs done; settling {settle}s for late desktop runs"); time.sleep(settle); continue
            urls = " ".join(x["url"] for x in runs)
            job["ci_runs"] = [x["url"] for x in runs]
            bad = [x for x in runs if x["conclusion"] != "success"]
            if not bad:
                lg = "\n".join(sh([GH, "run", "view", str(x["databaseId"]), "--log"], cwd=wt, check=False).stdout for x in runs)
                return True, runs[0]["url"], lg, runs[0]["databaseId"]
            lg = "\n".join(sh([GH, "run", "view", str(x["databaseId"]), "--log-failed"], cwd=wt, check=False).stdout for x in bad)
            return False, bad[0]["url"], lg[-6000:], bad[0]["databaseId"]
        if time.time() >= deadline: break
        log(job, f"ci pending ({'no run yet' if not runs else str(sum(x['status'] != 'completed' for x in runs)) + ' of ' + str(len(runs)) + ' running'}), sleeping {args.ci_poll}s")
        time.sleep(args.ci_poll)
    return False, "", ("CI run never appeared for " if not seen else "CI run did not finish for ") + sha[:8], None


TEST_FILE_RE = re.compile(r"[\w./@-]+\.test\.(?:ts|tsx|mjs|js)")


def verify_tests(packet, log_text):
    """Every test file named in the checklist must show an 'ok' line in the runner output. Returns problems."""
    files = []
    for it in packet["checklist"]:
        for f in TEST_FILE_RE.findall(it["text"]):
            if f not in files: files.append(f)
    probs = []
    for f in files:
        if re.search(r"(?m)\bok\s+" + re.escape(f) + r"\b", log_text): continue
        fail = re.search(r"(?m)\bFAIL\s+" + re.escape(f), log_text)
        probs.append(f"{f}: {'FAIL' if fail else 'no ok line in the run log'}")
    return files, probs


def is_proof_item(it):
    t = it["text"].lower()
    return it.get("kind") == "proof" or t.startswith("post the test run output") or (it.get("proof_kind") == "test_run" and "post " in t[:6])


def run_job(job, args, trk=None):
    """Full lifecycle for one job. Returns a result dict (also used by rehearsal)."""
    res = {"id": job["id"], "ok": False, "stage": "start", "worker_s": 0, "total_s": 0, "retries": 0, "rate_limited": False, "tokens_out": 0}
    t0 = time.time()
    try:
        make_worktree(job)
        extra = ""
        for attempt in range(args.retries + 1):
            res["stage"] = "grok"
            pp = write_prompt(job, extra)
            log(job, f"grok attempt {attempt + 1} start")
            rc, dur, text = run_grok(job, pp, args)
            res["worker_s"] += dur
            tin, tout = parse_usage(text, open(pp).read()); res["tokens_out"] += tout; res["tokens_in"] = res.get("tokens_in", 0) + tin
            if trk and job.get("lane"):
                try: trk.usage(job["lane"], "grok", tin, tout, round((tin * 3 + tout * 15) / 1e6, 4))
                except Exception as e: log(job, f"usage post failed: {e}")
            if RATE_RE.search(text[-3000:]) and rc != 0: res["rate_limited"] = True
            log(job, f"grok exit {rc} in {dur:.0f}s")
            if rc != 0 and not changed_files(job["wt"], job["base"]):
                extra = f"\n\nPREVIOUS ATTEMPT FAILED (exit {rc}). Output tail:\n{text[-1500:]}\n"
                res["retries"] += 1; res["error"] = f"grok exit {rc}"
                if attempt < args.retries: time.sleep(5 * (attempt + 1))
                continue
            res["stage"] = "ownership"
            verify_clone(job)
            files = commit_leftovers(job)
            viol = [f for f in files if job["owns"] and not glob_match(f, job["owns"])]
            if viol:
                res["error"] = f"owns_files violation: {viol[:10]}"
                log(job, res["error"])
                extra = f"\n\nREJECTED: you edited files you do not own: {viol[:10]}. Revert them (git checkout {job['base']} -- <file>) and keep only owned paths.\n"
                res["retries"] += 1
                continue
            bad = check_commits(job)
            if bad:
                res["error"] = f"commit attribution rule broken: {bad[:3]}"
                extra = "\n\nREJECTED: commit message or author breaks the credit rule (no Co-Authored-By, no 'Generated with', no 'claude'). Amend is forbidden; add nothing else, the harness will rewrite messages.\n"
                sh(["git", "filter-branch", "-f", "--msg-filter", "grep -vi -e co-authored -e 'generated with'", f"{job['base']}..HEAD"], cwd=job["wt"], check=False)
                if check_commits(job): res["retries"] += 1; continue
            if not files and not args.allow_empty:
                res["error"] = "worker produced no changes"; res["retries"] += 1
                extra = "\n\nPREVIOUS ATTEMPT MADE NO CHANGES. Do the work.\n"; continue
            res["files"] = sorted(files)
            res["stage"] = "push"
            safe_push(job)
            if args.no_ci:
                res.update(ok=True, stage="pushed", ci="skipped"); break
            res["stage"] = "ci"
            ok, url, tail, run_id = ci_wait(job, args)
            res["ci"] = url; res["ci_runs"] = job.get("ci_runs", [])
            if ok and trk and job.get("pid"):
                files, probs = verify_tests(trk.packet(job["pid"]), tail)
                res["verified_tests"] = files
                if probs:
                    ok = False; url = url or "ci:none"
                    tail = "Tests named in the checklist did not pass in the CI log:\n" + "\n".join(probs) + "\n\nLog excerpt:\n" + \
                        "\n".join(l for l in tail.splitlines() if re.search(r"\b(ok|FAIL)\b|files,", l))[-3000:]
            if trk and job.get("pid"): trk.proof(job["pid"], "test_run", " ".join(job.get("ci_runs") or [url or "ci:none"]), "pass" if ok else "fail")
            if ok: res.update(ok=True, stage="ci-pass"); break
            res["error"] = "ci failed"
            if trk and job.get("pid"): trk.comment(job["pid"], f"CI/verify failed ({url}). Log tail:\n{tail[-1800:]}")
            extra = f"\n\nCI FAILED. Fix it and commit. Failed log tail:\n{tail}\n"
            res["retries"] += 1
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
    for it in p["checklist"]:
        if it["done"]: continue
        named = set(TEST_FILE_RE.findall(it["text"]))
        if is_proof_item(it):  # harness owns the proof item: CI passed and every named test file showed ok
            trk.check(it["id"], f"CI runs {' '.join(res.get('ci_runs') or [res.get('ci')])}: all named test files ok ({', '.join(sorted(verified)) or 'none named'})")
        elif named and named <= verified:
            trk.check(it["id"], f"ok in CI run {res.get('ci')}")
        elif str(it["pos"]) in done:
            trk.check(it["id"], f"{ev.get(str(it['pos']), 'worker report')} (branch {job['branch']}, ci {res.get('ci')})")
    try:
        trk.post(job["pid"], "submit", {"note": f"branch {job['branch']}; ci {res.get('ci')}; {rep.get('summary', '')[:300]}"})
        log(job, "submitted for review")
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
    return {"id": pid, "pid": pid, "lane": p["lane_id"], "title": p["title"], "owns": p["owns_files"], "brief": brief,
            "repo": args.repo, "base": args.base, "branch": f"packet/{pid}", "wt": os.path.join(args.wt_root, pid),
            "redispatch": redo, "merge_poll": args.merge_poll, "pr_base": args.pr_base, "desktop": bool(DESKTOP_RE.search(text))}


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
    ap.add_argument("--grok-bin"); ap.add_argument("--model"); ap.add_argument("--effort", default="high"); ap.add_argument("--max-turns", type=int, default=60)
    ap.add_argument("--timeout", type=int, default=2400, help="seconds per grok run")
    ap.add_argument("--retries", type=int, default=1); ap.add_argument("--poll", type=int, default=60)
    ap.add_argument("--ci-poll", type=int, default=120); ap.add_argument("--ci-timeout", type=int, default=1800)
    ap.add_argument("--settle", type=int, default=90, help="extra wait for late desktop runs"); ap.add_argument("--no-ci", action="store_true"); ap.add_argument("--allow-empty", action="store_true")
    ap.add_argument("--once", action="store_true"); ap.add_argument("--keep", action="store_true")
    ap.add_argument("--no-sandbox", action="store_true", help="skip sandbox-exec (CI runners, tests with fakes)")
    ap.add_argument("--merge-poll", type=int, default=300); ap.add_argument("--pr-base", default="main")
    a = ap.parse_args()
    os.makedirs(LOG_DIR, exist_ok=True)
    if a.mode == "help": ap.print_help(); return
    {"loop": cmd_loop, "one": cmd_one, "rehearse": cmd_rehearse}[a.mode](a)


if __name__ == "__main__":
    main()
