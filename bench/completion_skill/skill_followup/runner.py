"""Frozen one-slot-at-a-time runner and evidence report for skill follow-up."""

from __future__ import annotations

import json
import hashlib
import os
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from bench.deepswe.cli import _check_dsh_lock
from bench.deepswe.config import digest, load

from .analyze import inspect_slot
from .cases import CASE_ORDER
from .jobs import job_config
from .prepare import REPO_ROOT, SOURCE_PLAN, inputs, schedule, _same_scenario_identity
from .profile import CONDITIONS, expected_features, profile_rows, profiles_match_except_feature


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def redact_output(value: str, secrets: list[str | None]) -> str:
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[REDACTED_SECRET]")
            encoded = quote(secret, safe="")
            if encoded != secret:
                value = value.replace(encoded, "[REDACTED_SECRET]")
    return value


def check(batch: Path) -> dict:
    """Read-only gate for every frozen source, task, oracle, profile, and Pier job."""
    batch = Path(batch).resolve()
    lock = _read(batch / "suite-lock.json")
    slots = _read(batch / "schedule.json")["slots"]
    if lock.get("slot_count") != 8 or slots != schedule() or digest(batch / "schedule.json") != lock["schedule_sha256"]:
        raise RuntimeError("eight-slot AB/BA schedule differs from frozen lock")
    old = lock.get("inputs_sha256") or {}
    current = inputs(batch)
    if old != current:
        changed = sorted(name for name in {*old, *current} if old.get(name) != current.get(name))
        raise RuntimeError(f"frozen follow-up inputs changed: {changed[:12]}")
    plan = load(batch / "manifest.json")
    _same_scenario_identity(plan)
    if lock.get("scenario_template_sha256") != digest(SOURCE_PLAN):
        raise RuntimeError("Skill scenario template changed")
    _check_dsh_lock(batch, plan)
    if plan["phase"] != "formal" or plan["model"]["provider"] != "deepseek-official" \
            or plan["jev"]["endpoint"] != "https://api.typesafe.ai/v1/systemone" \
            or plan["budget"]["agent_timeout_sec"] != 240 \
            or plan["budget"]["max_batch_spend_usd"] != 0.25 \
            or plan["budget"]["max_infrastructure_retries"] != 0 \
            or plan["conditions"]["sandbox"] != "danger-full-access":
        raise RuntimeError("formal follow-up identity or limits changed")
    for case in CASE_ORDER:
        root = batch / "cases" / case
        truth = _read(root / "truth.json")
        expected = _read(root / "fixture-expected.json")
        if truth["candidate_names"] != sorted(truth["candidate_names"]) or len(truth["candidate_names"]) != 24:
            raise RuntimeError("skill catalog is not exactly 24 sorted candidates")
        if not set(truth["required_names"]) <= set(truth["relevant_names"]) <= set(truth["candidate_names"]):
            raise RuntimeError("frozen relevance labels invalid")
        for kind, base in (("repo", root / "repo-source"), ("skills", root / "skill-source")):
            if kind == "repo":
                observed = {file.relative_to(base).as_posix(): digest(file)
                            for file in base.rglob("*") if file.is_file()}
            else:
                # Skills are frozen in their tar plus per-file SHA manifest; no loose model-facing source exists.
                with tarfile.open(root / "skill-fixture.tar") as archive:
                    observed = {entry.name: hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
                                for entry in archive.getmembers() if entry.isfile()}
            if observed != expected[kind]:
                raise RuntimeError(f"{case} {kind} files differ from frozen hashes")
        oracle = subprocess.run(["node", str(root / "oracle-eval.mjs")], cwd=root,
                                capture_output=True, text=True, check=False)
        if oracle.returncode != 0 or json.loads(oracle.stdout) != truth["oracle"]:
            raise RuntimeError(f"{case} independent source oracle differs")
    patches = [_read(batch / "profiles" / f"{condition}.patch.json") for condition in CONDITIONS]
    if patches != [profile_rows(plan, condition) for condition in CONDITIONS] \
            or not profiles_match_except_feature(*patches):
        raise RuntimeError("paired skill profiles differ beyond target feature")
    for condition, patch in zip(CONDITIONS, patches):
        jev = next(row for row in patch if row.get("id") == "jev")
        if jev["config"]["features"] != expected_features(condition):
            raise RuntimeError("a non-target feature was enabled")
    for slot in slots:
        path = batch / "slots" / f"{slot['slot']:02d}" / "job.json"
        if _read(path) != job_config(batch, slot):
            raise RuntimeError(f"Pier slot {slot['slot']} changed")
    return {"batch": str(batch), "slots": 8, "input_files": len(current),
            "lock_sha256": digest(batch / "suite-lock.json"),
            "max_known_estimated_usd_before_next": 0.25}


def _pair_rows(rows: list[dict], case: str, repeat: int) -> dict:
    selected = {(row["case"], row["repeat"], row["condition"]): row for row in rows}
    a = selected[case, repeat, "baseline"]
    b = selected[case, repeat, "skill_selection"]
    metrics = ("read", "grep", "glob", "bash")
    def _count(row: dict, name: str):
        return (row.get("repo_tools") or {}).get("all_native_calls", {}).get(name)
    comparable = all(row.get("status") == "completed" and row.get("structural_ok")
                     and row.get("usage_complete") for row in (a, b))
    return {"case": case, "repeat": repeat, "order": "AB" if repeat == 1 else "BA",
            "baseline_slot": a["slot"], "selection_slot": b["slot"],
            "comparable_evidence": comparable,
            "deltas_selection_minus_baseline": {
                **{f"all_native_{name}_calls": _count(b, name) - _count(a, name)
                   if comparable else None for name in metrics},
                "confirmed_study_read_calls": (
                    b["repo_tools"]["confirmed_study_read"]["successful_calls"]
                    - a["repo_tools"]["confirmed_study_read"]["successful_calls"]
                    if comparable else None),
                "confirmed_study_read_result_utf8_bytes": (
                    b["repo_tools"]["confirmed_study_read"]["result_utf8_bytes"]
                    - a["repo_tools"]["confirmed_study_read"]["result_utf8_bytes"]
                    if comparable else None),
                "skill_load_calls": b["skill_tools"]["load_calls"] - a["skill_tools"]["load_calls"]
                if comparable else None,
                "catalog_chars": b["catalog_chars"] - a["catalog_chars"] if comparable else None,
                "estimated_usd": b["known_estimated_usd"] - a["known_estimated_usd"] if comparable else None,
                "agent_execution_seconds": b.get("agent_execution_seconds", 0) - a.get("agent_execution_seconds", 0)
                if comparable and a.get("agent_execution_seconds") is not None
                and b.get("agent_execution_seconds") is not None else None,
            }}


def report(batch: Path) -> dict:
    batch = Path(batch).resolve()
    rows = [inspect_slot(batch, slot) for slot in schedule()]
    started = [row for row in rows if row["status"] in ("started", "completed")]
    unknown = [row["slot"] for row in started if row.get("known_estimated_usd") is None]
    known = sum(row["known_estimated_usd"] for row in started
                if row.get("known_estimated_usd") is not None)
    pairs = [_pair_rows(rows, case, repeat) for case in CASE_ORDER for repeat in (1, 2)]
    output = {"planned_slots": 8, "completed_slots": sum(row["status"] == "completed" for row in rows),
              "rows": rows, "pairs": pairs,
              "known_estimated_usd": known, "cost_complete": not unknown,
              "unknown_cost_slots": unknown, "total_estimated_usd": None if unknown else known,
              "scope": "two fixed miniature-repository investigations, 24 skills each, AB/BA twice",
              "limitations": ["Mechanical answer hints are not the independent task verdict",
                              "Bash internal file reads are not inferable from bash-call counts",
                              "Four pairs on two fixed tasks cannot establish a general benefit",
                              "Floating DeepSeek alias, order and caching remain limitations"]}
    _write(batch / "report.json", output)
    lines = ["## 直接答案", "", f"后续技能调查计划8槽，已完成{output['completed_slots']}槽。"
             f"已知峰价估算USD {known:.9f}；"
             + ("存在整槽费用未知。" if unknown else "已开始槽的记录费用完整。"), "",
             "## 每对原始差值", "",
             "| 题目 | 重复/顺序 | 完整证据 | 原生read/grep/glob/bash差值 | 确认study源码read差值 | skill加载差值 | 估算费用差值USD |",
             "| --- | --- | --- | --- | ---: | ---: | ---: |"]
    for pair in pairs:
        delta = pair["deltas_selection_minus_baseline"]
        reads = "/".join(str(delta[name]) if delta[name] is not None else "N/A"
                         for name in ("all_native_read_calls", "all_native_grep_calls",
                                      "all_native_glob_calls", "all_native_bash_calls"))
        cost = f"{delta['estimated_usd']:.9f}" if delta["estimated_usd"] is not None else "N/A"
        lines.append(f"| {pair['case']} | {pair['repeat']}/{pair['order']} | "
                     f"{'是' if pair['comparable_evidence'] else '否'} | {reads} | "
                     f"{delta['confirmed_study_read_calls'] if delta['confirmed_study_read_calls'] is not None else 'N/A'} | "
                     f"{delta['skill_load_calls'] if delta['skill_load_calls'] is not None else 'N/A'} | {cost} |")
    lines += ["", "## 边界与验证", "", "两题均为固定小型仓库只读调查；真实DeepSeek自然执行，"
              "技能是否加载和最终事实是否正确分别记录。费用/时间差仅为本批观察，未作因果或显著性主张。", ""]
    (batch / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return output


def next_slot(batch: Path) -> dict:
    """Start exactly one paid slot only through the protected credential launcher."""
    if os.environ.get("JEV_SF_CREDENTIAL_LAUNCHER") != "1":
        raise RuntimeError("Use the skill follow-up credential launcher")
    checked = check(batch)
    batch = Path(batch).resolve()
    state_path = batch / "run-state.json"
    if state_path.is_file() and _read(state_path).get("state") in ("running", "halted"):
        raise RuntimeError("previous slot is running or halted; inspect evidence before continuing")
    rows = [inspect_slot(batch, slot) for slot in schedule()]
    known = 0.0
    next_item = None
    for slot, row in zip(schedule(), rows):
        if row["status"] == "completed":
            if not row["structural_ok"] or not row["usage_complete"] or row["known_estimated_usd"] is None:
                raise RuntimeError("an existing slot has incomplete structure or unknown cost")
            known += row["known_estimated_usd"]
        elif row["status"] == "not-started":
            next_item = slot
            break
        else:
            raise RuntimeError("a started slot lacks final evidence; no automatic retry")
    if next_item is None:
        return report(batch)
    if known >= checked["max_known_estimated_usd_before_next"]:
        raise RuntimeError("advisory USD 0.25 threshold reached before the next slot")
    job = batch / "slots" / f"{next_item['slot']:02d}" / "job.json"
    _write(state_path, {"state": "running", "slot": next_item["slot"],
                        "known_estimated_usd": known, "at": datetime.now(timezone.utc).isoformat()})
    plan = _read(batch / "manifest.json")
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join((str(REPO_ROOT), env.get("PYTHONPATH", "")))
    process = subprocess.run(["uv", "run", "--project", plan["paths"]["pier"], "pier", "run",
                              "--config", str(job), "--yes"], cwd=REPO_ROOT, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             errors="replace", check=False)
    secrets = [env.get(plan["conditions"]["main_credential_env"]), env.get(plan["jev"]["credential_env"])]
    (job.parent / "pier.stdout.txt").write_text(redact_output(process.stdout, secrets), encoding="utf-8")
    (job.parent / "pier.stderr.txt").write_text(redact_output(process.stderr, secrets), encoding="utf-8")
    current = inspect_slot(batch, next_item)
    if process.returncode != 0 or not current.get("structural_ok") or not current.get("usage_complete") \
            or current.get("known_estimated_usd") is None:
        _write(state_path, {"state": "halted", "slot": next_item["slot"],
                            "pier_exit_code": process.returncode,
                            "reasons": current.get("blocking_errors"),
                            "known_partial_estimated_usd": current.get("partial_known_estimated_usd"),
                            "at": datetime.now(timezone.utc).isoformat()})
        report(batch)
        raise RuntimeError(f"slot {next_item['slot']} halted; no further paid call")
    _write(state_path, {"state": "complete" if next_item["slot"] == 8 else "between-slots",
                        "last_slot": next_item["slot"],
                        "known_estimated_usd": known + current["known_estimated_usd"],
                        "at": datetime.now(timezone.utc).isoformat()})
    return report(batch)
