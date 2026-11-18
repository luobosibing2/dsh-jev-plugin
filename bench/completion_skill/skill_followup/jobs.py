"""One no-retry Pier job for each predeclared skill-follow-up slot."""

from __future__ import annotations

import json
from pathlib import Path

from bench.deepswe.config import digest

from .profile import internal_arm


def job_config(batch: Path, slot: dict) -> dict:
    plan = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))
    case_root = batch / "cases" / slot["case"]
    patch = batch / "profiles" / f"{slot['condition']}.patch.json"
    kwargs = {
        "manifest_path": str((batch / "manifest.json").resolve()),
        "arm": internal_arm(slot["condition"]),
        "task_id": plan["tasks"][0]["id"],
        "case_id": slot["case"],
        "condition": slot["condition"],
        "case_root": str(case_root.resolve()),
        "profile_patch_path": str(patch.resolve()),
        "fixture_hashes": {
            "repo": digest(case_root / "repo-fixture.tar"),
            "skills": digest(case_root / "skill-fixture.tar"),
        },
    }
    env = {name: "${" + name + "}" for name in
           (plan["conditions"]["main_credential_env"], plan["jev"]["credential_env"])}
    return {
        "job_name": f"jev-sf-{slot['slot']:02d}",
        "jobs_dir": str((batch / "jobs" / f"{slot['slot']:02d}").resolve()),
        "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
        "agents": [{
            "import_path": "bench.completion_skill.skill_followup.agent:FollowupSkillAgent",
            "model_name": plan["model"]["route"],
            "override_timeout_sec": plan["budget"]["agent_timeout_sec"] + 180,
            "override_setup_timeout_sec": 1200,
            "kwargs": kwargs, "env": env,
        }],
        "tasks": [{"path": str((case_root / "task").resolve())}],
        "environment": {"type": "docker", "delete": True, "force_build": False},
        "verifier": {"disable": True},
    }


def write_jobs(batch: Path, schedule: list[dict]) -> int:
    from pier.models.job.config import JobConfig
    from pier.models.task.config import TaskConfig

    if len(schedule) != 8:
        raise RuntimeError("skill follow-up requires exactly eight slots")
    for slot in schedule:
        job = job_config(batch, slot)
        path = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        if path.exists():
            if json.loads(path.read_text(encoding="utf-8")) != job:
                raise RuntimeError(f"frozen job differs: {path}")
        else:
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(job, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        JobConfig.model_validate(job)
        TaskConfig.model_validate_toml((Path(job["tasks"][0]["path"]) / "task.toml").read_text(encoding="utf-8"))
    return len(schedule)
