"""Keyless published-DSH/Pier probe of native skill discovery and loading."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path

from bench.deepswe.config import digest
from bench.completion_skill.cs_suite.profile import profile_rows
from bench.completion_skill.resources import REPO_ROOT, PACKAGE

from .analyze import _catalogs, _events, _operation, _selected_names, _selection_parameters, _tool_history
from .cases import CASES


PROBE_CASES = ("empty-directory", "all-irrelevant", "catalog-recovery")
CONDITIONS = ("baseline", "skill_selection")


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _slot_result(probe_dir: Path, batch: Path, case_id: str, condition: str) -> dict:
    jobs = probe_dir / "jobs" / case_id / condition
    trials = list(jobs.glob("*/task__*/result.json"))
    result = {"case": case_id, "condition": condition, "structural_ok": False, "errors": []}
    if len(trials) != 1:
        result["errors"].append("expected one Pier trial result")
        return result
    trial = trials[0].parent
    agent = trial / "agent"
    pier = json.loads(trials[0].read_text(encoding="utf-8"))
    meta = ((pier.get("agent_result") or {}).get("metadata") or {})
    result["termination"] = meta.get("termination")
    result["dsh_exit_code"] = meta.get("dsh_exit_code")
    result["evidence_export"] = meta.get("evidence_export")
    result["fixture_integrity"] = json.loads((agent / "fixture-integrity.json").read_text())["status"] \
        if (agent / "fixture-integrity.json").is_file() else None
    ready = json.loads((agent / "jev-service-ready.json").read_text()) \
        if (agent / "jev-service-ready.json").is_file() else {}
    profile = json.loads((probe_dir / "profiles" / case_id / f"{condition}.patch.json").read_text())
    jev_rows = [row for row in profile if row.get("id") == "jev"]
    expected_features = jev_rows[0]["config"]["features"] if len(jev_rows) == 1 else None
    result["features_match"] = ready.get("features") == expected_features
    if not result["features_match"]:
        result["errors"].append("native feature flags differ from the local probe profile")
    for key, expected in (("termination", "normal"), ("dsh_exit_code", 0),
                          ("evidence_export", "complete"), ("fixture_integrity", "unchanged")):
        if result[key] != expected:
            result["errors"].append(f"{key} differs from {expected!r}")
    session_id, events, error = _events(agent)
    if error:
        result["errors"].append(error)
        return result
    calls, tool_results, final_text = _tool_history(events)
    model_sources = [((event.get("data") or {}).get("message") or {}).get("source") or {}
                     for event in events if event.get("type") == "assistant/message"]
    result["main_model_sources"] = model_sources
    if not model_sources or any(source.get("provider") != "eval-local" or source.get("model") != "fixed-script"
                                for source in model_sources):
        result["errors"].append("native probe did not use only the scripted local main adapter")
    if any(not item["call_linked"] or not item["call_ids_agree"] for item in tool_results):
        result["errors"].append("native tool result did not link to its call")
    catalogs = _catalogs(events)
    try:
        selection = _selection_parameters(catalogs)
    except ValueError as exc:
        result["errors"].append(str(exc))
        selection = None
    result["selection_parameters"] = selection
    truth = json.loads((batch / "skills" / "cases" / case_id / "truth.json").read_text())
    published = [entry["name"] for catalog in catalogs for entry in (catalog["entries"] or [])]
    result["published_names"] = published
    result["final_answer"] = final_text
    result["tool_calls"] = [call["name"] for call in calls]
    tool_schema = agent / "mock-model-tools.json"
    result["tool_schema"] = json.loads(tool_schema.read_text()) if tool_schema.is_file() else None
    if result["tool_schema"] is None or not {"skill", "skill_catalog"} <= set(result["tool_schema"]["names"]):
        result["errors"].append("native skill and catalog tools not jointly visible")
    expected_calls = (1 if case_id in ("empty-directory", "all-irrelevant") else 2)
    if case_id == "catalog-recovery":
        if result["tool_calls"].count("skill_catalog") != 1 or result["tool_calls"].count("skill") != 1:
            result["errors"].append("catalog recovery and named load did not both execute")
        catalog_texts = [item["text"] for item in tool_results if item.get("name") == "skill_catalog" and not item["is_error"]]
        if not catalog_texts or not all(any(f"- {name}: " in text for text in catalog_texts)
                                        for name in truth["candidate_names"]):
            result["errors"].append("native full catalog recovery omitted candidates")
        loaded = [item for item in tool_results if item.get("name") == "skill" and not item["is_error"]]
        body_hash = None
        if len(loaded) == 1:
            match = re.search(r"<skill_instructions>\n(.*?)\n</skill_instructions>", loaded[0]["text"], re.S)
            if match:
                body_hash = hashlib.sha256(match[1].encode("utf-8")).hexdigest()
        result["loaded_body_sha256"] = body_hash
        if len(loaded) != 1 or loaded[0].get("arguments", {}).get("name") != "zenith-codebook" \
                or body_hash != truth["body_hashes"]["zenith-codebook"]["body_sha256"]:
            result["errors"].append("native named skill body was not loaded")
        if "ZENITH-419" not in final_text:
            result["errors"].append("scripted main did not include the loaded dispatch code")
    elif case_id in ("empty-directory", "all-irrelevant"):
        if result["tool_calls"].count("skill_catalog") != expected_calls or "skill" in result["tool_calls"]:
            result["errors"].append("empty or irrelevant case did not inspect catalog as scripted")
        if "42" not in final_text:
            result["errors"].append("scripted main did not finish from catalog evidence")
    if case_id == "empty-directory" and published:
        result["errors"].append("empty snapshot published a skill")
    if case_id != "empty-directory" and not published and selection is None:
        result["errors"].append("nonempty snapshot published no skill summaries")
    if any(item["is_error"] for item in tool_results):
        result["errors"].append("native tool error")
    records, invalid = _operation(agent, session_id)
    result["jev_operations"] = len(records)
    wanted = 1 if condition == "skill_selection" and case_id != "empty-directory" else 0
    if invalid or len(records) != wanted:
        result["errors"].append("mock Jev operation count differs from eligible catalog")
    if records:
        record = records[0]
        attempts = record.get("attemptRecords") or []
        attempt = attempts[0] if attempts else {}
        if record.get("featureId") != "skill-selection" or record.get("status") != "succeeded" \
                or len(attempts) != 1 or attempt.get("status") != "succeeded":
            result["errors"].append("mock Jev skill judgment did not succeed once")
        request = attempt.get("request") or {}
        result["jev_question_count"] = len(request.get("questions") or [])
        if result["jev_question_count"] != len(CASES[case_id].skills):
            result["errors"].append("mock Jev did not see full candidate directory")
        if "ZENITH-419" in json.dumps(request):
            result["errors"].append("Jev ranking input included loaded skill body")
        result["mock_jev_response_model"] = (attempt.get("rawResponse") or {}).get("model")
        if result["mock_jev_response_model"] != "jev-1.13.0-local-fixture":
            result["errors"].append("native probe Jev response was not the local fixture")
        if selection is not None:
            answers = (attempt.get("response") or {}).get("answers") or []
            questions = request.get("questions") or []
            scores = []
            for index, (question, answer) in enumerate(zip(questions, answers)):
                probability = answer.get("probability")
                if question.get("id") != f"candidate-{index}" or answer.get("id") != question.get("id") \
                        or answer.get("kind") != "noul" or type(probability) not in (int, float) \
                        or not math.isfinite(probability) or not 0 <= probability <= 1:
                    result["errors"].append("mock Jev answer identity or probability invalid")
                    break
                scores.append({"name": question.get("prompt", "").split("Skill: ", 1)[-1].split(". Description: ", 1)[0],
                               "probability": probability, "original_index": index})
            expected = _selected_names(scores, selection)
            if len(answers) != len(questions) or len(scores) != result["jev_question_count"] or published != expected:
                result["errors"].append("catalog publication differs from recorded selection parameters")
            receipt_id = "skill-catalog-published" if expected else "skill-catalog-no-relevant"
            if not any(receipt.get("id") == receipt_id and receipt.get("status") == "observed"
                       for receipt in records[0].get("receipts") or []):
                result["errors"].append("catalog outcome receipt differs from recorded selection")
    if condition == "skill_selection" and case_id == "all-irrelevant" and selection is None and len(published) != 5:
        result["errors"].append("all-irrelevant case did not retain default top five")
    if len([event for event in events if event.get("type") == "turn/end"
            and ((event.get("data") or {}).get("reason") or {}).get("kind") == "completed"]) != 1:
        result["errors"].append("one completed native turn not recorded")
    result["structural_ok"] = not result["errors"]
    result["actual_provider_calls"] = {"deepseek": 0, "jev": 0}
    return result


def probe(batch: Path, *, cases: tuple[str, ...] = PROBE_CASES,
          output_name: str | None = None) -> dict:
    """Run one-shot local-mock trials; allow a fresh output for a targeted repair."""
    batch = Path(batch).resolve()
    real_manifest = batch / "skills" / "manifest.json"
    if not real_manifest.is_file():
        raise FileNotFoundError("prepare the skill batch before its native probe")
    if not cases or any(case not in PROBE_CASES for case in cases):
        raise ValueError("unknown or empty native probe case selection")
    if output_name is not None and (not output_name.isidentifier() or output_name.startswith("_")):
        raise ValueError("probe repair output needs a simple name")
    probe_dir = batch / "preflight" / "skills"
    if output_name is not None:
        probe_dir /= output_name
    if probe_dir.exists():
        raise FileExistsError("the one-shot native skill probe already has output")
    from bench.completion_skill.cs_suite.probe_support import make_probe_plan
    model_module = PACKAGE / "skills" / "mock_provider.mjs"
    manifest = make_probe_plan(real_manifest, probe_dir, model_module)
    plan = json.loads(manifest.read_text(encoding="utf-8"))
    if plan["model"]["provider"] != "eval-local" or not plan["jev"]["endpoint"].startswith("http://127.0.0.1:0/"):
        raise RuntimeError("probe plan could reach an external model service")
    results = []
    for case_id in cases:
        case_root = batch / "skills" / "cases" / case_id
        if not (case_root / "truth.json").is_file():
            raise FileNotFoundError(f"skill case not prepared: {case_id}")
        for condition in CONDITIONS:
            internal = "baseline" if condition == "baseline" else "completion_check"
            rows = profile_rows(plan, "skills", condition, case_id)
            patch = probe_dir / "profiles" / case_id / f"{condition}.patch.json"
            _write_json(patch, rows)
            job = probe_dir / "slots" / case_id / condition / "job.json"
            _write_json(job, {
                "job_name": f"jev-skill-probe-{case_id}-{condition}",
                "jobs_dir": str((probe_dir / "jobs" / case_id / condition).resolve()),
                "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
                "agents": [{"import_path": "bench.completion_skill.skills.agent:SkillCaseAgent",
                            "model_name": plan["model"]["route"],
                            "override_timeout_sec": 300,
                            "override_setup_timeout_sec": 1200,
                            "kwargs": {
                                "manifest_path": str(manifest), "arm": internal,
                                "task_id": "vitest-duration-sharding",
                                "family": "skills", "condition": condition, "case_id": case_id,
                                "case_root": str(case_root), "profile_patch_path": str(patch),
                                "fixture_tar_sha256": digest(case_root / "fixture.tar"),
                                "mock_jev_spec": str(case_root / "mock-jev-spec.json"),
                            }, "env": {"JEV_API_KEY": "local-probe-only"}}],
                "tasks": [{"path": str((case_root / "task").resolve())}],
                "environment": {"type": "docker", "delete": True, "force_build": False},
                "verifier": {"disable": True},
            })
            env = dict(os.environ)
            for name in ("DEEPSEEK_API_KEY", "JEV_API_KEY", "DSH_EVAL_DEEPSEEK_KEY"):
                env.pop(name, None)
            env["PYTHONPATH"] = os.pathsep.join((str(REPO_ROOT), env.get("PYTHONPATH", "")))
            command = ["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                       "--config", str(job), "--yes"]
            completed = subprocess.run(command, env=env, cwd=REPO_ROOT, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            (job.parent / "pier.stdout.txt").write_text(completed.stdout, encoding="utf-8")
            (job.parent / "pier.stderr.txt").write_text(completed.stderr, encoding="utf-8")
            slot = _slot_result(probe_dir, batch, case_id, condition)
            slot["pier_exit_code"] = completed.returncode
            _write_json(probe_dir / "results" / case_id / f"{condition}.json", slot)
            results.append(slot)
            if completed.returncode != 0 or not slot["structural_ok"]:
                _write_json(probe_dir / "report.json", {"status": "failed", "slots": results,
                                                          "provider_calls": {"deepseek": 0, "jev": 0}})
                return {"status": "failed", "slots": results, "provider_calls": {"deepseek": 0, "jev": 0}}
        left, right = results[-2:]
        if left["tool_schema"] != right["tool_schema"]:
            left["errors"].append("paired model-visible tool schema differs")
            _write_json(probe_dir / "report.json", {"status": "failed", "slots": results,
                                                      "provider_calls": {"deepseek": 0, "jev": 0}})
            return {"status": "failed", "slots": results, "provider_calls": {"deepseek": 0, "jev": 0}}
    report = {"status": "passed", "slots": results, "provider_calls": {"deepseek": 0, "jev": 0},
              "scope": "native transport and loading with scripted main and local mock Jev; no semantic accuracy"}
    _write_json(probe_dir / "report.json", report)
    return report
