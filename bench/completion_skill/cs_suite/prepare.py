"""Freeze the fixed 26-slot completion, skill, and coding evaluation inputs."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.cli import _check_dsh_lock, _image_reference, _prepare_dsh_lock, _prepare_task
from bench.deepswe.config import digest, evaluator_hashes

from .completion_cases import CASE_ORDER as COMPLETION_CASES, prepare_case as prepare_completion
from .profile import CONDITIONS, internal_arm, profile_rows


SUITE = Path(__file__).resolve().parents[1]
ROOT = SUITE.parents[1]
FAMILIES = ("completion", "skills", "coding")


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _inputs(batch: Path) -> dict[str, str]:
    paths = []
    for folder in (SUITE / "cs_suite", SUITE / "skills", SUITE / "templates"):
        paths += [file for file in folder.rglob("*") if file.is_file() and "__pycache__" not in file.parts]
    for family in FAMILIES:
        home = batch / family
        paths += [home / name for name in ("manifest.json", "evaluator-hashes.json") if (home / name).is_file()]
        for name in ("cases", "prepared-tasks", "dsh-install"):
            folder = home / name
            paths += [file for file in folder.rglob("*") if file.is_file() and
                      "npm-cache" not in file.parts and "node_modules" not in file.parts]
    paths += [file for file in (batch / "profiles").rglob("*") if file.is_file()]
    paths += list((batch / "slots").glob("*/job.json"))
    return {str(path.relative_to(batch)) if path.is_relative_to(batch) else str(path.relative_to(SUITE)): digest(path)
            for path in sorted(set(paths))}


def prepare(batch: Path, plans: dict, image: str, dsh_install_source: Path | None = None) -> dict:
    """Create one immutable batch; never overwrite an existing frozen batch."""
    batch = Path(batch).resolve()
    if batch.exists():
        raise FileExistsError(f"Batch already exists: {batch}")
    task = plans["coding"]["tasks"][0]
    expected_image = _image_reference(task, Path(plans["coding"]["paths"]["deep_swe"]) / "tasks" / task["id"])
    if image != expected_image:
        raise RuntimeError("Synthetic case image differs from the original task pin")
    batch.mkdir(parents=True)
    schedule = []
    try:
        for family in FAMILIES:
            family_dir = batch / family
            family_dir.mkdir()
            _write(family_dir / "manifest.json", plans[family])
            _write(family_dir / "evaluator-hashes.json", evaluator_hashes())
            if family == "completion":
                cases = COMPLETION_CASES
                for case_id in cases:
                    root = batch / family / "cases" / case_id
                    prepare_completion(case_id, root, image)
            elif family == "skills":
                from bench.completion_skill.skills.cases import CASE_ORDER, prepare_case
                cases = CASE_ORDER
                for case_id in cases:
                    root = batch / family / "cases" / case_id
                    prepare_case(case_id, root, image)
            else:
                cases = (task["id"],)
                prepared = _prepare_task(family_dir, plans[family], task)
                if not prepared.is_dir():
                    raise RuntimeError("Coding task was not prepared")
            for case_id in cases:
                for condition in CONDITIONS[family]:
                    patch = batch / "profiles" / family / case_id / f"{condition}.patch.json"
                    _write(patch, profile_rows(plans[family], family, condition,
                                               case_id if family == "skills" else None))
                    schedule.append({"slot": len(schedule) + 1, "family": family,
                                     "case": case_id, "condition": condition,
                                     "internal_arm": internal_arm(family, condition)})
        if len(schedule) != 26:
            raise RuntimeError("Frozen schedule must have exactly 26 slots")
        # All families use the same published DSH build and pinned transitive npm lock.
        if dsh_install_source is None:
            _prepare_dsh_lock(batch / "completion", plans["completion"])
        else:
            shutil.copytree(dsh_install_source, batch / "completion" / "dsh-install",
                            ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
            _check_dsh_lock(batch / "completion", plans["completion"])
        for family in ("skills", "coding"):
            shutil.copytree(batch / "completion" / "dsh-install", batch / family / "dsh-install",
                            ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
            _check_dsh_lock(batch / family, plans[family])
        _write(batch / "schedule.json", {"slots": schedule, "count": len(schedule)})
        from .jobs import write_jobs
        write_jobs(batch)
        _write(batch / "suite-lock.json", {"schema": 1, "inputs_sha256": _inputs(batch),
                                            "image": image, "slot_count": 26,
                                            "schedule_sha256": digest(batch / "schedule.json")})
        return {"batch": str(batch), "count": len(schedule), "image": image,
                "source_files": len(_inputs(batch))}
    except BaseException:
        # Keep incomplete work for diagnosis; a new batch name is required after repair.
        raise
