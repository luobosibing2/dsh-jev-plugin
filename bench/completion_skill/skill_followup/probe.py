"""One-shot keyless DSH/Pier probe for the new 24-candidate repository cases."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from bench.deepswe.config import digest
from bench.completion_skill.skills.analyze import _catalogs, _events, _selected_names, _selection_parameters, _tool_history

from .analyze import _step_usage
from .cases import CASE_ORDER
from .prepare import REPO_ROOT, SUITE
from .profile import CONDITIONS, expected_features, internal_arm, profile_rows


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _probe_plan(batch: Path, probe_dir: Path) -> Path:
    if probe_dir.exists():
        raise FileExistsError("keyless follow-up probe is one-shot")
    probe_dir.mkdir(parents=True)
    source_install = batch / "dsh-install"
    (probe_dir / "dsh-install").mkdir()
    for name in ("package.json", "package-lock.json", "identity.json"):
        shutil.copyfile(source_install / name, probe_dir / "dsh-install" / name)
    shutil.copyfile(batch / "evaluator-hashes.json", probe_dir / "evaluator-hashes.json")
    plan = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))
    plan["model"] = {"provider": "eval-local", "id": "fixed-script", "route": "eval-local/fixed-script",
                     "reasoning_effort": "high", "endpoint": "http://127.0.0.1:0/v1/local",
                     "floating_alias": False}
    plan["jev"] = {**plan["jev"], "endpoint": "http://127.0.0.1:0/v1/systemone"}
    plan["conditions"]["main_credential_env"] = "EVAL_MAIN_PLACEHOLDER"
    plan["budget"]["agent_timeout_sec"] = 240
    path = probe_dir / "manifest.json"
    _write(path, plan)
    return path


def _probe_job(probe_dir: Path, manifest: Path, batch: Path, case: str, condition: str) -> Path:
    plan = json.loads(manifest.read_text(encoding="utf-8"))
    case_root = batch / "cases" / case
    patch = probe_dir / "profiles" / f"{condition}.patch.json"
    _write(patch, profile_rows(plan, condition))
    job = probe_dir / "slots" / case / condition / "job.json"
    _write(job, {
        "job_name": f"jev-sf-probe-{case}-{condition}",
        "jobs_dir": str((probe_dir / "jobs" / case / condition).resolve()),
        "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
        "agents": [{"import_path": "bench.completion_skill.skill_followup.agent:FollowupSkillAgent",
                    "model_name": plan["model"]["route"],
                    "override_timeout_sec": 420,
                    "override_setup_timeout_sec": 1200,
                    "kwargs": {"manifest_path": str(manifest), "arm": internal_arm(condition),
                               "task_id": plan["tasks"][0]["id"],
                               "case_id": case, "condition": condition,
                               "case_root": str(case_root), "profile_patch_path": str(patch),
                               "fixture_hashes": {
                                   "repo": digest(case_root / "repo-fixture.tar"),
                                   "skills": digest(case_root / "skill-fixture.tar")},
                               "mock_jev_spec": str(case_root / "mock-jev-spec.json")},
                    "env": {"JEV_API_KEY": "local-probe-only"}}],
        "tasks": [{"path": str((case_root / "task").resolve())}],
        "environment": {"type": "docker", "delete": True, "force_build": False},
        "verifier": {"disable": True},
    })
    return job


def _inspect(probe_dir: Path, batch: Path, case: str, condition: str) -> dict:
    output = {"case": case, "condition": condition, "structural_ok": False, "errors": [],
              "real_provider_calls": {"deepseek": 0, "jev": 0}}
    jobs = probe_dir / "jobs" / case / condition
    trials = list(jobs.glob("*/task__*/result.json"))
    if len(trials) != 1:
        output["errors"].append("expected exactly one Pier trial")
        return output
    trial = trials[0].parent
    result = json.loads(trials[0].read_text(encoding="utf-8"))
    metadata = ((result.get("agent_result") or {}).get("metadata") or {})
    agent = trial / "agent"
    for key, value in (("termination", "normal"), ("dsh_exit_code", 0),
                       ("evidence_export", "complete"), ("fixture_integrity", "unchanged")):
        if metadata.get(key) != value:
            output["errors"].append(f"{key} differs from {value!r}")
    integrity = json.loads((agent / "fixture-integrity.json").read_text(encoding="utf-8")) \
        if (agent / "fixture-integrity.json").is_file() else {}
    output["fixture_integrity"] = integrity
    if any((integrity.get(kind) or {}).get("status") != "unchanged" for kind in ("repo", "skills")):
        output["errors"].append("skill or source fixture was changed")
    session_id, events, error = _events(agent)
    if error:
        output["errors"].append(error)
        return output
    calls, results, answer = _tool_history(events)
    steps = _step_usage(events)
    output["step_closure"] = {"started": steps["started"], "closed": steps["closed"],
                              "complete": steps["complete"], "errors": steps["errors"]}
    if not steps["complete"]:
        output["errors"].append("native probe Session step or usage is incomplete")
    if any(not item["call_linked"] or not item["call_ids_agree"] or item["is_error"] for item in results):
        output["errors"].append("native tool call/result is unlinked or failed")
    model_sources = [((event.get("data") or {}).get("message") or {}).get("source") or {}
                     for event in events if event.get("type") == "assistant/message"]
    if not model_sources or any(source.get("provider") != "eval-local" or source.get("model") != "fixed-script"
                                for source in model_sources):
        output["errors"].append("probe did not use only the local scripted main")
    tool_schema = json.loads((agent / "mock-model-tools.json").read_text(encoding="utf-8")) \
        if (agent / "mock-model-tools.json").is_file() else None
    output["tool_schema"] = tool_schema
    if tool_schema is None or not {"skill", "skill_catalog", "read"} <= set(tool_schema["names"]):
        output["errors"].append("native catalog, skill, and repo read tools were not all visible")
    truth = json.loads((batch / "cases" / case / "truth.json").read_text(encoding="utf-8"))
    ready = json.loads((agent / "jev-service-ready.json").read_text(encoding="utf-8")) \
        if (agent / "jev-service-ready.json").is_file() else {}
    output["feature_flags_match"] = ready.get("features") == expected_features(condition)
    if not output["feature_flags_match"]:
        output["errors"].append("native Jev feature state differs from paired profile")
    catalogs = _catalogs(events)
    selection_valid = True
    try:
        selection = _selection_parameters(catalogs)
    except ValueError as exc:
        output["errors"].append(str(exc))
        selection = None
        selection_valid = False
    output["selection_parameters"] = selection
    published = [entry["name"] for catalog in catalogs for entry in (catalog["entries"] or [])]
    output["published_names"] = published
    expected = truth["candidate_names"] if condition == "baseline" else None
    if expected is not None and published != expected:
        output["errors"].append("baseline did not publish all 24 skill summaries")
    catalog_results = [item for item in results if item.get("name") == "skill_catalog" and not item["is_error"]]
    recovered = [name for name in truth["candidate_names"]
                 if any(f"- {name}: {truth['candidate_descriptions'][name]}" in item["text"]
                        for item in catalog_results)]
    output["catalog_recovered_names"] = recovered
    if len(recovered) != 24:
        output["errors"].append("native skill_catalog did not restore all 24 candidates")
    skill_results = [item for item in results if item.get("name") == "skill" and not item["is_error"]]
    loaded = {}
    for item in skill_results:
        match = re.search(r"<skill_instructions>\n(.*?)\n</skill_instructions>", item["text"], re.S)
        name = item.get("arguments", {}).get("name")
        if match and isinstance(name, str):
            loaded[name] = hashlib.sha256(match[1].encode("utf-8")).hexdigest()
    output["loaded_body_sha256"] = loaded
    if any(loaded.get(name) != truth["body_sha256"][name] for name in truth["required_names"]):
        output["errors"].append("native required skill body hash differs")
    read_results = [item for item in results if item.get("name") == "read" and not item["is_error"]]
    output["repo_read_results"] = [{"file_path": item.get("arguments", {}).get("file_path"),
                                    "returned_utf8_bytes": len(item["text"].encode("utf-8"))}
                                   for item in read_results]
    source_marker = "sessionSettings" if case == "research-one" else "allocateAcrossInvoices"
    if not any(source_marker in item["text"] and str(item.get("arguments", {}).get("file_path", "")).startswith("study/")
               for item in read_results):
        output["errors"].append("no real native read returned frozen repository source")
    records = list((agent / "dsh-home" / "storages").glob("jev_*/operations/*.json"))
    output["jev_operation_files"] = len(records)
    if condition == "baseline":
        index = json.loads((agent / "original-logs" / "index.json").read_text(encoding="utf-8")) \
            if (agent / "original-logs" / "index.json").is_file() else None
        if records or index != [] or not (agent / "dsh-home" / "storages").is_dir():
            output["errors"].append("baseline zero Jev usage lacks a complete empty export")
    elif len(records) != 1:
        output["errors"].append("selection arm did not record one mock Jev operation")
    else:
        errors_before = len(output["errors"])
        record = json.loads(records[0].read_text(encoding="utf-8"))["record"]
        attempt = (record.get("attemptRecords") or [{}])[0]
        questions = (attempt.get("request") or {}).get("questions") or []
        answers = (attempt.get("response") or {}).get("answers") or []
        output["jev_question_count"] = len(questions)
        output["mock_jev_model"] = (attempt.get("rawResponse") or {}).get("model")
        output["jev_receipts"] = [{"id": item.get("id"), "status": item.get("status")}
                                  for item in record.get("receipts") or []]
        if len(questions) != 24 or len(answers) != 24 or output["mock_jev_model"] != "jev-1.13.0-local-fixture" \
                or record.get("featureId") != "skill-selection" or record.get("status") != "succeeded" \
                or attempt.get("status") != "succeeded":
            output["errors"].append("mock Jev did not score all 24 original candidates")
        names = []
        for index, question in enumerate(questions):
            prompt = question.get("prompt", "")
            name = prompt.split("Skill: ", 1)[-1].split(". Description: ", 1)[0]
            names.append(name)
            if question.get("id") != f"candidate-{index}" or index >= len(answers) \
                    or answers[index].get("id") != question.get("id") \
                    or prompt != f"Would this skill help the task? Skill: {name}. Description: {truth['candidate_descriptions'].get(name)}":
                output["errors"].append("mock Jev candidate identity or metadata differs")
                break
        if names != truth["candidate_names"]:
            output["errors"].append("mock Jev candidate order differs from complete directory")
        if any(value in json.dumps(attempt.get("request") or {}) for value in
               ("Start at the authenticated", "Start at the payment", "Follow the payment settlement")):
            output["errors"].append("Jev relevance request included a skill body")
        scores = []
        for index, (name, reply) in enumerate(zip(names, answers)):
            probability = reply.get("probability")
            if reply.get("kind") != "noul" or type(probability) not in (int, float) \
                    or not math.isfinite(probability) or not 0 <= probability <= 1:
                output["errors"].append("mock Jev probability invalid")
                break
            scores.append({"name": name, "probability": probability, "original_index": index})
        output["mock_top5"] = _selected_names(scores, None)
        output["mock_selected_names"] = None
        if selection_valid and len(output["errors"]) == errors_before:
            selected_names = _selected_names(scores, selection)
            receipt_id = "skill-catalog-published" if selected_names else "skill-catalog-no-relevant"
            if not any(item["id"] == receipt_id and item["status"] == "observed"
                       for item in output["jev_receipts"]):
                output["errors"].append("mock Jev publication receipt missing")
            else:
                output["mock_selected_names"] = selected_names
                if published != selected_names:
                    output["errors"].append("published skills differ from recorded selection parameters")
    output["tool_calls"] = [call["name"] for call in calls]
    output["final_answer"] = answer
    output["structural_ok"] = not output["errors"]
    return output


def probe(batch: Path) -> dict:
    """Run two cases under both arms serially, preserving failures without retry."""
    batch = Path(batch).resolve()
    probe_dir = batch / "probe-output"
    manifest = _probe_plan(batch, probe_dir)
    plan = json.loads(manifest.read_text(encoding="utf-8"))
    if plan["model"]["provider"] != "eval-local" or not plan["jev"]["endpoint"].startswith("http://127.0.0.1:0/"):
        raise RuntimeError("keyless probe has an external provider route")
    started = datetime.now(timezone.utc).isoformat()
    rows = []
    for case in CASE_ORDER:
        for condition in CONDITIONS:
            job = _probe_job(probe_dir, manifest, batch, case, condition)
            env = {name: value for name, value in os.environ.items()
                   if not any(marker in name.upper() for marker in ("KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "AUTH"))}
            env["PYTHONPATH"] = os.pathsep.join((str(REPO_ROOT), env.get("PYTHONPATH", "")))
            command = ["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                       "--config", str(job), "--yes"]
            completed = subprocess.run(command, env=env, cwd=REPO_ROOT,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, errors="replace", check=False)
            (job.parent / "pier.stdout.txt").write_text(completed.stdout, encoding="utf-8")
            (job.parent / "pier.stderr.txt").write_text(completed.stderr, encoding="utf-8")
            row = _inspect(probe_dir, batch, case, condition)
            row["pier_exit_code"] = completed.returncode
            rows.append(row)
            _write(probe_dir / "results" / case / f"{condition}.json", row)
            if completed.returncode != 0 or not row["structural_ok"]:
                output = {"status": "failed", "started_at": started,
                          "finished_at": datetime.now(timezone.utc).isoformat(),
                          "slots": rows, "real_provider_calls": {"deepseek": 0, "jev": 0}}
                _write(probe_dir / "report.json", output)
                return output
        left, right = rows[-2:]
        if left["tool_schema"] != right["tool_schema"]:
            output = {"status": "failed", "started_at": started,
                      "finished_at": datetime.now(timezone.utc).isoformat(),
                      "slots": rows, "schema_mismatch": case,
                      "real_provider_calls": {"deepseek": 0, "jev": 0}}
            _write(probe_dir / "report.json", output)
            return output
    output = {"status": "passed", "started_at": started,
              "finished_at": datetime.now(timezone.utc).isoformat(),
              "slots": rows, "real_provider_calls": {"deepseek": 0, "jev": 0},
              "scope": "published DSH, scripted main, loopback Jev; no semantic-accuracy estimate"}
    _write(probe_dir / "report.json", output)
    return output
