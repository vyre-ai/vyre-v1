"""Evidence and test-file checks for the Grok harness (hour-1 dry run fixes, P-PR_74 follow-up).

Pure functions, stdlib only, no node/npm. dispatch.py imports this; tests/test_evidence.py covers it.

What it replaces:
- TEST_FILE_RE over the whole checklist text (a prose mention of route.test.ts became a required file).
- ok lines read from one CI log only (a fix push re-selects fewer tests, so earlier ok lines were lost).
- worker-written evidence for items the CI or the harness can prove itself (setup read, lanes-check, manifest flip, perf).
"""
import os, re

ANSI = re.compile(r"\x1b\[[0-9;]*m|\^\[\[[0-9;]*m")
TEST_PATH = r"[\w@./-]+/[\w@.-]+\.test\.(?:tsx|ts|mjs|js)"
# "Write and pass <path>: ..." : the path right after the verb is the required file. Any other .test.ts in the sentence is prose.
WRITE_RE = re.compile(r"^\s*(?:write|add|create)\s+(?:and\s+pass\s+)?(`?)(" + TEST_PATH + r")\1", re.I)
RUN_LINE = re.compile(r"(?m)(?:^|[\s\t])(ok|FAIL)\s+(" + TEST_PATH + r"|[\w@.-]+\.test\.(?:tsx|ts|mjs|js))\b")


def required_tests(checklist):
    """[(pos, path)] for items that say 'Write and pass <path>'. Prose mentions of other test files are ignored."""
    out = []
    for it in checklist:
        m = WRITE_RE.match(it["text"])
        if m: out.append((it["pos"], m.group(2)))
    return out


def prompt_block(checklist):
    """Exact-path rule for the worker prompt (UI packets wrote tests next to the source while the checklist named apps/app/tests/...)."""
    req = required_tests(checklist)
    if not req: return ""
    lines = "\n".join(f"  item {p}: {path}" for p, path in req)
    return ("REQUIRED TEST FILES (exact paths; the harness checks these before it pushes and again in the CI log):\n" + lines +
            "\nA test file at any other path, or a stub with no test() calls, does not count. Put the real tests at these paths.\n")


def preflight(wt, checklist, changed, owns=None, match=None):
    """Problems visible before push: required test file missing, a stub, or not part of the diff. Returns [str].
    A required path outside the packet's owned globs is not the worker's to create and is skipped."""
    probs = []
    for pos, path in required_tests(checklist):
        if owns and match and not match(path, owns): continue
        full = os.path.join(wt, path)
        if not os.path.isfile(full):
            near = [c for c in changed if os.path.basename(c) == os.path.basename(path)]
            probs.append(f"item {pos}: {path} does not exist" + (f" (you wrote {near[0]}; move it to the exact path)" if near else ""))
            continue
        src = open(full, errors="replace").read()
        if len(re.findall(r"\b(?:test|it)\s*\(", src)) < 1 or len([l for l in src.splitlines() if l.strip()]) < 5:
            probs.append(f"item {pos}: {path} is a stub (needs real test() cases)")
        elif path not in changed:
            probs.append(f"item {pos}: {path} exists but is not in your diff")
    return probs


def foreign_imports(wt, files):
    """Cheap stand-in for boundaries.ts: a relative import in a changed modules/<m>/ file that climbs into another module."""
    bad = []
    for f in files:
        m = re.match(r"^(modules/[^/]+)/", f)
        if not m or not f.endswith((".ts", ".tsx", ".mjs", ".js")): continue
        base = os.path.dirname(f)
        try: src = open(os.path.join(wt, f), errors="replace").read()
        except OSError: continue
        for imp in re.findall(r"""(?:from|import)\s*\(?\s*["'](\.{1,2}/[^"']+)["']""", src):
            tgt = os.path.normpath(os.path.join(base, imp)).replace("\\", "/")
            if tgt.startswith("modules/") and not tgt.startswith(m.group(1) + "/"): bad.append(f"{f} -> {imp}")
    return bad


class CiState:
    """Latest known result per test file across every CI run of this job. A fix push re-selects only affected tests, so
    a file that passed in the first run and was not re-selected stays ok; one that failed and was not re-selected stays failed."""

    def __init__(self): self.files = {}; self.runs = []; self.lines = []

    def add_log(self, run_url, text):
        text = ANSI.sub("", text or "")
        self.runs.append(run_url)
        for status, f in RUN_LINE.findall(text): self.files[f] = (status, run_url)
        self.lines += [l for l in text.splitlines() if re.search(r"\b(median|p95|p50|perf|first_token|under \d+ ?ms)\b", l, re.I)][:40]

    def failed(self): return sorted(f for f, (st, _) in self.files.items() if st == "FAIL")

    def status(self, path):
        """('ok'|'FAIL'|'missing', matched_path, note). Exact path wins; else a unique file with the same basename counts but is flagged."""
        for k, (st, _) in self.files.items():
            if k == path or k.endswith("/" + path) or path.endswith("/" + k): return st, k, ""
        base = os.path.basename(path)
        alts = [k for k in self.files if os.path.basename(k) == base]
        if len(alts) == 1: return self.files[alts[0]][0], alts[0], f"ran as {alts[0]}, not {path}"
        return "missing", "", ""


def verify_required(checklist, state):
    """(files, problems). A problem is a required file that is FAIL, misplaced or never ran."""
    files, probs = [], []
    for pos, path in required_tests(checklist):
        st, k, note = state.status(path)
        files.append(path)
        if st == "ok" and not note: continue
        probs.append(f"{path}: " + ("FAIL" if st == "FAIL" else f"ok but {note}" if st == "ok" else "no ok line in any CI run of this branch"))
    return files, probs


def job_facts(jobs):
    """jobs = [{name, conclusion}] from `gh run view --json jobs`. check.yml jobs: select, shards (matrix names), check, golden, contracts, budget."""
    f = {"contracts": None, "check": None, "golden": None, "budget": None, "any_failed": []}
    for j in jobs or []:
        n, c = j.get("name", ""), j.get("conclusion")
        for key in ("contracts", "check", "golden", "budget"):
            if n == key or n.startswith(key + " "): f[key] = c
        if c not in (None, "success", "skipped", "neutral"): f["any_failed"].append(n)
    return f


def manifest_flipped(diff_text):
    """True when the manifest diff adds a line that says live."""
    return any(re.search(r"\blive\b", l) for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++"))


def auto_evidence(it, ctx):
    """One-line evidence the harness can stand behind, or None. ctx keys: state, facts, run_url, owns_ok, foreign, changed,
    manifest_diff, tests_ok (all required tests verified), worker_done (callable item -> bool)."""
    t = it["text"].lower(); facts, state = ctx["facts"], ctx["state"]; url = ctx.get("run_url", "")
    green = not facts.get("any_failed")
    if it.get("kind") == "setup" and "gen" in t and "check" in t:
        if facts.get("contracts") == "success" and green:
            return f"contracts job success in {url} (drift check runs when manifests/generated/contracts change)"
        return None
    if "lanes-check" in t:
        if ctx.get("owns_ok") and not ctx.get("foreign") and facts.get("contracts") == "success" and green:
            return (f"harness: all {len(ctx.get('changed', []))} changed files inside owns_files, no import into another module; "
                    f"contracts and check jobs green in {url}")
        return None
    if "flip status" in t and "manifest" in t:
        if ctx.get("manifest_diff") and manifest_flipped(ctx["manifest_diff"]) and facts.get("contracts") == "success" and green:
            return f"manifest diff sets status live; contracts job and generated contract tests green in {url}"
        return None
    if it.get("proof_kind") == "perf" or (it.get("kind") == "proof" and "perf" in t):
        if ctx.get("tests_ok") and ctx.get("worker_done") and ctx["worker_done"](it):
            line = state.lines[0].strip()[:160] if state.lines else ""
            return f"perf asserted by test files ok in CI ({url})" + (f"; log: {line}" if line else "")
        return None
    return None
