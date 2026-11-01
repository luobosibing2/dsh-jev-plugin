"""Recorded selection parameters distinguish filtered publication from historical top five."""

from __future__ import annotations

import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bench.completion_skill.skills import analyze, native_probe
from bench.completion_skill.skills.cases import CASES
from bench.completion_skill.skill_followup import analyze as followup
from bench.completion_skill.skill_followup import probe as followup_probe


class RecordedSelectionTest(unittest.TestCase):
    def _fixture(self, root: Path, names: list[str], probabilities: list[float], selection: dict | None):
        scores = [{"name": name, "probability": probability, "original_index": index}
                  for index, (name, probability) in enumerate(zip(names, probabilities))]
        selected = analyze._selected_names(scores, selection)
        source = {"kind": "jev-skill-catalog", "entries": [{"name": name, "description": name} for name in selected]}
        if selection is not None:
            source["selection"] = selection
        events = [{"type": "user/message", "data": {"source": source, "content": []}},
                  {"type": "step/start", "data": {"turn": 1, "step": 1}},
                  {"type": "assistant/message", "data": {"turn": 1, "step": 1,
                   "message": {"source": {"provider": "eval-local", "model": "fixed-script"},
                               "content": [{"type": "text", "text": "42"}]},
                   "usage": {"inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0}}},
                  {"type": "step/end", "data": {"turn": 1, "step": 1}},
                  {"type": "turn/end", "data": {"reason": {"kind": "completed"}}}]
        attempt = {"status": "succeeded", "rawResponse": {"model": "jev-1.13.0-local-fixture"},
                   "request": {"questions": [{"id": f"candidate-{index}", "kind": "noul",
                    "prompt": f"Would this skill help the task? Skill: {name}. Description: {name}"}
                    for index, name in enumerate(names)]},
                   "response": {"answers": [{"id": f"candidate-{index}", "kind": "noul", "probability": chance}
                                            for index, chance in enumerate(probabilities)]}}
        record = {"featureId": "skill-selection", "status": "succeeded", "attemptRecords": [attempt],
                  "receipts": [{"id": "skill-catalog-published" if selected else "skill-catalog-no-relevant",
                                "status": "observed"}]}
        agent = root / "agent"
        agent.mkdir()
        truth = {"candidate_names": names, "candidate_descriptions": {name: name for name in names},
                 "required_names": [names[0]], "relevant_names": [names[0]], "answer_tokens": [],
                 "body_hashes": {name: {"body_sha256": "unused"} for name in names},
                 "body_sha256": {}, "source_files": {}, "oracle": {},
                 "require_catalog": False, "forbid_irrelevant_load": False}
        basic = {"status": "completed", "blocking_errors": [], "agent_dir": str(agent),
                 "usage_complete": True, "known_estimated_usd": 0}
        return truth, basic, events, record

    def _invalidate(self, record: dict, events: list[dict], failure: str | None):
        if failure in ("failed", "cancelled"):
            record["status"] = failure
        elif failure == "incomplete":
            record["attemptRecords"][0]["response"]["answers"].pop()
        elif failure == "invalid-probability":
            record["attemptRecords"][0]["response"]["answers"][0]["probability"] = float("nan")
        elif failure == "invalid-selection":
            events[0]["data"]["source"]["selection"]["skillLimit"] = 0
        elif failure == "not-adopted":
            record["receipts"][0]["status"] = "not-adopted"
        elif failure == "wrong-outcome":
            record["receipts"][0]["id"] = "skill-catalog-no-new"

    def test_metadata_and_legacy_selection_are_distinct(self):
        catalogs = analyze._catalogs([{"type": "user/message", "data": {"source": {
            "kind": "jev-skill-catalog", "entries": [], "selection": {"skillMinProbability": 0.5, "skillLimit": 2}},
            "content": []}}])
        selection = analyze._selection_parameters(catalogs)
        scores = [{"name": name, "probability": probability, "original_index": index}
                  for index, (name, probability) in enumerate(zip("abcde", [0.49, 0.5, 0.9, 0.5, 0]))]
        self.assertEqual(analyze._selected_names(scores, selection), ["c", "b"])
        self.assertEqual(analyze._selected_names(scores, None), ["c", "b", "d", "a", "e"])
        self.assertIsNone(analyze._selection_parameters([{"kind": "jev-skill-catalog", "entries": []}]))

    def test_invalid_recorded_parameters_fail_instead_of_defaulting(self):
        for selection in ({"skillMinProbability": float("nan"), "skillLimit": 5},
                          {"skillMinProbability": 1.1, "skillLimit": 5},
                          {"skillMinProbability": 0.5, "skillLimit": 0},
                          {"skillLimit": 5}):
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                analyze._selection_parameters([{"kind": "jev-skill-catalog", "selection": selection}])

    def test_initial_analyzer_keeps_raw_rank_and_reports_actual_missing_requirement(self):
        scenarios = [(None, None)] + [({"skillMinProbability": 0.5, "skillLimit": 5}, failure)
                                     for failure in (None, "failed", "cancelled", "incomplete", "invalid-probability",
                                                     "invalid-selection", "not-adopted", "wrong-outcome")]
        for selection, failure in scenarios:
            with self.subTest(selection=selection, failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                names = [f"skill-{index}" for index in range(8)]
                truth, basic, events, record = self._fixture(root, names, [0.4] + [0.01] * 7, selection)
                self._invalidate(record, events, failure)
                case = root / "skills/cases/catalog-recovery"
                case.mkdir(parents=True)
                (case / "truth.json").write_text(json.dumps(truth))
                (root / "skills/manifest.json").write_text("{}")
                (root / "agent/fixture-integrity.json").write_text('{"status":"unchanged"}')
                with patch("bench.completion_skill.cs_suite.collector.inspect_basic", return_value=(basic, events, [record])), \
                        patch.object(analyze, "_fixture_bodies", return_value={name: "unseen body" for name in names}):
                    result = analyze.inspect_skill_slot(root, "catalog-recovery", "skill_selection")
                if failure:
                    self.assertFalse(result["structural_ok"])
                    self.assertIsNone(result["selected_names"])
                    self.assertIsNone(result["required_missing_selected"])
                    self.assertFalse(result["publication_matches_expected"])
                    continue
                self.assertTrue(result["structural_ok"], result["blocking_errors"])
                self.assertTrue(result["publication_matches_expected"])
                self.assertEqual(result["recall_at_5"], 1)
                self.assertEqual(result["required_missing_selected"], [] if selection is None else [names[0]])

    def test_followup_analyzer_uses_recorded_threshold_and_preserves_old_top_five(self):
        scenarios = [(None, None)] + [({"skillMinProbability": 0.5, "skillLimit": 5}, failure)
                                     for failure in (None, "failed", "cancelled", "incomplete", "invalid-probability",
                                                     "invalid-selection", "not-adopted", "wrong-outcome")]
        for selection, failure in scenarios:
            with self.subTest(selection=selection, failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                names = [f"skill-{index:02}" for index in range(24)]
                truth, basic, events, record = self._fixture(root, names, [0.4] + [0.01] * 23, selection)
                self._invalidate(record, events, failure)
                case = root / "cases/research-one"
                case.mkdir(parents=True)
                (case / "truth.json").write_text(json.dumps(truth))
                with tarfile.open(case / "skill-fixture.tar", "w"):
                    pass
                (root / "agent/fixture-integrity.json").write_text(
                    '{"repo":{"status":"unchanged"},"skills":{"status":"unchanged"}}')
                with patch.object(followup, "inspect_basic", return_value=(basic, events, [record])), \
                        patch.object(followup, "_mechanical_hints", return_value={}):
                    result = followup.inspect_slot(root, {"slot": 1, "repeat": 1, "pair_order": "AB",
                                                         "case": "research-one", "condition": "skill_selection"})
                if failure:
                    self.assertFalse(result["structural_ok"])
                    self.assertIsNone(result["selected_names"])
                    self.assertIsNone(result["required_missing_selected"])
                    self.assertFalse(result["publication_matches_scores"])
                    continue
                self.assertTrue(result["structural_ok"], result["blocking_errors"])
                self.assertTrue(result["publication_matches_scores"])
                self.assertEqual(result["recall_at_5"], 1)
                self.assertEqual(result["required_missing_selected"], [] if selection is None else [names[0]])

    def test_native_probe_accepts_recorded_empty_success_and_legacy_five(self):
        scenarios = [(None, None)] + [({"skillMinProbability": 0.5, "skillLimit": 5}, failure)
                                     for failure in (None, "failed", "cancelled", "incomplete", "invalid-probability",
                                                     "invalid-selection", "not-adopted", "wrong-outcome")]
        for selection, failure in scenarios:
            with self.subTest(selection=selection, failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                batch, probe = root / "batch", root / "probe"
                case = batch / "skills/cases/all-irrelevant"
                names = sorted(skill.name for skill in CASES["all-irrelevant"].skills)
                truth, _, events, record = self._fixture(root, names, [0.01] * 8, selection)
                self._invalidate(record, events, failure)
                case.mkdir(parents=True)
                (case / "truth.json").write_text(json.dumps(truth))
                events.extend([{"type": "tool/call", "data": {"callId": "catalog", "name": "skill_catalog", "arguments": "{}"}},
                               {"type": "tool/result", "data": {"message": {
                                "source": {"callId": "catalog"}, "isError": False, "content": []}}}])
                trial = probe / "jobs/all-irrelevant/skill_selection/job/task__trial"
                agent = trial / "agent"
                agent.mkdir(parents=True)
                (trial / "result.json").write_text(json.dumps({"agent_result": {"metadata": {
                    "termination": "normal", "dsh_exit_code": 0, "evidence_export": "complete"}}}))
                (agent / "fixture-integrity.json").write_text('{"status":"unchanged"}')
                (agent / "jev-service-ready.json").write_text('{"features":{"skill-selection":true}}')
                (agent / "mock-model-tools.json").write_text('{"names":["skill","skill_catalog"]}')
                profile = probe / "profiles/all-irrelevant/skill_selection.patch.json"
                profile.parent.mkdir(parents=True)
                profile.write_text('[{"id":"jev","config":{"features":{"skill-selection":true}}}]')
                with patch.object(native_probe, "_events", return_value=("session", events, None)), \
                        patch.object(native_probe, "_operation", return_value=([record], 0)):
                    result = native_probe._slot_result(probe, batch, "all-irrelevant", "skill_selection")
                if failure:
                    self.assertFalse(result["structural_ok"])
                    continue
                self.assertTrue(result["structural_ok"], result["errors"])
                self.assertEqual(len(result["published_names"]), 5 if selection is None else 0)

    def test_followup_probe_matches_recorded_selection_and_keeps_raw_top_five(self):
        for selection in (None, {"skillMinProbability": 0.5, "skillLimit": 5},
                          {"skillMinProbability": 0.5, "skillLimit": 2}):
            with self.subTest(selection=selection), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                batch, probe = root / "batch", root / "probe"
                names = [f"skill-{index:02}" for index in range(24)]
                probabilities = [0.4] + [0.01] * 23 if selection is None or selection["skillLimit"] == 5 \
                    else [0.49, 0.5, 0.9, 0.5] + [0.01] * 20
                truth, _, events, record = self._fixture(root, names, probabilities, selection)
                truth["required_names"] = []
                case = batch / "cases/research-one"
                case.mkdir(parents=True)
                (case / "truth.json").write_text(json.dumps(truth))
                for call_id, name, arguments, text in (
                        ("catalog", "skill_catalog", {}, "\n".join(f"- {name}: {name}" for name in names)),
                        ("read", "read", {"file_path": "study/source.ts"}, "sessionSettings")):
                    events.extend([{"type": "tool/call", "data": {
                        "callId": call_id, "name": name, "arguments": json.dumps(arguments)}},
                        {"type": "tool/result", "data": {"message": {
                            "source": {"callId": call_id}, "isError": False,
                            "content": [{"type": "text", "text": text}]}}}])
                trial = probe / "jobs/research-one/skill_selection/job/task__trial"
                agent = trial / "agent"
                operations = agent / "dsh-home/storages/jev_fixture/operations"
                operations.mkdir(parents=True)
                (trial / "result.json").write_text(json.dumps({"agent_result": {"metadata": {
                    "termination": "normal", "dsh_exit_code": 0, "evidence_export": "complete",
                    "fixture_integrity": "unchanged"}}}))
                (agent / "fixture-integrity.json").write_text(
                    '{"repo":{"status":"unchanged"},"skills":{"status":"unchanged"}}')
                (agent / "jev-service-ready.json").write_text(json.dumps(
                    {"features": followup_probe.expected_features("skill_selection")}))
                (agent / "mock-model-tools.json").write_text('{"names":["skill","skill_catalog","read"]}')
                (operations / "operation.json").write_text(json.dumps({"record": record}))
                with patch.object(followup_probe, "_events", return_value=("session", events, None)):
                    result = followup_probe._inspect(probe, batch, "research-one", "skill_selection")
                self.assertTrue(result["structural_ok"], result["errors"])
                self.assertEqual(result["mock_top5"], analyze._selected_names(
                    [{"name": name, "probability": chance, "original_index": index}
                     for index, (name, chance) in enumerate(zip(names, probabilities))], None))
                self.assertEqual(result["mock_selected_names"], result["published_names"])


if __name__ == "__main__":
    unittest.main()
