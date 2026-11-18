"""Create a new immutable eight-slot skill follow-up batch."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from bench.deepswe.cli import _check_dsh_lock, _image_reference, _prepare_dsh_lock
from bench.deepswe.config import digest, evaluator_hashes, load
from bench.completion_skill.resources import same_scenario_identity

from .cases import CASE_ORDER, prepare_case
from .jobs import write_jobs
from .profile import CONDITIONS, profile_rows, profiles_match_except_feature


SUITE = Path(__file__).resolve().parents[1]
REPO_ROOT = SUITE.parents[1]
SOURCE_PLAN = SUITE / "templates/skill-repository-8.json"


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def schedule() -> list[dict]:
    slots = []
    for case in CASE_ORDER:
        for repeat, conditions in ((1, ("baseline", "skill_selection")),
                                   (2, ("skill_selection", "baseline"))):
            for condition in conditions:
                slots.append({"slot": len(slots) + 1, "case": case,
                              "repeat": repeat, "condition": condition,
                              "pair_order": "AB" if repeat == 1 else "BA"})
    return slots


def inputs(batch: Path) -> dict[str, str]:
    """Hash every source and model-visible frozen input, excluding runtime output."""
    files = [file for file in (SUITE / "skill_followup").rglob("*")
             if file.is_file() and "__pycache__" not in file.parts]
    files += [file for file in (SUITE / "credential_launcher.mjs", SUITE / "README.md") if file.is_file()]
    for directory in (batch / "cases", batch / "profiles"):
        files.extend(file for file in directory.rglob("*") if file.is_file())
    files.extend(file for file in (batch / "slots").glob("*/job.json") if file.is_file())
    files += [batch / name for name in ("manifest.json", "schedule.json", "evaluator-hashes.json")]
    return {str(file.relative_to(batch)) if file.is_relative_to(batch)
            else str(file.relative_to(SUITE)): digest(file) for file in sorted(set(files))}


def _same_scenario_identity(plan: dict) -> None:
    if not same_scenario_identity(plan, "skill-repository-8.json"):
        raise RuntimeError("Skill follow-up differs from its tracked scenario template")


def prepare(batch: Path, plan: dict, image: str, dsh_install_source: Path | None = None) -> dict:
    """Materialize and freeze new inputs without touching the prior batch."""
    batch = Path(batch).resolve()
    if batch.exists():
        raise FileExistsError(f"follow-up batch exists: {batch}")
    _same_scenario_identity(plan)
    task = plan["tasks"][0]
    expected_image = _image_reference(task, Path(plan["paths"]["deep_swe"]) / "tasks" / task["id"])
    if image != expected_image:
        raise RuntimeError("Synthetic case image differs from the original task pin")
    batch.mkdir(parents=True)
    _write(batch / "manifest.json", plan)
    _write(batch / "evaluator-hashes.json", evaluator_hashes())
    for case in CASE_ORDER:
        prepare_case(case, batch / "cases" / case, image)
    for condition in CONDITIONS:
        _write(batch / "profiles" / f"{condition}.patch.json", profile_rows(plan, condition))
    baseline = json.loads((batch / "profiles" / "baseline.patch.json").read_text(encoding="utf-8"))
    selected = json.loads((batch / "profiles" / "skill_selection.patch.json").read_text(encoding="utf-8"))
    if not profiles_match_except_feature(baseline, selected):
        raise RuntimeError("paired profiles differ beyond skill selection")
    if dsh_install_source is None:
        _prepare_dsh_lock(batch, plan)
    else:
        shutil.copytree(dsh_install_source, batch / "dsh-install",
                        ignore=shutil.ignore_patterns("npm-cache", "node_modules"))
    _check_dsh_lock(batch, plan)
    slots = schedule()
    _write(batch / "schedule.json", {"slots": slots, "count": len(slots)})
    write_jobs(batch, slots)
    _write(batch / "suite-lock.json", {
        "schema": 1, "image": image, "slot_count": 8,
        "schedule_sha256": digest(batch / "schedule.json"),
        "inputs_sha256": inputs(batch),
        "scenario_template_sha256": digest(SOURCE_PLAN),
    })
    return {"batch": str(batch), "slots": len(slots), "input_files": len(inputs(batch)),
            "image": image, "source_sha256": digest(batch / "suite-lock.json")}
