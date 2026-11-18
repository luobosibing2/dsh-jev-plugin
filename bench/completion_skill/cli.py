"""Portable entry point for the frozen Jev completion/skill experiments."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from bench.deepswe.cli import _image_reference
from bench.deepswe.config import digest

from . import resources


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def _identity_path(batch: Path) -> Path:
    return batch / "scenario-identity.json"


def _scenario(batch: Path) -> str:
    identity = resources.read_json(_identity_path(batch))
    scenario = identity.get("scenario_id")
    if scenario not in resources.SCENARIOS:
        raise RuntimeError(f"Unknown frozen scenario: {scenario}")
    return scenario


def prepare(scenario: str, batch: Path, resource_file: Path) -> dict:
    """Materialize a named scenario into a new batch with explicit local resources."""
    if scenario not in resources.SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario}")
    batch = Path(batch).resolve()
    if batch.exists():
        raise FileExistsError(f"Batch already exists: {batch}")
    supplied = resources.load_resources(resource_file)
    names = resources.TEMPLATES[scenario]
    plans = [resources.materialize(name, supplied) for name in names]
    task = plans[-1]["tasks"][0]
    image = _image_reference(task, Path(plans[-1]["paths"]["deep_swe"]) / "tasks" / task["id"])
    if image != supplied["image_base"] + "@" + task["image_digest"]:
        raise RuntimeError("Resource Docker image differs from the pinned task")
    install = supplied["resolved_paths"].get("dsh_install")
    if scenario == "completion-recovery-16":
        from .completion_recovery.prepare import prepare as create
        result = create(batch, plans[0], image, install)
    elif scenario == "initial-26":
        from .cs_suite.prepare import prepare as create
        result = create(batch, dict(zip(("completion", "skills", "coding"), plans)), image, install)
    elif scenario == "coding-followup-4":
        from .coding_followup.prepare import prepare as create
        result = create(batch, plans[0], install)
    else:
        from .skill_followup.prepare import prepare as create
        result = create(batch, plans[0], image, install)
    source = resources.source_snapshot()
    _write(_identity_path(batch), {
        "schema": 1, "scenario_id": scenario, "source": source,
        "resource_manifest_sha256": supplied["resource_manifest_sha256"],
        "template_sha256": {name: digest(resources.PACKAGE / "templates" / name) for name in names},
        "plugin_tar_sha256": plans[-1]["versions"]["plugin_tar_sha256"],
        "image": image,
    })
    return {**result, "scenario_id": scenario, "source_git_head": source["git_head"],
            "source_worktree_dirty": source["worktree_dirty"], "source_sha256": source["source_sha256"]}


def check(batch: Path) -> dict:
    """Check package bytes and the named scenario's frozen batch inputs."""
    batch = Path(batch).resolve()
    identity = resources.read_json(_identity_path(batch))
    scenario = _scenario(batch)
    source = resources.source_snapshot()
    if source["source_sha256"] != identity.get("source", {}).get("source_sha256"):
        raise RuntimeError("Maintained evaluation source differs from frozen batch source")
    expected_templates = {name: digest(resources.PACKAGE / "templates" / name)
                          for name in resources.TEMPLATES[scenario]}
    if identity.get("template_sha256") != expected_templates:
        raise RuntimeError("Scenario template changed")
    if scenario == "completion-recovery-16":
        from .completion_recovery.runner import check as gate
    elif scenario == "initial-26":
        from .cs_suite.runner import check as gate
    elif scenario == "coding-followup-4":
        from .coding_followup.runner import check as gate
    else:
        from .skill_followup.runner import check as gate
    return {"scenario_id": scenario, "source_git_head_at_prepare": identity["source"]["git_head"],
            "source_worktree_dirty_at_prepare": identity["source"]["worktree_dirty"],
            "source_sha256": source["source_sha256"], **gate(batch)}


def preflight(batch: Path) -> dict:
    """Run published DSH with local scripted providers where a native probe exists."""
    checked = check(batch)
    scenario = checked["scenario_id"]
    if scenario == "completion-recovery-16":
        from .completion_recovery.probe import preflight as recovery_probe
        return recovery_probe(batch)
    if scenario == "initial-26":
        from .cs_suite.completion_probe import probe as completion_probe, verify as completion_verify
        from .skills.native_probe import probe as skills_probe
        completion = completion_probe(batch, output_name="portable")
        verification = completion_verify(batch / "preflight" / "completion" / "portable")
        skills = skills_probe(batch, output_name="portable")
        return {"scenario_id": scenario, "completion": completion,
                "completion_verification": verification, "skills": skills,
                "coding": "frozen Pier job and original verifier checked without a paid main run"}
    if scenario == "skill-repository-8":
        from .skill_followup.probe import probe
        return {"scenario_id": scenario, "native": probe(batch)}
    return {"scenario_id": scenario, "coding": "frozen Pier job and original verifier checked; no keyless real-main substitute"}


def report(batch: Path) -> dict:
    scenario = _scenario(Path(batch).resolve())
    if scenario == "completion-recovery-16":
        from .completion_recovery.runner import report as make
    elif scenario == "initial-26":
        from .cs_suite.runner import report as make
    elif scenario == "coding-followup-4":
        from .coding_followup.runner import report as make
    else:
        from .skill_followup.runner import report as make
    return make(batch)


def run(batch: Path, *, next_only: bool) -> dict:
    scenario = check(batch)["scenario_id"]
    if scenario == "completion-recovery-16":
        from .completion_recovery.runner import run as execute
        return execute(batch, next_only=next_only)
    if scenario == "initial-26":
        from .cs_suite.runner import run as execute
        return execute(batch, next_only=next_only)
    if scenario == "coding-followup-4":
        from .coding_followup.runner import run as execute
        return execute(batch, next_only=next_only)
    from .skill_followup.runner import next_slot
    if next_only:
        return next_slot(batch)
    result = {}
    for _ in range(8):
        result = next_slot(batch)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="List stable experiment IDs")
    create = sub.add_parser("prepare", help="Prepare a new immutable batch")
    create.add_argument("scenario", choices=resources.SCENARIOS)
    create.add_argument("--batch", type=Path, required=True)
    create.add_argument("--resources", type=Path, required=True)
    for name in ("check", "preflight", "next", "run", "report"):
        item = sub.add_parser(name)
        item.add_argument("--batch", type=Path, required=True)
        if name in ("next", "run"):
            item.add_argument("--execute", action="store_true", required=True)
    args = parser.parse_args()
    if args.command == "list":
        value = {"scenarios": list(resources.SCENARIOS)}
    elif args.command == "prepare":
        value = prepare(args.scenario, args.batch, args.resources)
    elif args.command == "check":
        value = check(args.batch)
    elif args.command == "preflight":
        value = preflight(args.batch)
    elif args.command == "report":
        value = report(args.batch)
    else:
        value = run(args.batch, next_only=args.command == "next")
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
