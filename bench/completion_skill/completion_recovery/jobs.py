"""One zero-retry Pier trial per frozen diagnostic slot."""

from __future__ import annotations

import json
from pathlib import Path

from bench.deepswe.config import digest


def job_config(batch: Path, slot: dict) -> dict:
    plan = json.loads((batch / "manifest.json").read_text(encoding="utf-8"))
    root = batch / "cases" / slot["case"]
    kwargs = {"manifest_path": str((batch / "manifest.json").resolve()),
              "arm": slot["condition"], "task_id": plan["tasks"][0]["id"],
              "case_id": slot["case"], "condition": slot["condition"],
              "case_root": str(root.resolve()),
              "profile_patch_path": str((batch / "profiles" / f"{slot['condition']}.patch.json").resolve()),
              "fixture_tar_sha256": digest(root / "fixture.tar")}
    env = {name: "${" + name + "}" for name in
           (plan["conditions"]["main_credential_env"], plan["jev"]["credential_env"])}
    return {"job_name": f"jev-recovery-{slot['slot']:02d}",
            "jobs_dir": str((batch / "jobs" / f"{slot['slot']:02d}").resolve()),
            "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
            "agents": [{"import_path": "bench.completion_skill.completion_recovery.agent:RecoveryAgent",
                        "model_name": plan["model"]["route"],
                        "override_timeout_sec": plan["budget"]["agent_timeout_sec"] + 180,
                        "override_setup_timeout_sec": 1200, "kwargs": kwargs, "env": env}],
            "tasks": [{"path": str((root / "task").resolve())}],
            "environment": {"type": "docker", "delete": True, "force_build": False},
            "verifier": {"disable": True}}


def write_jobs(batch: Path, slots: list[dict]) -> int:
    """Validate all Pier jobs before any slot can run."""
    from pier.models.job.config import JobConfig
    from pier.models.task.config import TaskConfig

    if len(slots) != 16:
        raise RuntimeError("recovery requires sixteen slots")
    for slot in slots:
        job = job_config(batch, slot)
        path = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        if path.exists():
            if json.loads(path.read_text(encoding="utf-8")) != job:
                raise RuntimeError(f"frozen recovery job differs: {path}")
        else:
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(job, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        JobConfig.model_validate(job)
        TaskConfig.model_validate_toml((Path(job["tasks"][0]["path"]) / "task.toml").read_text(encoding="utf-8"))
    return len(slots)
