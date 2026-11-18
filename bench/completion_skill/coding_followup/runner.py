"""Validate and serially run at most four frozen coding trials."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from bench.deepswe.cli import _check_dsh_lock, _job_config
from bench.deepswe.config import digest, evaluator_hashes, load, schedule, tree_digest

from .collect import inspect_slot, read_json
from .prepare import EXPECTED_ORDER, ROOT, SOURCE_PLAN, SUITE, _inputs, _profile, _same_original_identity


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def redact_output(text: str, supplied_keys: list[str | None]) -> str:
    """Remove actual key values before any Pier command output is saved."""
    for key in supplied_keys:
        if key:
            text = text.replace(key, "[REDACTED_SECRET]")
            encoded = quote(key, safe="")
            if encoded != key:
                text = text.replace(encoded, "[REDACTED_SECRET]")
    return text


def check(batch: Path) -> dict:
    """Require exact source, plan, runtime, task, profile, and job identity."""
    from pier.models.job.config import JobConfig
    from pier.models.task.config import TaskConfig

    batch = Path(batch).resolve()
    lock = read_json(batch / "suite-lock.json") or {}
    if lock.get("schema") != 1 or lock.get("slot_count") != 4 or lock.get("order") != list(EXPECTED_ORDER):
        raise RuntimeError("Follow-up lock does not declare exactly four AB/BA slots")
    actual_inputs = _inputs(batch)
    if actual_inputs != lock.get("input_sha256"):
        old = lock.get("input_sha256") or {}
        changed = sorted(key for key in {*old, *actual_inputs} if old.get(key) != actual_inputs.get(key))
        raise RuntimeError(f"Frozen follow-up inputs changed: {changed[:12]}")
    plan = load(batch / "manifest.json")
    _same_original_identity(plan)
    if read_json(batch / "evaluator-hashes.json") != evaluator_hashes():
        raise RuntimeError("Published DSH evaluator source differs from the frozen batch")
    _check_dsh_lock(batch, plan)
    slots = schedule(plan)
    if (read_json(batch / "schedule.json") or {}).get("slots") != slots:
        raise RuntimeError("Frozen AB/BA schedule differs from the plan")
    identity = read_json(batch / "source-identity.json") or {}
    task = plan["tasks"][0]
    prepared = batch / "prepared-tasks" / task["id"]
    prepared_identity = read_json(batch / "prepared-tasks" / f"{task['id']}.identity.json") or {}
    if (identity.get("scenario_template_sha256") != digest(SOURCE_PLAN) or
        identity.get("original_task_sha256") != task["sha256"] or
        identity.get("prepared_task_sha256") != tree_digest(prepared) or
        identity.get("prepared_task_sha256") != prepared_identity.get("prepared_sha256") or
        identity.get("plugin_tar_sha256") != plan["versions"]["plugin_tar_sha256"] or
        identity.get("pinned_image_digest") != task["image_digest"] or
        identity.get("dsh_lock_sha256") != digest(batch / "dsh-install/package-lock.json")):
        raise RuntimeError("Original task or runtime identity differs from the frozen batch")
    if prepared_identity.get("image", "").split("@")[-1] != task["image_digest"]:
        raise RuntimeError("Prepared task uses an unexpected image digest")
    profiles = []
    for arm in plan["arms"]:
        row = read_json(batch / "profiles" / f"{arm}.patch.json")
        if row != _profile(plan, arm):
            raise RuntimeError(f"{arm} profile differs from the frozen plan")
        profiles.append(json.loads(json.dumps(row)))
    features = [next(item for item in row if item.get("id") == "jev")["config"].pop("features")
                for row in profiles]
    if profiles[0] != profiles[1] or [name for name in features[0] if features[0][name] != features[1][name]] != ["completion-check"]:
        raise RuntimeError("Arms differ in more than the completion-check switch")
    for slot in slots:
        attempt = batch / "slots" / slot["slot_id"] / "attempt-001"
        job = read_json(attempt / "job.json")
        if job != _job_config(batch, plan, slot, attempt, prepared):
            raise RuntimeError(f"Pier job differs from frozen slot {slot['slot_id']}")
        JobConfig.model_validate(job)
        if (job["agents"][0]["override_timeout_sec"] != 1980 or
            job["agents"][0]["override_setup_timeout_sec"] != 1200 or
            job["verifier"]["override_timeout_sec"] != 1800 or
            job["verifier"]["disable"] is not False or
            job["environment"] != {"type": "docker", "delete": True, "force_build": False}):
            raise RuntimeError("Pier timeout, verifier, or Docker mode differs from frozen design")
    TaskConfig.model_validate_toml((prepared / "task.toml").read_text(encoding="utf-8"))
    return {"batch": str(batch), "slots": 4, "order": list(EXPECTED_ORDER),
            "input_files": len(actual_inputs), "known_spend_ceiling_usd": 1.75,
            "agent_timeout_sec": 1800, "verifier_timeout_sec": 1800,
            "outer_agent_timeout_sec": 1980}


def report(batch: Path) -> dict:
    """Keep all four planned slots, including stopped and unstarted slots."""
    batch = Path(batch).resolve()
    plan = read_json(batch / "manifest.json") or {}
    slots = schedule(plan)
    rows = [inspect_slot(batch, slot) for slot in slots]
    complete = [row for row in rows if row["status"] == "completed"]
    missing_cost = [index for index, row in enumerate(rows, 1)
                    if row["status"] == "started" or row["status"] == "completed" and not row["usage_complete"]]
    known = sum(row["known_estimated_usd"] for row in complete if row["known_estimated_usd"] is not None)
    pairs = []
    for repeat in range(2):
        by_arm = {row["slot"]["arm"]: row for row in rows if row["slot"]["repeat"] == repeat}
        left, right = by_arm["baseline"], by_arm["completion_check"]
        comparable = bool(left["structural_ok"] and right["structural_ok"])
        pairs.append({"repeat": repeat + 1, "order": [slot["arm"] for slot in slots if slot["repeat"] == repeat],
                      "both_structurally_complete": comparable,
                      "baseline_reward": (left.get("verifier") or {}).get("reward"),
                      "completion_check_reward": (right.get("verifier") or {}).get("reward"),
                      "reward_delta": ((right["verifier"]["reward"] - left["verifier"]["reward"])
                                       if comparable else None),
                      "enabled_completion_judgment_observed": (right.get("completion_participation") or {}).get("judgment_observed"),
                      "enabled_jev_operations": (right.get("jev") or {}).get("operations"),
                      "enabled_supplements": right.get("supplement_requests")})
    output = {"planned_slots": 4, "completed_trials": len(complete), "rows": rows,
              "pairs": pairs, "known_estimated_usd": known,
              "cost_complete": not missing_cost, "missing_cost_slots": missing_cost,
              "scope": "One original Vitest task repeated twice in AB/BA order at 1800-second Agent limit; not a general benefit estimate"}
    _write(batch / "report.json", output)
    from .report_markdown import render
    render(batch, output)
    return output


def run(batch: Path, *, next_only: bool = False) -> dict:
    """Execute serially; stop on any structural, service, usage, or budget failure."""
    if os.environ.get("JEV_CODING_FOLLOWUP_LAUNCHER") != "1":
        raise RuntimeError("Use the coding follow-up credential launcher for paid execution")
    checked = check(batch)
    batch = Path(batch).resolve()
    slots = schedule(load(batch / "manifest.json"))
    state_file = batch / "run-state.json"
    prior = read_json(state_file) or {}
    if prior.get("state") in ("running", "halted"):
        raise RuntimeError("Prior trial is running or halted; operator review is required")
    known_total = 0.0
    for index, slot in enumerate(slots, 1):
        previous = inspect_slot(batch, slot)
        if previous["status"] == "completed":
            if not previous["structural_ok"] or not previous["usage_complete"]:
                raise RuntimeError(f"Existing slot {index} has incomplete evidence")
            known_total += previous["known_estimated_usd"]
            continue
        if previous["status"] != "not-started":
            raise RuntimeError(f"Slot {index} was started; no automatic retry is allowed")
        if known_total >= checked["known_spend_ceiling_usd"]:
            raise RuntimeError("Known peak-price estimate reached USD 1.75 before the next slot")
        attempt = batch / "slots" / slot["slot_id"] / "attempt-001"
        job = attempt / "job.json"
        _write(state_file, {"state": "running", "slot": index, "at": datetime.now(timezone.utc).isoformat(),
                            "known_estimated_usd": known_total})
        _write(attempt / "state.json", {"state": "running", "slot": index})
        plan = read_json(batch / "manifest.json") or {}
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join((str(SUITE), str(ROOT), env.get("PYTHONPATH", "")))
        process = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                                  "--config", str(job), "--yes"], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 errors="replace", check=False)
        keys = [env.get(plan["conditions"]["main_credential_env"]), env.get(plan["jev"]["credential_env"])]
        (attempt / "pier.stdout.txt").write_text(redact_output(process.stdout, keys), encoding="utf-8")
        (attempt / "pier.stderr.txt").write_text(redact_output(process.stderr, keys), encoding="utf-8")
        observed = inspect_slot(batch, slot)
        if process.returncode != 0 or not observed["structural_ok"] or not observed["usage_complete"]:
            errors = [*observed["blocking_errors"]]
            if process.returncode:
                errors.append(f"Pier exited {process.returncode}")
            _write(attempt / "state.json", {"state": "halted", "slot": index, "errors": errors})
            _write(state_file, {"state": "halted", "slot": index, "errors": errors,
                                "at": datetime.now(timezone.utc).isoformat()})
            report(batch)
            raise RuntimeError(f"Slot {index} stopped the follow-up batch; inspect saved evidence")
        known_total += observed["known_estimated_usd"]
        _write(attempt / "state.json", {"state": "terminal", "slot": index})
        _write(state_file, {"state": "between-slots", "last_slot": index,
                            "known_estimated_usd": known_total, "at": datetime.now(timezone.utc).isoformat()})
        _write(batch / "progress.json", {"last_slot": index, "completed_trials": index,
                                         "termination": observed["termination"],
                                         "verifier_reward": observed["verifier"]["reward"],
                                         "jev_operations": observed["jev"]["operations"],
                                         "known_estimated_usd": known_total})
        if next_only:
            return report(batch)
    _write(state_file, {"state": "complete", "slots": 4,
                        "known_estimated_usd": known_total, "at": datetime.now(timezone.utc).isoformat()})
    return report(batch)
