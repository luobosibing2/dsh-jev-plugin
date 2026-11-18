"""Freeze four two-pair AB/BA completion cases as sixteen Pier slots."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.cli import _check_dsh_lock, _image_reference, _prepare_dsh_lock
from bench.deepswe.config import digest, evaluator_hashes
from bench.completion_skill.resources import PACKAGE, same_scenario_identity

from .cases import CASE_ORDER, prepare_case
from .jobs import write_jobs
from .profile import CONDITIONS, profile_rows, profiles_match_except_feature


REPO_ROOT = PACKAGE.parents[1]
SOURCE_TEMPLATE = PACKAGE / "templates/completion-recovery-16.json"


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def schedule() -> list[dict]:
    """Return stable case, pair, arm, and order identities."""
    slots = []
    for case in CASE_ORDER:
        for repeat, conditions in ((1, ("baseline", "completion_check")),
                                   (2, ("completion_check", "baseline"))):
            for condition in conditions:
                slots.append({"slot": len(slots) + 1, "case": case, "repeat": repeat,
                              "condition": condition, "pair_order": "AB" if repeat == 1 else "BA"})
    return slots


def inputs(batch: Path) -> dict[str, str]:
    """Hash maintained source and immutable batch inputs, excluding evidence output."""
    files = [file for file in (PACKAGE / "completion_recovery").rglob("*")
             if file.is_file() and "__pycache__" not in file.parts and file.suffix != ".pyc"]
    files += [PACKAGE / name for name in ("cli.py", "resources.py", "credential_launcher.mjs",
                                           "README.md", "README.zh-CN.md")]
    files += [SOURCE_TEMPLATE]
    for directory in (batch / "cases", batch / "profiles", batch / "dsh-install"):
        files.extend(file for file in directory.rglob("*") if file.is_file()
                     and "node_modules" not in file.parts and "npm-cache" not in file.parts)
    files.extend((batch / "slots").glob("*/job.json"))
    files += [batch / name for name in ("manifest.json", "schedule.json", "evaluator-hashes.json")]
    return {str(file.relative_to(batch)) if file.is_relative_to(batch)
            else str(file.relative_to(PACKAGE)): digest(file) for file in sorted(set(files))}


def prepare(batch: Path, plan: dict, image: str, install: Path | None = None) -> dict:
    """Create a new batch; existing and historical batches stay untouched."""
    batch = Path(batch).resolve()
    if batch.exists():
        raise FileExistsError(f"recovery batch already exists: {batch}")
    if not same_scenario_identity(plan, SOURCE_TEMPLATE.name):
        raise RuntimeError("recovery manifest differs from tracked template")
    task = plan["tasks"][0]
    expected_image = _image_reference(task, Path(plan["paths"]["deep_swe"]) / "tasks" / task["id"])
    if image != expected_image:
        raise RuntimeError("image differs from pinned resource")
    batch.mkdir(parents=True)
    _write(batch / "manifest.json", plan)
    _write(batch / "evaluator-hashes.json", evaluator_hashes())
    for case in CASE_ORDER:
        prepare_case(case, batch / "cases" / case, image)
    for condition in CONDITIONS:
        _write(batch / "profiles" / f"{condition}.patch.json", profile_rows(plan, condition))
    baseline = json.loads((batch / "profiles/baseline.patch.json").read_text(encoding="utf-8"))
    checked = json.loads((batch / "profiles/completion_check.patch.json").read_text(encoding="utf-8"))
    if not profiles_match_except_feature(baseline, checked):
        raise RuntimeError("paired profiles differ beyond completion switch")
    if install is None:
        _prepare_dsh_lock(batch, plan)
    else:
        shutil.copytree(install, batch / "dsh-install", ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
    _check_dsh_lock(batch, plan)
    slots = schedule()
    _write(batch / "schedule.json", {"slots": slots, "count": len(slots)})
    write_jobs(batch, slots)
    _write(batch / "suite-lock.json", {
        "schema": 1, "image": image, "slot_count": len(slots),
        "schedule_sha256": digest(batch / "schedule.json"),
        "inputs_sha256": inputs(batch), "scenario_template_sha256": digest(SOURCE_TEMPLATE),
    })
    return {"batch": str(batch), "slots": len(slots), "input_files": len(inputs(batch)),
            "image": image, "lock_sha256": digest(batch / "suite-lock.json")}
