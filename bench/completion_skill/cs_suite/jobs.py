"""Materialize exactly one Pier trial per predeclared suite slot."""

from __future__ import annotations

import json
from pathlib import Path

from bench.deepswe.config import digest


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def job_config(batch: Path, slot: dict) -> dict:
    """Build a no-retry Docker JobConfig from the frozen schedule entry."""
    family, case, condition = slot["family"], slot["case"], slot["condition"]
    internal_arm = slot["internal_arm"]
    plan = _read(batch / family / "manifest.json")
    case_root = batch / family / "cases" / case
    kwargs = {"manifest_path": str((batch / family / "manifest.json").resolve()),
              "arm": internal_arm, "task_id": plan["tasks"][0]["id"]}
    if family in ("completion", "skills"):
        patch = batch / "profiles" / family / case / f"{condition}.patch.json"
        kwargs.update(family=family, condition=condition, case_id=case,
                      case_root=str(case_root.resolve()),
                      profile_patch_path=str(patch.resolve()),
                      fixture_tar_sha256=digest(case_root / "fixture.tar"))
        agent_import = ("bench.completion_skill.cs_suite.completion_agent:CompletionCaseAgent" if family == "completion"
                        else "bench.completion_skill.skills.agent:SkillCaseAgent")
        task_path = case_root / "task"
    else:
        agent_import = "bench.deepswe.agent:DshAgent"
        task_path = batch / "coding" / "prepared-tasks" / case
    env = {plan["jev"]["credential_env"]: "${" + plan["jev"]["credential_env"] + "}"}
    if family != "completion":
        env[plan["conditions"]["main_credential_env"]] = "${" + plan["conditions"]["main_credential_env"] + "}"
    else:
        env["EVAL_MAIN_PLACEHOLDER"] = "local-scripted-no-provider"
    agent = {"import_path": agent_import, "model_name": plan["model"]["route"],
             "override_timeout_sec": plan["budget"]["agent_timeout_sec"] + 180,
             "override_setup_timeout_sec": 1200, "kwargs": kwargs, "env": env}
    return {"job_name": f"jev-cs-{slot['slot']:02d}-{family}",
            "jobs_dir": str((batch / "jobs" / family / case / condition).resolve()),
            "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
            "agents": [agent], "tasks": [{"path": str(task_path.resolve())}],
            "environment": {"type": "docker", "delete": True, "force_build": False},
            "verifier": {"override_timeout_sec": plan["budget"]["verifier_timeout_sec"],
                         "disable": family != "coding"}}


def write_jobs(batch: Path) -> int:
    """Write and validate all immutable Pier job files before any paid call."""
    from pier.models.job.config import JobConfig
    from pier.models.task.config import TaskConfig

    batch = Path(batch).resolve()
    schedule = _read(batch / "schedule.json")["slots"]
    if len(schedule) != 26:
        raise RuntimeError("Expected exactly 26 predeclared slots")
    for slot in schedule:
        job = job_config(batch, slot)
        path = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        if path.exists():
            if _read(path) != job:
                raise RuntimeError(f"Pier job changed: {path}")
        else:
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(job, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        JobConfig.model_validate(job)
        task = Path(job["tasks"][0]["path"])
        TaskConfig.model_validate_toml((task / "task.toml").read_text(encoding="utf-8"))
    return len(schedule)
