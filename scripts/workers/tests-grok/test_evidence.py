import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import evidence as ev

L2 = [
 {"pos": 4, "kind": "test", "text": "Write and pass agent/tests/turn-engine.queue.test.ts: route() decisions match lib route.test.ts table; hop-limit test stops loops"},
 {"pos": 5, "kind": "test", "text": "Write and pass agent/tests/turn-engine.listen.test.ts: no-inference-for-listener: zero provider calls"},
 {"pos": 1, "kind": "setup", "text": "Read docs/lanes/L2.md and trk.py brief; run `npm run gen -- --check` and confirm"},
]
ANSI_LOG = "fast-1\tRun the shard\t2026-10-24T19:03:21.5Z ok   modules/logs/tests/sink.test.ts 5186 ms\nfast-1\tx\t2026-10-24T19:03:22Z ok   agent/tests/turn-engine.queue.test.ts (cached)\nfast-2\tx\t2026-10-24T19:03:22Z \x1b[31mFAIL\x1b[0m ui/src/__screens__/batch3.screen.test.tsx 183 ms\n"


class T(unittest.TestCase):
    def test_prose_test_name_not_required(self):
        self.assertEqual([p for _, p in ev.required_tests(L2)], ["agent/tests/turn-engine.queue.test.ts", "agent/tests/turn-engine.listen.test.ts"])

    def test_state_carries_across_pushes(self):
        st = ev.CiState(); st.add_log("run1", ANSI_LOG)
        st.add_log("run2", "ok   agent/tests/turn-engine.listen.test.ts 900 ms\n")   # fix push re-selected only this one
        files, probs = ev.verify_required(L2, st)
        self.assertEqual(probs, [])
        self.assertEqual(st.failed(), ["ui/src/__screens__/batch3.screen.test.tsx"])

    def test_missing_and_misplaced(self):
        st = ev.CiState(); st.add_log("r", "ok   apps/app/src/home.test.tsx 10 ms\n")
        cl = [{"pos": 3, "kind": "test", "text": "Write and pass apps/app/tests/home.test.tsx: renders"}]
        _, probs = ev.verify_required(cl, st)
        self.assertTrue("ran as" in probs[0])
        _, probs = ev.verify_required([{"pos": 3, "kind": "test", "text": "Write and pass modules/logs/tests/search.test.ts: x"}], st)
        self.assertTrue("no ok line" in probs[0])

    def test_preflight_stub_and_move(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(d + "/apps/app/tests"); os.makedirs(d + "/apps/app/src")
            open(d + "/apps/app/tests/home.test.tsx", "w").write("// todo\n")
            open(d + "/apps/app/src/work.test.tsx", "w").write("test('a', () => {\n})\n" * 4)
            cl = [{"pos": 3, "text": "Write and pass apps/app/tests/home.test.tsx: x"}, {"pos": 4, "text": "Write and pass apps/app/tests/work.test.tsx: y"}]
            pr = ev.preflight(d, cl, ["apps/app/tests/home.test.tsx", "apps/app/src/work.test.tsx"])
            self.assertIn("stub", pr[0]); self.assertIn("you wrote apps/app/src/work.test.tsx", pr[1])

    def test_auto_evidence(self):
        st = ev.CiState(); st.add_log("r", "perf send median 120 ms under 150 ms\nok   agent/tests/turn-engine.queue.test.ts 5 ms\n")
        facts = ev.job_facts([{"name": "contracts", "conclusion": "success"}, {"name": "check", "conclusion": "success"}, {"name": "fast-1", "conclusion": "success"}])
        ctx = {"state": st, "facts": facts, "run_url": "U", "owns_ok": True, "foreign": [], "changed": ["a"], "manifest_diff": "+  status: 'live',\n", "tests_ok": True, "worker_done": lambda it: True}
        self.assertIn("contracts job success", ev.auto_evidence(L2[2], ctx))
        self.assertIn("inside owns_files", ev.auto_evidence({"kind": "test", "text": "Run scripts/lanes-check.ts, boundaries"}, ctx))
        self.assertIn("status live", ev.auto_evidence({"kind": "proof", "text": "Flip status stub to live in the manifest of tasks"}, ctx))
        self.assertIn("perf asserted", ev.auto_evidence({"kind": "proof", "proof_kind": "perf", "pos": 6, "text": "perf send"}, ctx))
        ctx["facts"] = ev.job_facts([{"name": "contracts", "conclusion": "failure"}])
        self.assertIsNone(ev.auto_evidence(L2[2], ctx))

    def test_flip(self):
        cl = [{"pos": 5, "text": "Flip status stub to live in the manifest of tasks; its generated contract tests pass"}]
        self.assertEqual(ev.flip_targets(cl), ["manifests/tasks.ts"])
        self.assertTrue(ev.flip_ok("--- a\n+++ b\n@@\n+  status: 'live',\n"))
        self.assertTrue(ev.flip_ok("-  status: 'stub',\n+  status: 'live',\n"))
        self.assertFalse(ev.flip_ok("+  status: 'live',\n+  foo: 1,\n"))
        self.assertFalse(ev.flip_ok(""))

    def test_drift_and_regen(self):
        self.assertTrue(ev.drift_only(["scripts/f11-accept.test.ts"]))
        self.assertFalse(ev.drift_only(["scripts/f11-accept.test.ts", "modules/x/tests/a.test.ts"]))
        facts = ev.job_facts([{"name": "contracts", "conclusion": "failure"}, {"name": "fast-1", "conclusion": "failure"}])
        ctx = {"state": ev.CiState(), "facts": facts, "run_url": "U", "owns_ok": True, "foreign": [], "changed": ["a"], "manifest_diff": "+  status: 'live',\n", "drift_tolerated": True}
        self.assertIn("one-line flip", ev.auto_evidence({"kind": "proof", "text": "Flip status stub to live in the manifest of tasks"}, ctx))
        self.assertIn("contracts job success", ev.auto_evidence({"kind": "setup", "text": "Read docs; run `npm run gen -- --check` and confirm"}, ctx))
        ctx.update(drift_tolerated=None, regen=(True, "abcdef123456"))
        self.assertIn("regen-checks success on abcdef12", ev.auto_evidence({"kind": "test", "text": "Run scripts/lanes-check.ts, boundaries"}, ctx))

    def test_screens(self):
        files = ["index.md"] + [f"P-L9b_01-home/{k}-{z}-side-by-side.png" for k in ("paper", "graphite") for z in ("desktop", "phone")]
        ok, msg, tg = ev.screens_report(files, "P-L9b_01")
        self.assertTrue(ok, msg); self.assertEqual(tg, ["P-L9b_01-home"])
        self.assertFalse(ev.screens_report(files[:-1], "P-L9b_01")[0])
        self.assertFalse(ev.screens_report(files, "P-L9c_01")[0])
        self.assertFalse(ev.screens_report([f for f in files if f != "index.md"], "P-L9b_01")[0])
        self.assertTrue(ev.is_ui_packet(["apps/app/src/**"], []) and not ev.is_ui_packet(["modules/x/**"], [{"text": "build"}]))
        it = {"kind": "proof", "proof_kind": "screenshot", "text": "Screenshot of Home in both skins"}
        ctx = {"state": ev.CiState(), "facts": ev.job_facts([]), "run_url": "U", "screens": (True, "ok", ["t"])}
        self.assertIn("shots workflow", ev.auto_evidence(it, ctx))
        ctx["screens"] = (False, "none", []); self.assertIsNone(ev.auto_evidence(it, ctx))

    def test_foreign_imports(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(d + "/modules/tasks/src")
            open(d + "/modules/tasks/src/a.ts", "w").write('import x from "../../logs/src/y.ts";\nimport z from "./b.ts";\n')
            self.assertEqual(len(ev.foreign_imports(d, ["modules/tasks/src/a.ts"])), 1)


if __name__ == "__main__": unittest.main()
