"""One-shot keyless native completion-check transport probe."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from bench.deepswe.config import digest
from bench.deepswe.report import _session

from .prepare import ROOT, SUITE
from .probe_support import make_probe_plan
from .profile import profile_rows


def probe(batch: Path, case_id: str = "missing-deliverable",
          output_name: str = "tool-schema-fix1") -> dict:
    """Exercise baseline and completion-check in published DSH through Pier."""
    batch = Path(batch).resolve()
    probe_dir = batch / "preflight" / "completion" / output_name
    manifest = make_probe_plan(batch / "completion" / "manifest.json", probe_dir,
                               SUITE / "cs_suite" / "scripted_provider.mjs")
    plan = json.loads(manifest.read_text(encoding="utf-8"))
    plan["model"] = {**plan["model"], "provider": "eval-scripted",
                     "route": "eval-scripted/fixed-script"}
    manifest.write_text(json.dumps(plan, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    case_root = batch / "completion" / "cases" / case_id
    if not case_root.is_dir():
        raise FileNotFoundError(case_root)
    spec = probe_dir / "mock-jev-spec.json"
    spec.write_text(json.dumps({"model": "jev-1.13.0", "defaultChoice": "omission",
                                "choiceByQuestionId": {}, "defaultNoul": 0.9,
                                "usage": {"input_tokens": 4, "output_tokens": 2}}, sort_keys=True) + "\n",
                    encoding="utf-8")
    slots = []
    for condition in ("baseline", "completion_check"):
        patch = probe_dir / "profiles" / condition / "arm.patch.json"
        patch.parent.mkdir(parents=True)
        patch.write_text(json.dumps(profile_rows(plan, "completion", condition), sort_keys=True, indent=2) + "\n",
                         encoding="utf-8")
        job_dir = probe_dir / "jobs" / condition
        job = probe_dir / "slots" / condition / "job.json"
        job.parent.mkdir(parents=True)
        job.write_text(json.dumps({
            "job_name": f"jev-completion-probe-{condition}", "jobs_dir": str(job_dir),
            "n_attempts": 1, "n_concurrent_trials": 1, "retry": {"max_retries": 0},
            "agents": [{"import_path": "bench.completion_skill.cs_suite.completion_agent:CompletionCaseAgent",
                        "model_name": plan["model"]["route"], "override_timeout_sec": 300,
                        "override_setup_timeout_sec": 1200,
                        "kwargs": {"manifest_path": str(manifest), "arm": condition,
                                   "task_id": "vitest-duration-sharding", "family": "completion",
                                   "condition": condition, "case_id": case_id,
                                   "profile_patch_path": str(patch), "case_root": str(case_root),
                                   "fixture_tar_sha256": digest(case_root / "fixture.tar"),
                                   "mock_jev_spec": str(spec)},
                        "env": {"JEV_API_KEY": "local-probe-only", "EVAL_MAIN_PLACEHOLDER": "local-probe-only"}}],
            "tasks": [{"path": str(case_root / "task")}],
            "environment": {"type": "docker", "delete": True, "force_build": False},
            "verifier": {"disable": True},
        }, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        env = dict(os.environ)
        for key in ("DEEPSEEK_API_KEY", "JEV_API_KEY", "DSH_EVAL_DEEPSEEK_KEY"):
            env.pop(key, None)
        env["PYTHONPATH"] = os.pathsep.join((str(ROOT), env.get("PYTHONPATH", "")))
        run = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                              "--config", str(job), "--yes"], env=env, cwd=ROOT,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        (job.parent / "pier.stdout.txt").write_text(run.stdout, encoding="utf-8")
        (job.parent / "pier.stderr.txt").write_text(run.stderr, encoding="utf-8")
        results = list(job_dir.glob("*/task__*/result.json"))
        slot = {"condition": condition, "pier_exit_code": run.returncode,
                "trial_result_count": len(results), "trial_result_path": str(results[0]) if results else None}
        if results:
            trial = json.loads(results[0].read_text(encoding="utf-8"))
            slot["metadata"] = ((trial.get("agent_result") or {}).get("metadata") or {})
            slot["exception"] = (trial.get("exception_info") or {}).get("exception_type")
        slots.append(slot)
        if run.returncode != 0 or len(results) != 1 or slot.get("exception"):
            break
    report = {"slots": slots, "provider_calls": {"deepseek": 0, "jev": 0},
              "status": "transport-complete" if len(slots) == 2 else "transport-failed"}
    (probe_dir / "report.json").write_text(json.dumps(report, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return report


def verify(probe_dir: Path) -> dict:
    """Read native evidence for schema parity and the continuous-omission stop limit."""
    probe_dir = Path(probe_dir).resolve()
    evidence = {}
    for arm in ("baseline", "completion_check"):
        agents = list((probe_dir / "jobs" / arm).glob("*/task__*/agent"))
        if len(agents) != 1:
            raise RuntimeError(f"Expected exactly one {arm} native agent export")
        agent = agents[0]
        tools = json.loads((agent / "scripted-main-tools.json").read_text(encoding="utf-8"))
        sid, events, error = _session(agent)
        if error:
            raise RuntimeError(error)
        actions = [((event.get("data") or {}).get("source") or {}).get("action")
                   for event in events if event.get("type") == "user/message" and
                   ((event.get("data") or {}).get("source") or {}).get("kind") == "jev-supervision"]
        judgments = []
        for file in agent.glob("dsh-home/storages/jev_*/operations/*.json"):
            operation = json.loads(file.read_text(encoding="utf-8"))["record"]
            for attempt in operation.get("attemptRecords") or []:
                answer = next((item.get("optionId") for item in ((attempt.get("response") or {}).get("answers") or [])
                               if item.get("id") == "assessment"), None)
                judgments.append({"started_at": attempt.get("startedAt"), "assessment": answer,
                                  "operation_id": operation.get("id")})
        judgments.sort(key=lambda item: item["started_at"])
        workspace = json.loads((agent / "workspace-outcome.json").read_text(encoding="utf-8"))
        evidence[arm] = {"session_id": sid, "tool_schema": tools,
                         "supervision_actions": actions, "judgments": judgments,
                         "workspace": workspace}
    left, right = evidence["baseline"], evidence["completion_check"]
    passed = (left["tool_schema"] == right["tool_schema"] and
              left["supervision_actions"] == [] and left["judgments"] == [] and
              right["supervision_actions"] == ["supplement", "completion-stopped"] and
              [item["assessment"] for item in right["judgments"]] == ["omission", "omission"] and
              "jev-cs/work/checksum.txt" not in left["workspace"]["file_sha256"] and
              "jev-cs/work/checksum.txt" in right["workspace"]["file_sha256"])
    result = {"status": "passed" if passed else "failed", "arms": evidence,
              "scope": "keyless native published-DSH/Pier plumbing; scripted main and local Jev fixture"}
    (probe_dir / "verification.json").write_text(json.dumps(result, sort_keys=True, indent=2) + "\n",
                                                  encoding="utf-8")
    return result
