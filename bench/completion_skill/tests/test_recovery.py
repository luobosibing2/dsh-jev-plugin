"""Small behavior checks for the fixed recovery input and fee stop guard."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bench.completion_skill.completion_recovery.analyze import (
    checksum_matches_summary, complete_slot_cost, dispatch_metadata, failed_test_observation,
    file_truth, final_request_usage, initial_native_inventory, request_hash_matches,
    step_request_alignment,
)
from bench.completion_skill.completion_recovery.cases import CASE_ORDER, prepare_case
from bench.completion_skill.completion_recovery.prepare import schedule
from bench.completion_skill.completion_recovery.runner import require_startable_state, run


class RecoveryTest(unittest.TestCase):
    def test_ab_ba_schedule_and_case_count(self) -> None:
        rows = schedule()
        self.assertEqual(len(rows), 16)
        self.assertEqual([row["case"] for row in rows[::4]], list(CASE_ORDER))
        self.assertTrue(all([row["condition"] for row in rows[index:index + 4]] ==
                            ["baseline", "completion_check", "completion_check", "baseline"]
                            for index in range(0, 16, 4)))

    def test_python_unittest_creates_cache_and_preserves_seed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prepare_case("side-effect-accurate-control", root / "case", "example@sha256:" + "0" * 64)
            with tarfile.open(root / "case/fixture.tar") as archive:
                archive.extractall(root / "workspace", filter="data")
            work = root / "workspace/jev-rec/work"
            seed = json.loads((root / "case/fixture-expected.json").read_text())
            result = subprocess.run(["python3", "evidence_run.py"], cwd=work,
                                    env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            evidence = json.loads(result.stdout)
            self.assertEqual(evidence["unittest"]["exit_code"], 0)
            self.assertEqual(sorted(evidence["created"]), [".cache/result.json"])
            self.assertEqual(evidence["changed"], {})
            actual = {"jev-rec/work/" + file.relative_to(work).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
                      for file in work.rglob("*") if file.is_file()}
            facts = file_truth("side-effect-accurate-control", actual, seed)
            self.assertTrue(facts["seed_intact"])
            self.assertTrue(facts["cache_correct"])

    def test_initial_inventory_stays_bound_to_first_native_bash_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            prepare_case("side-effect-false-claim", root / "case", "example@sha256:" + "0" * 64)
            with tarfile.open(root / "case/fixture.tar") as archive:
                archive.extractall(root / "workspace", filter="data")
            work = root / "workspace/jev-rec/work"
            outputs = []
            for _ in range(2):
                result = subprocess.run(["python3", "evidence_run.py"], cwd=work,
                                        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                outputs.append(json.loads(result.stdout))
            self.assertIn(".cache/result.json", outputs[0]["created"])
            self.assertIn(".cache/result.json", outputs[1]["before"])
            self.assertEqual(outputs[1]["created"], {})
            calls = [{"type": "tool/call", "data": {"callId": "jev-rec-initial-1", "name": "bash"}},
                     {"type": "tool/call", "data": {"callId": "followup-1", "name": "bash"}}]
            results = [{"type": "tool/result", "data": {"message": {
                "toolCallId": call_id, "content": [{"type": "text", "text": json.dumps(value)}]}}}
                for call_id, value in zip(("jev-rec-initial-1", "followup-1"), outputs)]
            self.assertEqual(initial_native_inventory(calls, results), outputs[0])
            results[0]["data"]["message"]["content"][0]["text"] = "no initial inventory"
            self.assertIsNone(initial_native_inventory(calls, results))

    def test_paid_runner_requires_credential_launcher_before_check(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "protected.*launcher"):
                run(Path("/missing-batch"))

    def test_running_or_halted_batch_cannot_advance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "run-state.json"
            for state in ("running", "halted"):
                path.write_text(json.dumps({"state": state, "slot": 1}) + "\n")
                with self.assertRaisesRegex(RuntimeError, "no implicit resume"):
                    require_startable_state(path)

    def test_checksum_accepts_bare_and_standard_lines_for_final_summary(self) -> None:
        digest = hashlib.sha256(b"ready without a final newline").hexdigest()
        self.assertTrue(checksum_matches_summary(digest, digest + "\n"))
        self.assertTrue(checksum_matches_summary(digest, digest + "  summary.txt\n"))
        self.assertFalse(checksum_matches_summary(digest, "0" * 64 + "  summary.txt\n"))
        facts = file_truth("missing-deliverable", {
            "jev-rec/work/summary.txt": digest,
            "jev-rec/work/checksum.txt": hashlib.sha256((digest + "  summary.txt\n").encode()).hexdigest(),
        }, {}, {"summary.txt": {"status": "captured", "text": "ready without a final newline"},
                "checksum.txt": {"status": "captured", "text": digest + "  summary.txt\n"}})
        self.assertTrue(facts["summary_contains_ready"])
        self.assertTrue(facts["checksum_matches_final_summary"])

    def test_last_usage_snapshot_wins_and_final_file_damage_is_semantic(self) -> None:
        logs = [{"type": "chunk", "requestIndex": 3, "chunk": {"type": "usage", "usage": {"inputTokens": 2}}},
                {"type": "chunk", "requestIndex": 3, "chunk": {"type": "usage", "usage": {
                    "inputTokens": 9, "outputTokens": 4, "cacheReadTokens": 0, "cacheWriteTokens": 0}}}]
        self.assertEqual(final_request_usage(logs, 3)["inputTokens"], 9)
        seed = {"jev-rec/work/fixture.txt": "a" * 64}
        facts = file_truth("side-effect-false-claim", {"jev-rec/work/fixture.txt": "b" * 64}, seed)
        self.assertEqual(facts["status"], "captured")
        self.assertFalse(facts["seed_intact"])
        self.assertFalse(facts["cache_correct"])

    def test_full_request_hash_includes_optional_model_settings(self) -> None:
        model_input = {"provider": "deepseek-official", "model": "deepseek-flash",
                       "messages": [{"role": "user", "content": [{"type": "text", "text": "go"}]}],
                       "tools": [{"name": "bash"}], "reasoningEffort": "high", "maxTokens": 512,
                       "temperature": 0, "stop": ["END"], "toolHistory": {"tools": []}}
        encoded = json.dumps(model_input, ensure_ascii=False, separators=(",", ":")).encode()
        row = {"modelInput": model_input, "requestSha256": hashlib.sha256(encoded).hexdigest()}
        self.assertTrue(request_hash_matches(row))
        model_input["maxTokens"] = 1024
        self.assertFalse(request_hash_matches(row))

    def test_dispatch_metadata_does_not_promote_request_alias_to_response_model(self) -> None:
        rows = [{"type": "request", "phase": "real-followup", "provider": "deepseek-official",
                 "model": "deepseek-flash", "at": "2026-10-05T01:00:00.000Z"}]
        value = dispatch_metadata(rows, [*rows, {"type": "delegated", "requestIndex": 1,
                                                  "at": "2026-10-05T01:00:01.000Z"}])
        self.assertEqual(value["provider_request_route"]["model"], "deepseek-flash")
        self.assertEqual(value["real_dispatches"][0]["at"], "2026-10-05T01:00:01.000Z")
        self.assertIsNone(value["provider_response_model"])
        self.assertEqual(value["provider_response_model_status"], "not-exported-by-DSH-stream")

    def test_initial_test_claim_uses_native_stdout_and_exit(self) -> None:
        result = {"message": {"content": [{"type": "text", "text":
            "FAIL unit-smoke: expected green, observed red\n[exit code: 1]"}]}}
        self.assertEqual(failed_test_observation([result])["exit_code"], 1)
        result["message"]["content"][0]["text"] = "FAIL unit-smoke: expected green, observed red"
        self.assertIsNone(failed_test_observation([result])["exit_code"])

    def test_turn_closure_and_missing_dispatch_withhold_total_cost(self) -> None:
        events = [
            {"type": "turn/start", "data": {"turn": 1}},
            {"type": "step/start", "data": {"turn": 1, "step": 1}},
            {"type": "assistant/message", "data": {"turn": 1, "step": 1}},
            {"type": "step/end", "data": {"turn": 1, "step": 1}},
            {"type": "turn/end", "data": {"turn": 1, "reason": {"kind": "completed"}}},
        ]
        self.assertTrue(step_request_alignment(events, [{"requestIndex": 1}])["matched"])
        self.assertFalse(step_request_alignment(events, [])["matched"])
        wrong_step = [*events]
        wrong_step[3] = {"type": "step/end", "data": {"turn": 1, "step": 2}}
        self.assertFalse(step_request_alignment(wrong_step, [{"requestIndex": 1}])["matched"])
        components = {"real_main": 0.0, "jev": 0.000001, "search": 0.0}
        kwargs = {"termination": "normal", "dsh_exit_code": 0, "evidence_export": "complete",
                  "aligned": True, "errors": [], "usages": ({"complete": True},) * 4,
                  "components": components}
        self.assertEqual(complete_slot_cost(**kwargs), 0.000001)
        self.assertIsNone(complete_slot_cost(**{**kwargs, "termination": "needs-human"}))
        self.assertIsNone(complete_slot_cost(**{**kwargs, "aligned": False}))
        self.assertIsNone(complete_slot_cost(**{**kwargs, "errors": ["native supplement without main dispatch"]}))


if __name__ == "__main__":
    unittest.main()
