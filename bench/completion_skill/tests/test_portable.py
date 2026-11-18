"""Focused guards for portable batch identity and conservative evidence accounting."""

from __future__ import annotations

import json
import copy
import os
import select
import tempfile
import unittest
from pathlib import Path
from subprocess import PIPE, Popen, run

from bench.completion_skill import resources
from bench.completion_skill.coding_followup.collect import failed_model_attempt_errors, model_turn_closure
from bench.completion_skill.coding_followup.prepare import EXPECTED_ORDER
from bench.completion_skill.coding_followup.runner import redact_output as redact_coding
from bench.completion_skill.cs_suite.collector import inspect_basic, ledger
from bench.completion_skill.cs_suite.probe_support import ready_poll_script
from bench.completion_skill.cs_suite.prepare import _inputs as initial_inputs
from bench.completion_skill.cs_suite.runner import redact_output as redact_initial
from bench.completion_skill.skill_followup.analyze import _step_usage
from bench.completion_skill.skill_followup.prepare import schedule as skill_schedule
from bench.completion_skill.skill_followup.prepare import inputs as skill_inputs
from bench.completion_skill.skill_followup.runner import redact_output as redact_skill


class PortableSuiteTest(unittest.TestCase):
    def test_scenario_order_and_templates(self) -> None:
        self.assertEqual(resources.SCENARIOS, ("initial-26", "coding-followup-4", "skill-repository-8", "completion-recovery-16"))
        self.assertEqual(EXPECTED_ORDER, ("baseline", "completion_check", "completion_check", "baseline"))
        self.assertEqual([(row["repeat"], row["condition"]) for row in skill_schedule()[:4]],
                         [(1, "baseline"), (1, "skill_selection"), (2, "skill_selection"), (2, "baseline")])
        self.assertEqual(len(skill_schedule()), 8)

    def test_plugin_and_price_revision_does_not_change_scenario(self) -> None:
        plan = copy.deepcopy(resources.template("skill-repository-8.json"))
        plan["versions"]["plugin_commit"] = "a" * 40
        plan["versions"]["plugin_tar_sha256"] = "b" * 64
        plan["prices"]["jev"]["input_per_million"] = 0.05
        self.assertTrue(resources.same_scenario_identity(plan, "skill-repository-8.json"))
        plan["budget"]["agent_timeout_sec"] += 1
        self.assertFalse(resources.same_scenario_identity(plan, "skill-repository-8.json"))

    def test_relative_resources_and_missing_resource(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = json.loads((resources.PACKAGE / "resources.example.json").read_text())
            for name in ("deep_swe", "pier", "node_tarball", "plugin_tarball"):
                target = root / "resources" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch()
                raw["paths"][name] = "./resources/" + name
            raw["paths"].pop("dsh_install")
            config = root / "resources.json"
            config.write_text(json.dumps(raw) + "\n")
            loaded = resources.load_resources(config)
            self.assertEqual(loaded["resolved_paths"]["deep_swe"], (root / "resources/deep_swe").resolve())
            (root / "resources/pier").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "Resource pier is missing"):
                resources.load_resources(config)

    def test_initial_frozen_inputs_exclude_runtime_logs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            batch = Path(temporary)
            (batch / "completion").mkdir()
            (batch / "completion/manifest.json").write_text("{}\n")
            before = initial_inputs(batch)
            (batch / "completion/pier.stderr.txt").write_text("runtime failure\n")
            (batch / "run-state.json").write_text("{}\n")
            self.assertEqual(before, initial_inputs(batch))
            (batch / "completion/manifest.json").write_text('{"changed":true}\n')
            self.assertNotEqual(before, initial_inputs(batch))

    def test_skill_followup_input_lock_excludes_slot_logs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            batch = Path(temporary)
            for name in ("manifest.json", "schedule.json", "evaluator-hashes.json"):
                (batch / name).write_text("{}\n")
            job = batch / "slots/01/job.json"
            job.parent.mkdir(parents=True)
            job.write_text('{"job":1}\n')
            before = skill_inputs(batch)
            for name in ("pier.stdout.txt", "pier.stderr.txt"):
                (job.parent / name).write_text("runtime\n")
            self.assertEqual(before, skill_inputs(batch))
            job.write_text('{"job":2}\n')
            self.assertNotEqual(before, skill_inputs(batch))

    def test_launcher_resolves_repository_root(self) -> None:
        launcher = resources.PACKAGE / "credential_launcher.mjs"
        self.assertIn("new URL('../../', import.meta.url)", launcher.read_text())
        checked = run(["node", "--check", str(launcher)], capture_output=True, text=True, check=False)
        self.assertEqual(checked.returncode, 0, checked.stderr)

    def test_mock_readiness_waits_for_pid_creation_and_rejects_dead_pid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ready, pidfile = root / "ready", root / "pid"
            fake_sleep = root / "sleep"
            fake_sleep.write_text("#!/bin/sh\nprintf 'polled\\n'\nIFS= read -r _ack\n")
            fake_sleep.chmod(0o755)
            env = {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"]}
            process = Popen(["sh", "-c", ready_poll_script(str(ready), str(pidfile))],
                            stdin=PIPE, stdout=PIPE, stderr=PIPE, env=env)
            try:
                self.assertTrue(select.select([process.stdout], [], [], 2)[0],
                                "readiness loop never reached its first poll")
                self.assertEqual(process.stdout.readline(), b"polled\n")
                pidfile.write_text(str(os.getpid()) + "\n")
                ready.write_text('{"port":12345}\n')
                output, error = process.communicate(input=b"continue\n", timeout=2)
                self.assertEqual(process.returncode, 0, error.decode())
                self.assertEqual(output, b"")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
            ready.unlink()
            pidfile.write_text("999999999\n")
            dead = run(["sh", "-c", ready_poll_script(str(ready), str(pidfile))],
                       capture_output=True, text=True, timeout=2, check=False)
            self.assertEqual(dead.returncode, 1)

    def test_zero_or_multiple_trial_exports_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            batch = Path(temporary)
            jobs = batch / "jobs"
            row, _, _ = inspect_basic(batch, "coding", "case", "baseline", jobs, batch / "manifest.json")
            self.assertEqual(row["status"], "not-started")
            jobs.mkdir()
            row, _, _ = inspect_basic(batch, "coding", "case", "baseline", jobs, batch / "manifest.json")
            self.assertEqual(row["status"], "started")
            self.assertIn("Pier did not export exactly one trial result", row["blocking_errors"])
            for index in (1, 2):
                result = jobs / str(index) / "task__case" / "result.json"
                result.parent.mkdir(parents=True)
                result.write_text("{}\n")
            row, _, _ = inspect_basic(batch, "coding", "case", "baseline", jobs, batch / "manifest.json")
            self.assertFalse(row["structural_ok"])
            self.assertIsNone(row["known_estimated_usd"])

    def test_open_step_or_failed_attempt_is_not_complete(self) -> None:
        events = [{"type": "turn/start", "data": {"turn": 1}},
                  {"type": "step/start", "data": {"turn": 1, "step": 1}},
                  {"type": "assistant/attempt", "data": {"turn": 1, "step": 1}},
                  {"type": "turn/end", "data": {"turn": 1, "reason": {"kind": "completed"}}}]
        self.assertFalse(model_turn_closure(events)["complete"])
        self.assertTrue(failed_model_attempt_errors(events))
        self.assertFalse(_step_usage(events)["complete"])

    def test_missing_jev_export_keeps_cost_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            agent = Path(temporary)
            plan = resources.template("initial-coding.json")
            usage, operations = ledger(agent, "session-1", plan, "coding", "baseline",
                                       {"termination": "normal", "evidence_export": "complete"})
            self.assertEqual(operations, [])
            self.assertFalse(usage["storage_complete"])
            self.assertIsNone(usage["estimated_usd"])

    def test_keys_are_redacted_in_all_runners(self) -> None:
        raw = "key=A+B/C encoded=A%2BB%2FC"
        for redact in (redact_initial, redact_coding, redact_skill):
            clean = redact(raw, ["A+B/C"])
            self.assertNotIn("A+B/C", clean)
            self.assertNotIn("A%2BB%2FC", clean)
            self.assertEqual(clean.count("[REDACTED_SECRET]"), 2)


if __name__ == "__main__":
    unittest.main()
