"""Serial, stop-on-uncertainty execution of the frozen 26-slot suite."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from bench.deepswe.cli import _check_dsh_lock
from bench.deepswe.config import digest, load

from .collector import inspect_basic, read_json
from .completion_analyze import confusion, inspect_completion_slot
from .jobs import write_jobs
from .prepare import FAMILIES, SUITE, _inputs
from .profile import CONDITIONS, expected_features, profile_rows


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def redact_output(value: str, secrets: list[str | None]) -> str:
    """Remove supplied raw and URL-encoded credentials before writing Pier logs."""
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[REDACTED_SECRET]")
            encoded = quote(secret, safe="")
            if encoded != secret:
                value = value.replace(encoded, "[REDACTED_SECRET]")
    return value


def check(batch: Path) -> dict:
    """Fail on any changed source, task, profile, npm lock, or schedule before use."""
    batch = Path(batch).resolve()
    lock = _read(batch / "suite-lock.json")
    schedule = _read(batch / "schedule.json")["slots"]
    if lock.get("slot_count") != 26 or len(schedule) != 26:
        raise RuntimeError("Suite requires exactly 26 slots")
    if digest(batch / "schedule.json") != lock.get("schedule_sha256"):
        raise RuntimeError("Frozen schedule changed")
    if _inputs(batch) != lock.get("inputs_sha256"):
        old = lock.get("inputs_sha256") or {}
        now = _inputs(batch)
        changed = sorted(name for name in {*old, *now} if old.get(name) != now.get(name))
        raise RuntimeError(f"Frozen suite inputs changed: {changed[:12]}")
    plans = {family: load(batch / family / "manifest.json") for family in FAMILIES}
    for family, plan in plans.items():
        _check_dsh_lock(batch / family, plan)
        if plan["phase"] != "formal" or plan["budget"]["max_infrastructure_retries"] != 0:
            raise RuntimeError("Suite must be formal with zero retry allowance")
        if family == "completion":
            if plan.get("main_execution") != "local-scripted-main-real-jev" or plan["model"]["provider"] != "eval-scripted":
                raise RuntimeError("Completion must use local scripted main and real Jev")
        elif plan["model"]["provider"] != "deepseek-official":
            raise RuntimeError("Skill and coding trials must use the official DeepSeek provider")
        if plan["jev"]["endpoint"] != "https://api.typesafe.ai/v1/systemone":
            raise RuntimeError("Real suite Jev endpoint changed")
    expected_sequence = [(family, case, condition) for family, cases in
                         (("completion", __import__("bench.completion_skill.cs_suite.completion_cases", fromlist=["CASE_ORDER"]).CASE_ORDER),
                          ("skills", __import__("bench.completion_skill.skills.cases", fromlist=["CASE_ORDER"]).CASE_ORDER),
                          ("coding", (plans["coding"]["tasks"][0]["id"],)))
                         for case in cases for condition in CONDITIONS[family]]
    actual = [(item["family"], item["case"], item["condition"]) for item in schedule]
    if actual != expected_sequence or [item["slot"] for item in schedule] != list(range(1, 27)):
        raise RuntimeError("Suite schedule differs from the predeclared 6+6+1 pairs")
    for item in schedule:
        family, case, condition = item["family"], item["case"], item["condition"]
        patch = _read(batch / "profiles" / family / case / f"{condition}.patch.json")
        if patch != profile_rows(plans[family], family, condition,
                                 case if family == "skills" else None):
            raise RuntimeError(f"Frozen profile changed for {item['slot']}")
        jev = [row for row in patch if row.get("id") == "jev"]
        if len(jev) != 1 or jev[0]["config"]["features"] != expected_features(family, condition):
            raise RuntimeError(f"Feature flags changed for {item['slot']}")
    count = write_jobs(batch)
    return {"batch": str(batch), "slots": count, "input_files": len(lock["inputs_sha256"]),
            "plugin_sha256": plans["coding"]["versions"]["plugin_tar_sha256"],
            "image": lock["image"], "cost_policy": "advisory", "max_batch_spend_usd": 1}


def inspect_slot(batch: Path, slot: dict) -> dict:
    """Analyze one completed slot from Session, Jev, and Pier evidence."""
    family, case, condition = slot["family"], slot["case"], slot["condition"]
    if family == "completion":
        return inspect_completion_slot(batch, case, condition)
    if family == "skills":
        from bench.completion_skill.skills.analyze import inspect_skill_slot
        return inspect_skill_slot(batch, case, condition)
    result, _, _ = inspect_basic(batch, family, case, condition,
        batch / "jobs" / family / case / condition, batch / family / "manifest.json")
    if result.get("status") == "completed":
        agent = Path(result["agent_dir"])
        trial = read_json(Path(result["trial_result_path"])) or {}
        metadata = ((trial.get("agent_result") or {}).get("metadata") or {})
        reward_path = agent.parent / "verifier" / "reward.json"
        reward = read_json(reward_path) if reward_path.is_file() else None
        result["patch_status"] = metadata.get("patch_status")
        result["verifier_reward"] = reward
        result["verifier_metrics"] = {name: reward.get(name) if reward else None for name in
            ("reward", "f2p_passed", "f2p_total", "p2p_passed", "p2p_total", "apply_failed")}
        result["verifier_evidence"] = {
            "reward_json": str(reward_path) if reward_path.is_file() else None,
            "reward_text": str(agent.parent / "verifier" / "reward.txt")
                           if (agent.parent / "verifier" / "reward.txt").is_file() else None,
            "verifier_dir": str(agent.parent / "verifier"),
            "patch_diff": str(agent / "patch.diff") if (agent / "patch.diff").is_file() else None,
            "pier_trial_result": result["trial_result_path"],
        }
        if metadata.get("patch_status") != "collected":
            result["blocking_errors"].append("Coding patch was not collected")
        if reward is None or reward.get("reward") not in (0, 1):
            result["blocking_errors"].append("Coding verifier did not produce a valid 0/1 reward")
        result["structural_ok"] = not result["blocking_errors"]
    return result


def report(batch: Path) -> dict:
    """Keep planned denominators and missing evidence visible in the batch report."""
    batch = Path(batch).resolve()
    schedule = _read(batch / "schedule.json")["slots"]
    rows = [inspect_slot(batch, slot) for slot in schedule]
    complete = [row for row in rows if row.get("status") == "completed"]
    known = [row["known_estimated_usd"] for row in complete
             if row.get("known_estimated_usd") is not None]
    missing_cost_slots = [index for index, row in enumerate(rows, 1)
                          if row.get("status") == "started" or
                          row.get("status") == "completed" and row.get("known_estimated_usd") is None]
    skill_on = [row for row in rows if row.get("family") == "skills"
                and row.get("condition") == "skill_selection"]
    recall = [row["recall_at_5"] for row in skill_on if type(row.get("recall_at_5")) in (int, float)]
    skill_summary = {"planned_on_cases": 6, "completed_on_cases": sum(row.get("status") == "completed" for row in skill_on),
                     "recall_at_5_defined_cases": len(recall),
                     "mean_recall_at_5": sum(recall) / len(recall) if recall else None,
                     "required_missing_top5": {row["case"]: row["required_missing_top5"] for row in skill_on
                                               if row.get("required_missing_top5") is not None},
                     "required_missing_selected": {row["case"]: row["required_missing_selected"] for row in skill_on
                                                   if row.get("required_missing_selected") is not None},
                     "semantic_success": {condition: sum((row.get("semantic") or {}).get("task_success") is True
                                                         for row in rows if row.get("family") == "skills"
                                                         and row.get("condition") == condition)
                                          for condition in CONDITIONS["skills"]}}
    coding = {row["condition"]: row for row in rows if row.get("family") == "coding"}
    left = (coding.get("baseline") or {}).get("verifier_reward") or {}
    right = (coding.get("completion_check") or {}).get("verifier_reward") or {}
    reward_delta = (right["reward"] - left["reward"]
                    if left.get("reward") in (0, 1) and right.get("reward") in (0, 1) else None)
    output = {"planned_slots": 26, "completed_slots": len(complete), "rows": rows,
              "known_estimated_usd": sum(known),
              "cost_complete": not missing_cost_slots,
              "missing_cost_slots": missing_cost_slots,
              "completion_classification": confusion(rows),
              "skill_summary": skill_summary,
              "coding_pair": {"planned_pairs": 1, "reward_delta": reward_delta,
                              "baseline_reward": left.get("reward"),
                              "completion_check_reward": right.get("reward")},
              "scope": "six fixed synthetic completion pairs, six fixed skill pairs, one original coding pair",
              "limitations": ["Scripted completion main is not a real-model behavior claim",
                              "One coding task pair cannot establish general coding benefit"]}
    _write(batch / "report.json", output)
    from .report_markdown import render
    render(output, batch)
    return output


def run(batch: Path, *, next_only: bool = False) -> dict:
    """Execute in schedule order, optionally stopping after the next unstarted slot."""
    if os.environ.get("JEV_CS_CREDENTIAL_LAUNCHER") != "1":
        raise RuntimeError("Use the suite credential launcher for paid execution")
    checked = check(batch)
    batch = Path(batch).resolve()
    schedule = _read(batch / "schedule.json")["slots"]
    state_path = batch / "run-state.json"
    if state_path.is_file():
        previous = _read(state_path)
        if previous.get("state") in ("running", "halted"):
            raise RuntimeError("Prior slot is running or halted; inspect it before any further paid call")
    completed = []
    known_total = 0.0
    for slot in schedule:
        current = inspect_slot(batch, slot)
        if current["status"] == "completed":
            if not current["structural_ok"] or not current["usage_complete"]:
                raise RuntimeError(f"Existing slot {slot['slot']} has incomplete evidence")
            completed.append(current)
            known_total += current["known_estimated_usd"]
            continue
        if current["status"] != "not-started":
            raise RuntimeError(f"Slot {slot['slot']} was started; manual review is required before any rerun")
        if known_total >= checked["max_batch_spend_usd"]:
            raise RuntimeError("Advisory USD 1 batch ceiling reached before the next slot")
        job = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        _write(state_path, {"state": "running", "slot": slot["slot"], "at": datetime.now(timezone.utc).isoformat(),
                            "known_estimated_usd": known_total})
        plan = _read(batch / slot["family"] / "manifest.json")
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join((str(SUITE), str(SUITE.parents[1]), env.get("PYTHONPATH", "")))
        process = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                                  "--config", str(job), "--yes"], cwd=SUITE.parents[1], env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 errors="replace", check=False)
        secrets = [env.get(name) for name in (plan["jev"]["credential_env"],
                   plan["conditions"]["main_credential_env"])]
        (job.parent / "pier.stdout.txt").write_text(redact_output(process.stdout, secrets), encoding="utf-8")
        (job.parent / "pier.stderr.txt").write_text(redact_output(process.stderr, secrets), encoding="utf-8")
        current = inspect_slot(batch, slot)
        if process.returncode != 0 or not current["structural_ok"] or not current["usage_complete"]:
            _write(state_path, {"state": "halted", "slot": slot["slot"],
                                "pier_exit_code": process.returncode, "reasons": current.get("blocking_errors"),
                                "at": datetime.now(timezone.utc).isoformat()})
            report(batch)
            raise RuntimeError(f"Slot {slot['slot']} failed the stop gate; inspect frozen evidence")
        completed.append(current)
        known_total += current["known_estimated_usd"]
        _write(state_path, {"state": "between-slots", "last_slot": slot["slot"],
                            "known_estimated_usd": known_total, "at": datetime.now(timezone.utc).isoformat()})
        if next_only:
            return report(batch)
    _write(state_path, {"state": "complete", "slots": len(completed),
                        "known_estimated_usd": known_total, "at": datetime.now(timezone.utc).isoformat()})
    return report(batch)
