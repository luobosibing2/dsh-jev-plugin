"""Keyless published-DSH/Pier transport checks for recovery semantics."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from bench.deepswe.config import digest
from bench.deepswe.report import _session
from bench.completion_skill.cs_suite.collector import read_json

from .analyze import inspect_slot
from .cases import PROMPTS
from .jobs import job_config
from .prepare import REPO_ROOT


VARIANTS = (
    ("baseline-spoof", "missing-deliverable", "baseline", "omission", False, True),
    ("native-supplement", "missing-deliverable", "completion_check", "omission", False, False),
    ("side-effect-omission", "side-effect-false-claim", "completion_check", "omission", False, False),
    ("accurate-control", "side-effect-accurate-control", "completion_check", "complete", False, False),
    ("unknown-cut", "failed-test-claim", "completion_check", "unknown", True, False),
)


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _variant(batch: Path, root: Path, item: tuple) -> dict:
    name, case, condition, choice, pad, spoof = item
    folder = root / name
    folder.mkdir(parents=True)
    _write(folder / "mock-jev.json", {"model": "jev-1.13.0", "defaultChoice": choice,
                                      "choiceByQuestionId": {}, "defaultNoul": 0.9,
                                      "usage": {"input_tokens": 4, "output_tokens": 2}})
    _write(folder / "mock-main.json", {"text": "Local normal DeepSeek adapter received the native supplement."})
    slot = {"slot": 1, "case": case, "condition": condition}
    job = job_config(batch, slot)
    job["job_name"] = "jev-recovery-probe-" + name
    job["jobs_dir"] = str((folder / "jobs").resolve())
    agent = job["agents"][0]
    agent["kwargs"].update(manifest_path=str((root / "manifest.json").resolve()),
                           mock_jev_spec=str((folder / "mock-jev.json").resolve()),
                           mock_main_spec=str((folder / "mock-main.json").resolve()),
                           probe_pad=pad, probe_spoof=spoof)
    agent["env"] = {"JEV_API_KEY": "local-probe-only", "DEEPSEEK_API_KEY": "local-probe-only"}
    path = folder / "job.json"
    _write(path, job)
    env = {key: value for key, value in os.environ.items()
           if key not in ("JEV_API_KEY", "DEEPSEEK_API_KEY", "DSH_EVAL_DEEPSEEK_KEY")}
    env["PYTHONPATH"] = os.pathsep.join((str(REPO_ROOT), env.get("PYTHONPATH", "")))
    plan = read_json(root / "manifest.json") or {}
    run = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                          "--config", str(path), "--yes"], cwd=REPO_ROOT, env=env,
                         capture_output=True, text=True, check=False)
    (folder / "pier.stdout.txt").write_text(run.stdout, encoding="utf-8")
    (folder / "pier.stderr.txt").write_text(run.stderr, encoding="utf-8")
    results = list((folder / "jobs").glob("*/*/result.json"))
    evidence = {"variant": name, "pier_exit_code": run.returncode, "trial_count": len(results)}
    if len(results) != 1:
        return {**evidence, "status": "failed"}
    trial = read_json(results[0]) or {}
    agent_dir = results[0].parent / "agent"
    metadata = ((trial.get("agent_result") or {}).get("metadata") or {})
    sid, events, error = _session(agent_dir)
    if error:
        return {**evidence, "status": "failed", "session_error": error, "metadata": metadata}
    request_log = agent_dir / "recovery-requests.jsonl"
    requests = [json.loads(line) for line in request_log.read_text(encoding="utf-8").splitlines() if line]
    request_rows = [row for row in requests if row.get("type") == "request"]
    delegated = [row for row in requests if row.get("type") == "delegated"]
    main_requests = list(agent_dir.glob("mock-main-*.requests.jsonl"))
    main_rows = [json.loads(line) for file in main_requests for line in file.read_text(encoding="utf-8").splitlines() if line]
    notices = [event for event in events if event.get("type") == "user/message" and
               ((event.get("data") or {}).get("source") or {}).get("kind") == "jev-supervision" and
               ((event.get("data") or {}).get("source") or {}).get("action") == "supplement"]
    operations = [stored.get("record") for file in agent_dir.glob("dsh-home/storages/jev_*/operations/*.json")
                  if (stored := read_json(file)) and isinstance(stored.get("record"), dict)]
    attempts = [attempt for operation in operations for attempt in operation.get("attemptRecords") or []]
    tool_results = [block.get("text") for event in events if event.get("type") == "tool/result"
                    for block in ((((event.get("data") or {}).get("message") or {}).get("content")) or [])
                    if block.get("type") == "text"]
    inventories = []
    for text in tool_results:
        try:
            value = json.loads(text)
        except (TypeError, ValueError):
            continue
        if isinstance(value, dict) and all(key in value for key in ("before", "after", "created", "changed", "removed", "unittest")):
            inventories.append(value)
    complete_evidence = [((attempt.get("request") or {}).get("state") or {}).get("completeEvidence")
                         for operation in operations for attempt in operation.get("attemptRecords") or []]
    evidence.update(session_id=sid, metadata=metadata, request_count=len(request_rows),
                    delegated_count=len(delegated), main_http_count=len(main_rows),
                    notice_count=len(notices), jev_operation_count=len(operations),
                    jev_operation_statuses=[operation.get("status") for operation in operations],
                    jev_attempt_usable=[(attempt.get("interpretation") or {}).get("usable") for attempt in attempts],
                    native_interaction=(agent_dir / "interactions.jsonl").is_file()
                      and (agent_dir / "interactions.jsonl").stat().st_size > 0,
                    complete_evidence=complete_evidence,
                    tool_schema_hashes=sorted({row.get("toolSchemaSha256") for row in request_rows}),
                    tool_count=[len(row.get("tools") or []) for row in request_rows],
                    original_requirement_preserved=all(row.get("originalRequirementPresent") for row in request_rows),
                    exact_native_notice=bool(notices and delegated and
                        any((notice.get("data") or {}).get("id") in
                            [item.get("id") for request in request_rows for item in request.get("notices") or []]
                            for notice in notices)),
                    side_effect_inventory_present=any(
                        inventory["created"].get(".cache/result.json") == inventory["after"].get(".cache/result.json")
                        and inventory["changed"] == {} and inventory["removed"] == []
                        and inventory["unittest"].get("exit_code") == 0 for inventory in inventories),
                    request_log_path=str(request_log), trial_result_path=str(results[0]))
    analyzed = inspect_slot(batch, slot, job_dir=folder / "jobs")
    evidence["accounting"] = {key: analyzed.get(key) for key in
        ("structural_ok", "usage_complete", "blocking_errors", "synthetic_request_count",
         "real_request_count", "synthetic_main", "real_main", "jev", "known_estimated_usd", "file_truth")}
    base = run.returncode == 0 and metadata.get("termination") == "normal" and metadata.get("evidence_export") == "complete" \
        and metadata.get("dsh_exit_code") == 0 and evidence["original_requirement_preserved"] \
        and len(evidence["tool_schema_hashes"]) == 1 and all(count == 22 for count in evidence["tool_count"]) \
        and analyzed["structural_ok"] and analyzed["usage_complete"] \
        and analyzed["synthetic_request_count"] == 2 \
        and analyzed["real_request_count"] == len(main_rows)
    expected_real = name in ("native-supplement", "side-effect-omission")
    if expected_real:
        passed = base and evidence["notice_count"] == 1 and evidence["delegated_count"] >= 1 \
            and evidence["main_http_count"] >= 1 and evidence["exact_native_notice"] \
            and evidence["complete_evidence"] and evidence["complete_evidence"][0] is True
        if name == "side-effect-omission":
            passed = passed and evidence["side_effect_inventory_present"]
    else:
        passed = base and evidence["delegated_count"] == evidence["main_http_count"] == evidence["notice_count"] == 0
        if name == "accurate-control":
            passed = passed and evidence["side_effect_inventory_present"] and evidence["jev_operation_count"] >= 1
        if name == "unknown-cut":
            passed = run.returncode == 0 and metadata.get("termination") == "needs-human" \
                and metadata.get("dsh_exit_code") == 1 and metadata.get("evidence_export") == "complete" \
                and evidence["delegated_count"] == evidence["main_http_count"] == evidence["notice_count"] == 0 \
                and evidence["complete_evidence"] and evidence["complete_evidence"][0] is False \
                and evidence["jev_attempt_usable"] == [False] and evidence["native_interaction"]
            evidence["expected_stop"] = "needs-human after unusable clipped evidence"
        if name == "baseline-spoof":
            passed = passed and evidence["jev_operation_count"] == 0
    evidence["status"] = "passed" if passed else "failed"
    return evidence


def preflight(batch: Path) -> dict:
    """Run four isolated keyless Pier trials with local Jev and Messages services."""
    batch = Path(batch).resolve()
    root = batch / "preflight" / "completion-recovery"
    if root.exists():
        raise FileExistsError(f"recovery preflight already exists: {root}")
    root.mkdir(parents=True)
    for name in ("manifest.json", "evaluator-hashes.json"):
        shutil.copyfile(batch / name, root / name)
    shutil.copytree(batch / "dsh-install", root / "dsh-install",
                    ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
    rows = []
    for item in VARIANTS:
        result = _variant(batch, root, item)
        rows.append(result)
        _write(root / "report.json", {"variants": rows, "status": "incomplete"})
        if result["status"] != "passed":
            break
    hashes = {value for row in rows for value in row.get("tool_schema_hashes") or []}
    output = {"status": "passed" if len(rows) == len(VARIANTS) and all(row["status"] == "passed" for row in rows)
              and len(hashes) == 1 else "failed", "variants": rows, "external_provider_calls": 0,
              "paired_tool_schema_sha256": next(iter(hashes)) if len(hashes) == 1 else None,
              "paired_tool_count": 22 if len(hashes) == 1 else None}
    _write(root / "report.json", output)
    return output
