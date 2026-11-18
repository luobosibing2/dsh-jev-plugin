"""Freeze the original Vitest task in two AB/BA coding pairs."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.cli import _check_dsh_lock, _job_config, _prepare_dsh_lock, _prepare_task
from bench.deepswe.config import digest, evaluator_hashes, schedule, tree_digest
from bench.deepswe.profile import patch_rows
from bench.completion_skill.resources import PACKAGE, REPO_ROOT, same_scenario_identity


SUITE = PACKAGE
ROOT = REPO_ROOT
SOURCE_PLAN = PACKAGE / "templates/coding-followup-4.json"
EXPECTED_ORDER = ("baseline", "completion_check", "completion_check", "baseline")


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _same_original_identity(plan: dict) -> None:
    if not same_scenario_identity(plan, "coding-followup-4.json"):
        raise RuntimeError("Coding follow-up differs from its tracked scenario template")
    if [item["arm"] for item in schedule(plan)] != list(EXPECTED_ORDER):
        raise RuntimeError("Follow-up coding order must be AB/BA")


def _profile(plan: dict, arm: str) -> list[dict]:
    return patch_rows(plan, arm, guard_path="/tmp/jev-deepswe/interaction_guard.mjs")


def _inputs(batch: Path) -> dict[str, str]:
    """Hash code, plan, runtime locks, prepared task, profiles, and four jobs."""
    sources = [item for item in (SUITE / "coding_followup").rglob("*")
               if item.is_file() and "__pycache__" not in item.parts]
    sources += [SOURCE_PLAN, SUITE / "credential_launcher.mjs"]
    frozen = [batch / name for name in ("manifest.json", "schedule.json", "evaluator-hashes.json",
                                         "source-identity.json")]
    for name in ("dsh-install", "prepared-tasks", "profiles"):
        folder = batch / name
        frozen += [item for item in folder.rglob("*") if item.is_file() and
                   "npm-cache" not in item.parts]
    frozen += list((batch / "slots").glob("*/attempt-001/job.json"))
    paths = sorted(set(sources + frozen))
    return {(str(path.relative_to(batch)) if path.is_relative_to(batch)
             else str(path.relative_to(SUITE))): digest(path) for path in paths}


def prepare(batch: Path, plan: dict, dsh_install_source: Path | None = None) -> dict:
    """Write a new batch once; leave any partial batch for inspection."""
    batch = Path(batch).resolve()
    if batch.exists():
        raise FileExistsError(batch)
    _same_original_identity(plan)
    slots = schedule(plan)
    if len(slots) != 4:
        raise RuntimeError("Follow-up coding requires exactly four slots")
    batch.mkdir(parents=True)
    _write(batch / "manifest.json", plan)
    _write(batch / "schedule.json", {"slots": slots, "count": 4})
    _write(batch / "evaluator-hashes.json", evaluator_hashes())
    if dsh_install_source is None:
        _prepare_dsh_lock(batch, plan)
    else:
        shutil.copytree(dsh_install_source, batch / "dsh-install",
                        ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
    _check_dsh_lock(batch, plan)
    task = plan["tasks"][0]
    prepared = _prepare_task(batch, plan, task)
    if tree_digest(prepared) != json.loads((batch / "prepared-tasks" / f"{task['id']}.identity.json").read_text())["prepared_sha256"]:
        raise RuntimeError("Prepared task differs from the pinned task identity")
    for arm in plan["arms"]:
        _write(batch / "profiles" / f"{arm}.patch.json", _profile(plan, arm))
    for slot in slots:
        attempt = batch / "slots" / slot["slot_id"] / "attempt-001"
        attempt.mkdir(parents=True)
        _write(attempt / "job.json", _job_config(batch, plan, slot, attempt, prepared))
    _write(batch / "source-identity.json", {
        "scenario_template_sha256": digest(SOURCE_PLAN),
        "original_task_sha256": task["sha256"],
        "prepared_task_sha256": tree_digest(prepared),
        "plugin_tar_sha256": plan["versions"]["plugin_tar_sha256"],
        "pinned_image_digest": task["image_digest"],
        "dsh_lock_sha256": digest(batch / "dsh-install/package-lock.json"),
    })
    _write(batch / "suite-lock.json", {"schema": 1, "input_sha256": _inputs(batch),
                                       "slot_count": 4, "order": list(EXPECTED_ORDER)})
    return {"batch": str(batch), "slots": 4, "input_files": len(_inputs(batch)),
            "order": list(EXPECTED_ORDER)}
